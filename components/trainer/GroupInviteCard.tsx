// An invitation to join a group, with the two answers to it.
//
// Shared by both hubs because both can receive one: a trainer can be added to
// another trainer's group exactly as a gym user can.
//
// Everything rendered here comes from get_my_group_invites() (migration 0027) —
// the name, who sent it, how many people are already in. That is the whole of
// what someone may know about a group they haven't joined, so there is
// deliberately nothing here to tap into: no roster, no thread, no preview.

import { Text, View, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import PeopleIcon from "../icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { pillGlow, PILL_RADIUS, PILL_SHADOW } from "../../constants/buttons";
import { CARD_INNER, CARD_META, CARD_TITLE, CARD_TOP } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import type { GroupInvite } from "../../constants/groups";

export default function GroupInviteCard({ invite, onAccept, onDecline }: {
  invite: GroupInvite;
  onAccept: (invite: GroupInvite) => void;
  onDecline: (invite: GroupInvite) => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const tap = (fn: (i: GroupInvite) => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn(invite);
  };

  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View style={styles.inner}>
        <View style={styles.top}>
          <View style={[styles.icon, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
            <PeopleIcon size={18} color={ACCT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{invite.name}</Text>
            <Text style={[styles.meta, { color: t.ts }]} numberOfLines={1}>
              {invite.memberCount} member{invite.memberCount === 1 ? "" : "s"}
            </Text>
          </View>
        </View>

        <View style={styles.fromRow}>
          <Avatar
            uri={invite.ownerPhotoUri}
            initials={invite.ownerInitials}
            size={24}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textColor={ACCT}
            textStyle={[styles.fromInitials, { color: ACCT }]}
          />
          <Text style={[styles.fromText, { color: t.ts }]} numberOfLines={1}>
            {invite.ownerName} added you
          </Text>
        </View>

        <View style={styles.actions}>
          <BounceButton style={{ flex: 1 }} onPress={tap(onDecline)} accessibilityLabel={`Decline ${invite.name}`}>
            <View style={[styles.btn, { backgroundColor: t.ctrl }]}>
              <Text style={[styles.btnText, { color: t.tp }]}>Decline</Text>
            </View>
          </BounceButton>
          <BounceButton style={{ flex: 1 }} onPress={tap(onAccept)} accessibilityLabel={`Join ${invite.name}`}>
            <View style={[styles.btn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
              <Text style={[styles.btnText, { color: "#fff" }]}>Join group</Text>
            </View>
          </BounceButton>
        </View>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner:    { ...CARD_INNER, gap: 10 },
  top:      { ...CARD_TOP },
  icon:     { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  name:     { ...CARD_TITLE },
  meta:     { ...CARD_META },
  fromRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  fromInitials: { fontFamily: FontFamily.bold, fontSize: 10 },
  fromText: { fontFamily: FontFamily.regular, fontSize: 12, flex: 1 },
  actions:  { flexDirection: "row", gap: 10 },
  btn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...PILL_SHADOW },
  btnText:  { fontFamily: FontFamily.bold, fontSize: 14 },
});
