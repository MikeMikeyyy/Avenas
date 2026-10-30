// Second step of the "Send a Program" flow. Lists clients with checkboxes
// + a "Send to all" toggle. Confirm sends to the chosen recipients.
//
// People look as they do on the Trainer tab (user request, 2026-10-23: the
// sheet drew initials where the tab shows photos): each client's photo, and
// under a group's name the faces of everyone a send to it reaches.
//
// Each part is one card of lines, Manage Group's (components/trainer/
// PersonRow.tsx), with the same green tick (user request, 2026-10-30: a card
// for each person and each group was too much).
//
// Everything above the buttons scrolls as one, in the sheet's own scroll, and
// Send and Cancel are its pinned footer (user report, 2026-10-29). Only the
// clients used to scroll, in a box of a fixed 320pt, and with the groups and
// header above it the sheet outgrew the screen, its top out of reach.
//
// A group picked is a send TO THE GROUP, as its own page sends one (user
// report, 2026-10-29): everyone in it but me, a fellow trainer and anyone I'm
// not connected to included, each row tagged with the group so it shows on the
// group's Programs page (utils/trainerLists.ts:shareEntriesFor builds the
// rows). It was a shortcut that ticked the people in it who were my clients and
// sent to them one by one, so nothing showed on the group's page and the rest
// of the group got nothing. The caller offers only groups I may send to (mine,
// and those I'm a trainer in).
//
// A person ticked one by one gets it straight to them, on their own Trainer
// tab, never through a group, whatever groups are ticked too (user report,
// 2026-10-29). Groups and people are ticked apart: nothing ticks itself. (A
// client in a group ticked used to show ticked by it and take the group's
// copy, which put the program on the group's page as well.)
//
// Nothing moves once the sheet is open, so a tap lands where it was aimed: the
// note about weights in the other unit, which arrives a moment after it opens,
// sits under the list. At the top it pushed every row down as you reached for
// one, onto the group above it.

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import SimpleSheet from "./SimpleSheet";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import SheetPill from "../SheetPill";
import GroupAvatar from "./GroupAvatar";
import MemberStack from "./MemberStack";
import PersonRow, { PERSON_AVATAR, Tick, type RowTag } from "./PersonRow";
import {
  APP_DARK, APP_LIGHT, FontFamily, ACCT, NEU_BG, NEU_BG_DARK, PAUSED_ORANGE,
  replacedTextColor, roleColor, roleTextColor,
} from "../../constants/theme";
import { darkGlow, pill, pillGlow, PILL_H_SM } from "../../constants/buttons";
import { CARD_META } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import { fetchPeopleUnits } from "../../lib/clientTraining";
import { isCloudContactId } from "../../lib/chat";
import { unitLabel, unitOf, type WeightUnit } from "../../utils/units";
import type { Client } from "../../utils/trainerStore";
import type { RecipientChoice } from "../../utils/trainerLists";
import type { MemberFace } from "../../constants/groups";

/** A group a program can be sent to. */
export type RecipientGroup = {
  id: string;
  name: string;
  /** Everyone a send to it reaches: its members and the invites still to be
   *  answered, me left out. */
  memberIds: string[];
  photoUri?: string;
  /** Its roster's faces, as its Trainer tab card shows them (the hub's
   *  groupFaces). Absent until they've loaded: the row says how many instead. */
  faces?: MemberFace[];
};

const NO_GROUPS: RecipientGroup[] = [];

interface Props {
  visible: boolean;
  programName: string;
  clients: Client[];
  /** The groups I may send to. Omit (or pass []) to hide the section. */
  groups?: RecipientGroup[];
  /** Every client, or the groups and the clients picked. */
  onConfirm: (choice: RecipientChoice) => void;
  onClose: () => void;
  /** Back to pick another program, when the program was picked in the sheet
   *  before this one (user request, 2026-10-30): a glass chevron top left. */
  onBack?: () => void;
}

