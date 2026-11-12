// A number in a small circle: an exercise's place in its workout (on its card)
// or how many exercises a program's day holds (the builder's day headings),
// raised; or, `wash`, flat in a faded green, in the pop-ups.
//
// Raised, it's a NeuCard, whose edge on light mode is a white highlight. On the
// white cards these sit on that edge vanished, and only a faint shadow was left
// of the circle (user report, 2026-10-29). So on light it takes the app's
// hairline instead: a soft outline, as dark mode's faint white edge already
// gives it (user pick: keep the raised white circle, outline it; dark mode
// unchanged).
//
// `wash` is the pop-ups' (user request, 2026-11-12: the reorder sheet's white
// circles to match the Workout Summary's faded green ones): a Workout
// Summary's days, every reorder sheet's rows, and a custom exercise's steps.
// The number is in the accent's words' ink (accentTextColor): plain ACCT on
// the faded green was about 1.5:1 in light mode, hard to make out, the deeper
// green about 5:1. `muted` is a rest day's: a grey circle, the secondary ink.

import { StyleSheet, Text, View } from "react-native";
import NeuCard from "./NeuCard";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, accentTextColor } from "../constants/theme";

/** A `wash` badge's faded green: see-through, so it sits on a glass sheet as it
 *  does on a card. */
const WASH = `${ACCT}24`;

export default function NumberBadge({ n, isDark, size = 32, wash = false, muted = false }: {
  n: number;
  isDark: boolean;
  /** Its diameter: 32 beside an exercise's name, 28 in a day's heading, 26 on
   *  a Workout Summary's days, 24 on a custom exercise's steps. */
  size?: number;
  /** Flat, in a faded green: the pop-ups' (see the top of this file). */
  wash?: boolean;
  /** With `wash`, a rest day's: grey, the number in the secondary ink. */
  muted?: boolean;
}) {
  const box = { width: size, height: size };
  const numberSize = size <= 24 ? styles.small : null;
  if (wash) {
    const t = isDark ? APP_DARK : APP_LIGHT;
    return (
      <View style={[styles.inner, box, { borderRadius: size / 2, backgroundColor: muted ? t.field : WASH }]}>
        <Text style={[styles.text, numberSize, { color: muted ? t.ts : accentTextColor(isDark) }]}>{n}</Text>
      </View>
    );
  }
  return (
    <NeuCard dark={isDark} radius={size / 2} style={box} innerStyle={[styles.inner, box, !isDark && styles.outline]}>
      <Text style={[styles.text, numberSize, { color: ACCT }]}>{n}</Text>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner:   { alignItems: "center", justifyContent: "center" },
  // In place of NeuCard's white edge (its clip layer's 1pt border).
  outline: { borderColor: APP_LIGHT.div },
  text:    { fontFamily: FontFamily.bold, fontSize: 13 },
  small:   { fontSize: 12 },
});
