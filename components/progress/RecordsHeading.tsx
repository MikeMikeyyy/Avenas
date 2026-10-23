// "Personal Records" over an exercise's records, with the app's trophy just
// after the words (user request, 2026-10-22): under the Progress page's
// exercise chart (components/ExerciseProgressionChart.tsx) and the compare
// page's (components/progress/CompareExerciseCard.tsx). One component so the
// two headings stay the same.

import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { TROPHY_ICON } from "../../constants/icons";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

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
});
