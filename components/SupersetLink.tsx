// The line joining a superset's cards (utils/supersets.ts; user pick,
// 2026-11-15: separate cards joined by a line, not one card of both). Drawn in
// the gap under every member but the last, from that card's edge to the next
// one's, through the centre of what the cards line up on their left (the
// Workout tab's number circle, the builder's photo), with SUPERSET beside it.
//
// It lives in the gap the card's own bottom margin makes, placed in points
// from the bottom of the box holding the card, so the cards keep their
// spacing and nothing paints over them.

import { StyleSheet, Text, View } from "react-native";

import { ACCT, accentTextColor, FontFamily } from "../constants/theme";

const LINE_W = 2;
/** From the line to the word. */
const LABEL_GAP = 10;

export default function SupersetLink({ gap, x, isDark }: {
  /** The gap it fills: the card's bottom margin. */
  gap: number;
  /** The line's centre, in points from the card's left edge. */
  x: number;
  isDark: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { height: gap }]}
    >
      <View style={[styles.line, { left: x - LINE_W / 2 }]} />
      <View style={[styles.labelSlot, { left: x + LABEL_GAP }]}>
        {/* Capped: the gap is the cards' fixed margin (14pt in the builder),
            so at the largest text sizes it would grow into the cards. */}
        <Text style={[styles.label, { color: accentTextColor(isDark) }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          SUPERSET
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box:       { position: "absolute", left: 0, right: 0, bottom: 0 },
  line:      { position: "absolute", top: 0, bottom: 0, width: LINE_W, borderRadius: LINE_W / 2, backgroundColor: ACCT },
  labelSlot: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  label:     { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1.2 },
});
