// "Personal Records" over an exercise's records, with the app's trophy just
// after the words (user request, 2026-10-22), and the mark before each
// record's name (RecordMarker): under the Progress page's exercise chart
// (components/ExerciseProgressionChart.tsx) and the compare page's
// (components/progress/CompareExerciseCard.tsx). One component each so the two
// pages' records stay the same.

import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { TROPHY_ICON } from "../../constants/icons";
import { APP_DARK, APP_LIGHT, FontFamily, GOLD, GOLD_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

/** The mark before a record's name: a gold dot for a record lifted (Heaviest,
 *  Most reps or Longest hold, Most volume), each the gold mark on its own chart
 *  tab; a ring for the estimate, which nobody lifted (user decision,
 *  2026-10-13). The compare page's records had none (user request, 2026-11-06:
 *  "exactly what we have on the main progress page"). */
export function RecordMarker({ kind }: { kind: "gold" | "ring" }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const gold = isDark ? GOLD_DARK : GOLD;
  return (
    <View
      style={[
        styles.marker,
        kind === "gold"
          ? { backgroundColor: gold, shadowColor: gold, shadowOpacity: isDark ? 0.45 : 0.6 }
          : { borderWidth: 1.5, borderColor: t.ts },
      ]}
    />
  );
}

export default function RecordsHeading() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.row} accessibilityRole="header">
      <Text style={[styles.text, { color: t.tp }]}>Personal Records</Text>
      <Image source={TROPHY_ICON} style={styles.trophy} contentFit="contain" accessibilityElementsHidden importantForAccessibility="no" />
    </View>
  );
}

const styles = StyleSheet.create({
  // The section header's own spacing: the bold-18 family of the page's other
  // section headers ("Exercise Progress").
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 36, marginBottom: 12 },
  text: { fontFamily: FontFamily.bold, fontSize: 18 },
  trophy: { width: 20, height: 20 },
  marker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 3,
  },
});
