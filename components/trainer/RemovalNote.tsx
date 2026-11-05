// components/trainer/RemovalNote.tsx
//
// What a trainer wrote as they removed a review without sending it back
// (SentProgram.removalNote, migration 0053; user request, 2026-11-05), shown
// to the person who asked wherever their request reads Not reviewed: an open
// row on Sent for Review, a trainer's own Programs page and a group's, and the
// program's own page. The look of the comments that come back with a review,
// so the two read as the trainer's words.

import { StyleSheet, Text, View } from "react-native";

import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

export default function RemovalNote({ note }: { note: string }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={[styles.box, { borderColor: t.div }]}>
      <Text style={[styles.label, { color: t.ts }]}>{"WHY IT WASN'T REVIEWED"}</Text>
      <Text style={[styles.body, { color: t.tp }]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, gap: 6 },
  label: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  body: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
});
