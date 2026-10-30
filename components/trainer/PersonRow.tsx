// components/trainer/PersonRow.tsx
//
// One person's line in a card, as the group page lists its members: their
// face, their name and its tags, and what ends the line (a tick, a chevron).
// Lines in one card, not a card each (user request and pick, 2026-10-30: a
// card each was too much): Manage Group and a group's member list
// (app/trainer/group-edit.tsx), and the send sheet's people and groups
// (RecipientPickerSheet), where a group's line takes its photo (`leading`) and
// its faces under its name (`below`).

import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Avatar from "../Avatar";
import { ACCT, APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily, ON_FILL } from "../../constants/theme";
import { haloGlow } from "../../constants/buttons";
import { CARD_TITLE, SUMMARY_ROW } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";

/** A face at the start of a line, and what stands in for one (a group's
 *  photo, Send to all's icon). */
export const PERSON_AVATAR = 36;

/** A tag after a person's name: their role in the group, an unanswered invite,
 *  NOT CONNECTED, TRAINER, the unit they log in. */
export type RowTag = { label: string; fill: string; ink: string };

export default function PersonRow({ person, leading, first, tags, faded, dimmed, below, end, onPress, accessibilityLabel, accessibilityState }: {
  person: { id: string; name: string; initials?: string; photoUri?: string };
  /** In place of their face: a group's photo, Send to all's icon. */
  leading?: ReactNode;
  /** The card's first line has no hairline above it. */
  first: boolean;
  tags: RowTag[];
  /** Greyed: a member ticked to be removed. */
  faded?: boolean;
  /** Can't be picked just now (Send to all is on, a group with nobody in it):
   *  all of it faded, the hairline above it kept. */
  dimmed?: boolean;
  /** A line under the name: a group's faces. */
  below?: ReactNode;
  end?: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityState?: { checked?: boolean };
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress || dimmed}
      activeOpacity={0.7}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={dimmed ? { ...accessibilityState, disabled: true } : accessibilityState}
      style={[styles.row, !first && { borderTopWidth: 1, borderTopColor: t.div }]}
    >
      <View style={[styles.content, dimmed && styles.dimmed]}>
        {leading ?? (
          <Avatar uri={person.photoUri} initials={person.initials ?? ""} size={PERSON_AVATAR} colorKey={person.id} textStyle={styles.avatarText} />
        )}
        <View style={styles.middle}>
          <View style={styles.nameLine}>
            <Text style={[styles.title, styles.name, { color: faded ? t.ts : t.tp }]} numberOfLines={1}>{person.name}</Text>
            {tags.map(tag => (
              <View key={tag.label} style={[styles.tag, { backgroundColor: tag.fill }]}>
                <Text style={[styles.tagText, { color: tag.ink }]}>{tag.label}</Text>
              </View>
            ))}
          </View>
          {below}
        </View>
        {end}
      </View>
    </TouchableOpacity>
  );
}

/** The round tick ending a line: green to add someone, red to remove them. */
export function Tick({ on, tone }: { on: boolean; tone: "add" | "remove" }) {
  const { isDark } = useTheme();
  const color = tone === "add" ? ACCT : DANGER_BRIGHT;
  return (
    <View style={[styles.check, on
      ? { backgroundColor: color, borderColor: color, ...haloGlow(color, 0.5, 6, isDark) }
      : { backgroundColor: "transparent", borderColor: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.15)" },
    ]}>
      {on && <Ionicons name="checkmark" size={14} color={ON_FILL} />}
    </View>
  );
}

const styles = StyleSheet.create({
  // The group page's member row, in one card.
  row:        { ...SUMMARY_ROW, paddingVertical: 12 },
  content:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  dimmed:     { opacity: 0.45 },
  middle:     { flex: 1, minWidth: 0 },
  nameLine:   { flexDirection: "row", alignItems: "center", gap: 6 },
  title:      { ...CARD_TITLE },
  name:       { flexShrink: 1 },
  avatarText: { fontFamily: FontFamily.bold, fontSize: 13 },
  check:      { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tag:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText:    { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
});
