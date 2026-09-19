// What you can do with one chat message: the step a chat's sheet shows when you
// tap a bubble. Shared by the 1:1 thread and the group thread so the two offer
// the same thing in the same words.
//
//   your own message  → Delete message (red); the thread keeps a
//                       "You deleted this message" marker in its place
//   someone else's    → Report message, which moves the SAME sheet on to the
//                       reason list (ReportReasonList)
//
// Content only, not a sheet: each chat already has one sheet open for its menu,
// and this is a step inside it (one RN Modal per screen).

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { APP_DARK, APP_LIGHT, DANGER, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

interface Props {
  message: { mine: boolean; text: string };
  /** Who wrote it, for the heading over someone else's message. */
  authorName?: string;
  onDelete: () => void;
  onReport: () => void;
}

export default function MessageActions({ message, authorName, onDelete, onReport }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  return (
    <>
      {/* Which message this is about: its opening lines, so a tap on the wrong
          bubble is obvious before anything happens to it. */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>
          {message.mine ? "Your message" : authorName ? `${authorName}'s message` : "Message"}
        </Text>
        <Text style={[styles.quote, { color: t.ts }]} numberOfLines={2}>{message.text}</Text>
      </View>
      <View style={styles.menu}>
        {message.mine ? (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDelete(); }}
            accessibilityRole="button"
            accessibilityLabel="Delete message"
          >
            <Ionicons name="trash-outline" size={20} color={DANGER} />
            <Text style={[styles.rowText, { color: DANGER }]}>Delete message</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReport(); }}
            accessibilityRole="button"
            accessibilityLabel="Report message"
          >
            {/* Red like Delete: both are the serious action on a message. */}
            <Ionicons name="flag-outline" size={20} color={DANGER} />
            <Text style={[styles.rowText, { color: DANGER }]}>Report message</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

// The chat menus' own geometry (menuName / menu / menuRow / menuText in both
// chat screens), so this step reads as part of the same sheet.
const styles = StyleSheet.create({
  header:  { paddingHorizontal: 24, paddingBottom: 6, gap: 4, alignItems: "center" },
  title:   { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center" },
  quote:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  menu:    { paddingHorizontal: 16, paddingTop: 4 },
  row:     { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 8 },
  rowText: { fontFamily: FontFamily.semibold, fontSize: 16 },
});
