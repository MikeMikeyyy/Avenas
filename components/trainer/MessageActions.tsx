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

import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SheetPill from "../SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
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
        {/* Red either way: both are the serious action on a message. */}
        {message.mine ? (
          <SheetPill label="Delete message" variant="danger" icon={c => <Ionicons name="trash-outline" size={18} color={c} />} onPress={onDelete} />
        ) : (
          <SheetPill label="Report message" variant="danger" icon={c => <Ionicons name="flag-outline" size={18} color={c} />} onPress={onReport} />
        )}
      </View>
    </>
  );
}

// The chat menus' own geometry (menuName / menu in both chat screens), so this
// step reads as part of the same sheet.
const styles = StyleSheet.create({
  header:  { paddingHorizontal: 24, paddingBottom: 6, gap: 4, alignItems: "center" },
  title:   { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center" },
  quote:   { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  menu:    { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