export default function RecipientPickerSheet({ visible, programName, clients, groups = NO_GROUPS, onConfirm, onClose, onBack }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The Trainer tab's card under a group's faces, which rings each one so the
  // overlapping faces stay apart.
  const cardSurface = isDark ? NEU_BG_DARK : NEU_BG;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setPickedGroups(new Set());
      setSendToAll(false);
    }
  }, [visible]);

  // Who logs in the other unit. A program's weights read in the unit they were
  // entered in, so those people will see yours as you typed them: say so
  // beside their names before the program goes (0036; unknown = no tag).
  const { isKg } = useUnit();
  const myUnit = unitOf(isKg);
  const [units, setUnits] = useState<Record<string, WeightUnit>>({});
  const clientIdsKey = clients.map(c => c.id).join(",");
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const ids = clientIdsKey.split(",").filter(id => id && isCloudContactId(id));
    fetchPeopleUnits(ids).then(u => { if (!cancelled) setUnits(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, clientIdsKey]);
  const otherUnitIds = useMemo(
    () => new Set(Object.entries(units).filter(([, u]) => u !== myUnit).map(([id]) => id)),
    [units, myUnit],
  );
  const otherUnit: WeightUnit = myUnit === "kg" ? "lb" : "kg";
  // A trainer among them in the trainer role's colours, as on Manage Group, and
  // the other unit in the orange the note under the list explains.
  const trainerTag: RowTag = { label: "TRAINER", fill: `${roleColor("trainer")}22`, ink: roleTextColor("trainer", isDark) };
  const unitTag: RowTag = { label: `LOGS IN ${unitLabel(otherUnit).toUpperCase()}`, fill: `${PAUSED_ORANGE}22`, ink: replacedTextColor(isDark) };

  const toggleClient = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendToAll(false);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendToAll(prev => {
      const next = !prev;
      if (next) {
        setSelected(new Set());
        setPickedGroups(new Set());
      }
      return next;
    });
  };

  const toggleGroup = (g: RecipientGroup) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendToAll(false);
    if (g.memberIds.length === 0) return;
    setPickedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      return next;
    });
  };

  /** How many people the send reaches, each once (shareEntriesFor). */
  const reach = useMemo(() => {
    if (sendToAll) return clients.length;
    const people = new Set(selected);
    for (const g of groups) {
      if (pickedGroups.has(g.id)) for (const id of g.memberIds) people.add(id);
    }
    return people.size;
  }, [sendToAll, clients.length, selected, groups, pickedGroups]);

  const canSend = reach > 0;

  const ctaLabel = useMemo(() => {
    if (!canSend) return "Choose recipients";
    if (sendToAll) return `Send to all ${clients.length}`;
    if (pickedGroups.size === 0) return `Send to ${reach} client${reach === 1 ? "" : "s"}`;
    return `Send to ${reach} ${reach === 1 ? "person" : "people"}`;
  }, [canSend, sendToAll, clients.length, pickedGroups.size, reach]);

  const handleConfirm = () => {
    if (!canSend) return;
    onConfirm(sendToAll
      ? { all: true, groupIds: [], clientIds: [] }
      : {
          all: false,
          // In the order they're listed, so the first group someone's in is
          // the one their copy comes through (if they weren't ticked themselves).
          groupIds: groups.filter(g => pickedGroups.has(g.id)).map(g => g.id),
          clientIds: [...selected],
        });
  };

  return (
    <SimpleSheet
      visible={visible}
      onClose={onClose}
      onBack={onBack}
      footer={
        <View style={styles.actions}>
          <BounceButton onPress={canSend ? handleConfirm : undefined}>
            <View style={[styles.send, darkGlow(styles.send, isDark), { opacity: canSend ? 1 : 0.4 }]}>
              <Text style={styles.sendText}>{ctaLabel}</Text>
            </View>
          </BounceButton>
          <SheetPill label="Cancel" variant="cancel" onPress={onClose} style={{ marginTop: 8 }} />
        </View>
      }
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]}>Send "{programName}"</Text>
        <Text style={[styles.subtitle, { color: t.ts }]}>
          {groups.length > 0 ? "Pick a group, or clients one by one." : "Pick which clients should receive this program."}
        </Text>
      </View>

      <View style={[styles.cardWrap, styles.firstCard]}>
        <NeuCard dark={isDark} radius={16}>
          <PersonRow
            person={{ id: "all", name: "Send to all clients" }}
            leading={(
              <View style={[styles.allIcon, { backgroundColor: isDark ? `${ACCT}1F` : `${ACCT}2E` }]}>
                <Ionicons name="people-outline" size={18} color={ACCT} />
              </View>
            )}
            first
            tags={[]}
            below={<Text style={[styles.rowMeta, { color: t.ts }]}>{clients.length} {clients.length === 1 ? "client" : "clients"}</Text>}
            end={<Tick on={sendToAll} tone="add" />}
            onPress={toggleAll}
            accessibilityLabel={`Send to all ${clients.length} clients`}
            accessibilityState={{ checked: sendToAll }}
          />
        </NeuCard>
      </View>

      {groups.length > 0 && (
        <>
          <Text style={[styles.section, { color: t.ts }]}>OR PICK A GROUP</Text>
          <Text style={[styles.sectionHint, { color: t.ts }]}>{"Everyone in it receives it, and it shows on the group's page."}</Text>
          <View style={styles.cardWrap}>
            <NeuCard dark={isDark} radius={16}>
              {groups.map((g, i) => {
                const checked = !sendToAll && pickedGroups.has(g.id);
                const count = `${g.memberIds.length} ${g.memberIds.length === 1 ? "person" : "people"}`;
                // Who a send to it reaches, as faces: the roster's, less me. Only
                // when they cover everyone it reaches, so the row never shows
                // fewer people than it sends to; otherwise the count.
                const reaches = new Set(g.memberIds);
                const faces = g.faces?.filter(f => reaches.has(f.id)) ?? [];
                const showFaces = faces.length > 0 && faces.length === g.memberIds.length;
                return (
                  <PersonRow
                    key={g.id}
                    person={{ id: g.id, name: g.name }}
                    leading={<GroupAvatar uri={g.photoUri} size={PERSON_AVATAR} isDark={isDark} colorKey={g.id} />}
                    first={i === 0}
                    tags={[]}
                    dimmed={sendToAll || g.memberIds.length === 0}
                    below={showFaces ? (
                      <View style={styles.faces}>
                        <MemberStack members={faces} size={20} overlap={8} isDark={isDark} ringColor={cardSurface} countColor={t.ts} />
                      </View>
                    ) : (
                      <Text style={[styles.rowMeta, { color: t.ts }]}>{count}</Text>
                    )}
                    end={<Tick on={checked} tone="add" />}
                    onPress={() => toggleGroup(g)}
                    accessibilityLabel={`${checked ? "Deselect" : "Select"} ${g.name}, ${count}`}
                    accessibilityState={{ checked }}
                  />
                );
              })}
            </NeuCard>
          </View>
        </>
      )}

      <Text style={[styles.section, { color: t.ts }]}>OR PICK INDIVIDUALLY</Text>
      {groups.length > 0 ? (
        <Text style={[styles.sectionHint, { color: t.ts }]}>{"Straight to them, on their own Trainer tab, not through a group."}</Text>
      ) : null}

      <View style={styles.cardWrap}>
        {clients.length === 0 ? (
          <Text style={[styles.empty, { color: t.ts }]}>{"You don't have any clients yet."}</Text>
        ) : (
          <NeuCard dark={isDark} radius={16}>
            {clients.map((c, i) => {
              const checked = !sendToAll && selected.has(c.id);
              const tags: RowTag[] = [];
              if (c.isTrainer) tags.push(trainerTag);
              if (otherUnitIds.has(c.id)) tags.push(unitTag);
              return (
                <PersonRow
                  key={c.id}
                  person={c}
                  first={i === 0}
                  tags={tags}
                  dimmed={sendToAll}
                  end={<Tick on={checked} tone="add" />}
                  onPress={() => toggleClient(c.id)}
                  accessibilityLabel={`${checked ? "Deselect" : "Select"} ${c.name}`}
                  accessibilityState={{ checked }}
                />
              );
            })}
          </NeuCard>
        )}
      </View>

      {/* Under the list: it arrives after the sheet opens, and up top it moved
          every row down as a finger reached for one. */}
      {otherUnitIds.size > 0 && (
        <Text style={[styles.subtitle, styles.unitNote, { color: t.ts }]}>
          Anyone marked <Text style={{ color: replacedTextColor(isDark), fontFamily: FontFamily.semibold }}>{`logs in ${unitLabel(otherUnit)}`}</Text> will see your weights in the unit you entered them in.
        </Text>
      )}
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:      { paddingHorizontal: 24, paddingBottom: 14, gap: 4 },
  title:       { fontFamily: FontFamily.bold, fontSize: 20 },
  subtitle:    { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  unitNote:    { paddingHorizontal: 24, paddingBottom: 8 },
  // Each part's card, and the room under it before the next part's label.
  cardWrap:    { paddingHorizontal: 20, paddingBottom: 18 },
  firstCard:   { paddingTop: 4 },
  // Manage Group's labels over its cards.
  section:     { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.2, paddingHorizontal: 24, marginBottom: 8 },
  sectionHint: { fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 24, marginTop: -4, marginBottom: 8 },
  empty:       { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  rowMeta:     { ...CARD_META },
  faces:       { marginTop: 4 },
  allIcon:     { width: PERSON_AVATAR, height: PERSON_AVATAR, borderRadius: PERSON_AVATAR / 2, alignItems: "center", justifyContent: "center" },
  actions:     { paddingHorizontal: 20, paddingTop: 12 },
  send:        { ...pill(PILL_H_SM), backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) },
  sendText:    { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
