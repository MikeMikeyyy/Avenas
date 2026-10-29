// The sheet a group member's row opens, on the group's page and on its member
// list (app/trainer/group-edit.tsx, as someone who isn't the owner sees it).
// One component, so the two offer the same things in the same order: the list
// used to report people from a flag on each row, and the group page's sheet
// couldn't report anyone (user request, 2026-10-29).
//
// What it offers is gated by what I may do:
//   Add to favourites   always: starring is mine alone
//   Open client page    only for someone who IS my client (the page decides)
//   Make a trainer      the owner's
//   Report              anyone but me, whatever my standing: group members see
//                       each other's names and photos without being
//                       connected (Apple Guideline 1.2)
//   Remove from group   the owner's (Cancel invite while they haven't joined)
//
// Report moves this same sheet on to the reasons (ReportReasonList), never a
// second modal (one RN Modal per screen). My own row opens nothing, so the
// sheet is never about me.

import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SimpleSheet from "./SimpleSheet";
import { ReportReasonList } from "./ReportReasonSheet";
import SheetPill from "../SheetPill";
import FavouriteStar, { useFavouriteGold } from "../FavouriteStar";
import FlagIcon from "../icons/FlagIcon";
import UserRoundMinusIcon from "../icons/UserRoundMinusIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ROLE_TRAINER } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { reportPerson } from "../../utils/moderation";
import type { GroupMember } from "../../constants/groups";
import type { ReportReason } from "../../constants/chat";

interface Props {
  /** Whose sheet is open (null = closed). */
  member: GroupMember | null;
  onClose: () => void;
  /** Whether I've starred them. */
  starred: boolean;
  // Each action closes the sheet first, then runs.
  onToggleFavourite: (m: GroupMember) => void;
  /** Only for someone who is my client: the client page opens a person from my
   *  own roster, so for anyone else it said "Client not found". */
  onOpenClientPage?: (m: GroupMember) => void;
  /** The owner's: trainer ↔ member. */
  onToggleRole?: (m: GroupMember) => void;
  /** The owner's: out of the group, or their invite withdrawn. */
  onRemove?: (m: GroupMember) => void;
}

export default function GroupMemberSheet({ member, onClose, ...actions }: Props) {
  return (
    <SimpleSheet visible={member !== null} onClose={onClose}>
      {/* Keyed by the person, so every opening starts on the actions, never on
          the reasons a sheet was last closed on. */}
      {member ? <MemberActions key={member.id} member={member} onClose={onClose} {...actions} /> : null}
    </SimpleSheet>
  );
}

function MemberActions({ member, onClose, starred, onToggleFavourite, onOpenClientPage, onToggleRole, onRemove }:
  Omit<Props, "member"> & { member: GroupMember }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The label beside the star must match it exactly.
  const favouriteGold = useFavouriteGold();
  const [reporting, setReporting] = useState(false);

  const run = (action: (m: GroupMember) => void) => () => {
    onClose();
    action(member);
  };

  // reportPerson keeps the name and photo I saw with an "inappropriate name or
  // photo" report, and holds one made offline until it can be delivered.
  const submitReport = async (reason: ReportReason) => {
    onClose();
    await reportPerson({ id: member.id, name: member.name, photoUri: member.photoUri }, reason);
    Alert.alert(
      "Report received",
      "Thanks, we review reports within 24 hours and remove content, and the people who post it, that breaks our guidelines.",
    );
  };

  if (reporting) {
    return <ReportReasonList title={`Report ${member.name || "member"}`} onSubmit={submitReport} onCancel={onClose} />;
  }

  const isTrainer = member.role === "trainer";
  return (
    <>
      <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{member.name || "Member"}</Text>
      <View style={styles.menu}>
        <SheetPill
          label={starred ? "Remove from favourites" : "Add to favourites"}
          tint={starred ? favouriteGold : undefined}
          icon={() => <FavouriteStar size={20} filled={starred} inactiveColor={t.tp} />}
          onPress={run(onToggleFavourite)}
          accessibilityState={{ selected: starred }}
        />
        {onOpenClientPage && (
          <SheetPill
            label="Open client page"
            icon={c => <Ionicons name="person-outline" size={18} color={c} />}
            onPress={run(onOpenClientPage)}
          />
        )}
        {onToggleRole && (
          <SheetPill
            label={isTrainer ? "Make a member" : "Make a trainer"}
            tint={isTrainer ? undefined : ROLE_TRAINER}
            icon={c => <Ionicons name={isTrainer ? "arrow-down-circle-outline" : "shield-checkmark-outline"} size={18} color={c} />}
            onPress={run(onToggleRole)}
          />
        )}
        <SheetPill label="Report" icon={c => <FlagIcon size={18} color={c} />} onPress={() => setReporting(true)} />
        {onRemove && (
          <SheetPill
            label={member.accepted ? "Remove from group" : "Cancel invite"}
            variant="danger"
            icon={c => <UserRoundMinusIcon size={18} color={c} />}
            onPress={run(onRemove)}
          />
        )}
      </View>
    </>
  );
}

// The group page's menu geometry (its menuName / menu), so this reads as the
// same family of sheet as its ⋯ menu.
const styles = StyleSheet.create({
  name: { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu: { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
