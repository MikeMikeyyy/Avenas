// A number in a small raised circle: an exercise's place in its workout (on
// its card, and on its row in the reorder sheet, so the two read as one) or how
// many exercises a program's day holds (the builder's day headings).
//
// It's a NeuCard, whose edge on light mode is a white highlight. On the white
// cards these sit on that edge vanished, and only a faint shadow was left of
// the circle (user report, 2026-10-29). So on light it takes the app's hairline
// instead: a soft outline, as dark mode's faint white edge already gives it
// (user pick: keep the raised white circle, outline it; dark mode unchanged).

import { StyleSheet, Text } from "react-native";
import NeuCard from "./NeuCard";
import { ACCT, APP_LIGHT, FontFamily } from "../constants/theme";

export default function NumberBadge({ n, isDark, size = 32 }: {
  n: number;
  isDark: boolean;
  /** Its diameter: 32 beside an exercise's name, 28 in a day's heading. */
  size?: number;
}) {
  const box = { width: size, height: size };
  return (
    <NeuCard dark={isDark} radius={size / 2} style={box} innerStyle={[styles.inner, box, !isDark && styles.outline]}>
      <Text style={[styles.text, { color: ACCT }]}>{n}</Text>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner:   { alignItems: "center", justifyContent: "center" },
  // In place of NeuCard's white edge (its clip layer's 1pt border).
  outline: { borderColor: APP_LIGHT.div },
  text:    { fontFamily: FontFamily.bold, fontSize: 13 },
});
