// components/progress/CompareHeader.tsx
//
// The top of the Progress page while it compares two programs, in place of the
// program and time-range pickers: the two programs, green over blue, each with
// where it's up to (a finished one, the dates it ran), and either one tapped
// to change it; the ✕ stops comparing.
//
// On the Progress page the filter dock draws the ✕ and the two programs
// (components/progress/FilterDock.tsx, user request 2026-11-15): as the page
// scrolls they merge into small pills beside the ✕ at its top. With `ghost`,
// this lays the header out as ever, the label and the card showing, the ✕ and
// the rows unseen in their places for the dock to draw over and measure.

import type { Ref } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import type { ViewInstance } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import NeuCard from "../NeuCard";
import GlassButton from "../GlassButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

type Side = "green" | "blue";
type Run = { name: string; status: string };

interface Props {
  green: Run;
  blue: Run;
  onChangeGreen: () => void;
  onChangeBlue: () => void;
  onStop: () => void;
  /** The ✕ and the rows unseen, holding their places for the filter dock. */
  ghost?: boolean;
  /** The ✕'s touch area (its circle 2 in from each side) and each row, for
   *  the dock to measure. */
  stopRef?: Ref<ViewInstance>;
  greenRef?: Ref<ViewInstance>;
  blueRef?: Ref<ViewInstance>;
  /** Any of them laid out again. */
  onLayout?: () => void;
}

/** A row's words for VoiceOver. */
export const compareRowA11y = (side: Side, p: Run) => `${side === "green" ? "Green" : "Blue"}: ${p.name}, ${p.status}. Change it`;

/**
 * What's on a program's row: its dot (green) or ring (blue), its name, where
 * it's up to, the chevron. Its own, so the filter dock draws the very same row
 * as the big face of the pill it becomes, laid out with COMPARE_ROW_FACE.
 */
export function CompareRowFace({ side, program }: { side: Side; program: Run }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <>
      {side === "green"
        ? <View style={[styles.dot, { backgroundColor: ACCT, shadowColor: ACCT }]} />
        : <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />}
      <Text style={[styles.name, { color: t.tp }]}>{program.name}</Text>
      <Text style={[styles.status, { color: t.ts }]} numberOfLines={2}>{program.status}</Text>
      <Ionicons name="chevron-forward" size={14} color={t.ts} />
    </>
  );
}

export default function CompareHeader({ green, blue, onChangeGreen, onChangeBlue, onStop, ghost = false, stopRef, greenRef, blueRef, onLayout }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const tap = (fn: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };
  const row = (side: Side, p: Run, onPress: () => void, ref?: Ref<ViewInstance>) => ghost ? (
    <View
      ref={ref}
      onLayout={onLayout}
      style={[styles.row, styles.ghost]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CompareRowFace side={side} program={p} />
    </View>
  ) : (
    <TouchableOpacity
      ref={ref}
      onLayout={onLayout}
      activeOpacity={0.6}
      onPress={tap(onPress)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={compareRowA11y(side, p)}
    >
      <CompareRowFace side={side} program={p} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: t.ts }]}>Comparing</Text>
        {/* Glass like the Compare button it replaces (components/GlassButton.tsx). */}
        <View ref={stopRef} onLayout={onLayout} style={styles.stopSlot}>
          <GlassButton onPress={onStop} ghost={ghost} style={styles.stop} solidStyle={PILL_SHADOW} accessibilityLabel="Stop comparing">
            <Ionicons name="close" size={20} color={t.tp} />
          </GlassButton>
        </View>
      </View>
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.inner}>
          {row("green", green, onChangeGreen, greenRef)}
          <View style={[styles.divider, { backgroundColor: t.div }]} />
          {row("blue", blue, onChangeBlue, blueRef)}
        </View>
      </NeuCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20 },
  // 10 under it, so the ✕ (as tall as this row) keeps clear of the card below:
  // at 4 its circle all but sat on it (user report, 2026-10-28).
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 6, marginBottom: 10 },
  label: { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
  // The circle's right edge on the card's, the touch area a little past it.
  // The circle is the Compare button's size (40, GlassButton's), which this ✕
  // undoes: it was 32, smaller than every other round button on the page
  // (user feedback, 2026-10-22).
  stopSlot: { marginRight: -2 },
  stop: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  inner: { paddingHorizontal: 16 },
  // A long name wraps (the whole name, never cut short), and the row grows.
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 10 },
  ghost: { opacity: 0 },
  divider: { height: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 3 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  name: { flex: 1, fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  // Where a run's up to, or the dates a finished one ran ("1 Jun – 26 Jul"),
  // which can take a second line when it ran into another year.
  status: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 17, maxWidth: 150, textAlign: "right" },
});

/** A row's face's layout: the row's own, at the row's size. */
export const COMPARE_ROW_FACE = styles.row;
