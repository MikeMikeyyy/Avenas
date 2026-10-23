// components/progress/CompareHeader.tsx
//
// The top of the Progress page while it compares two programs, in place of the
// program and time-range pickers: the two programs, green over blue, each with
// where it's up to (a finished one, the dates it ran), and either one tapped
// to change it; the ✕ stops comparing.

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import NeuCard from "../NeuCard";
import GlassButton from "../GlassButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue } from "../../constants/theme";
import { PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

interface Props {
  green: { name: string; status: string };
  blue: { name: string; status: string };
  onChangeGreen: () => void;
  onChangeBlue: () => void;
  onStop: () => void;
}

export default function CompareHeader({ green, blue, onChangeGreen, onChangeBlue, onStop }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const tap = (fn: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };
  const row = (side: "green" | "blue", p: { name: string; status: string }, onPress: () => void) => (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={tap(onPress)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${side === "green" ? "Green" : "Blue"}: ${p.name}, ${p.status}. Change it`}
    >
      {side === "green"
        ? <View style={[styles.dot, { backgroundColor: ACCT, shadowColor: ACCT }]} />
        : <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />}
      <Text style={[styles.name, { color: t.tp }]}>{p.name}</Text>
      <Text style={[styles.status, { color: t.ts }]} numberOfLines={2}>{p.status}</Text>
      <Ionicons name="chevron-forward" size={14} color={t.ts} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: t.ts }]}>Comparing</Text>
        {/* Glass like the Compare button it replaces (components/GlassButton.tsx). */}
        <GlassButton onPress={onStop} style={styles.stop} solidStyle={PILL_SHADOW} accessibilityLabel="Stop comparing">
          <Ionicons name="close" size={20} color={t.tp} />
        </GlassButton>
      </View>
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.inner}>
          {row("green", green, onChangeGreen)}
          <View style={[styles.divider, { backgroundColor: t.div }]} />
          {row("blue", blue, onChangeBlue)}
        </View>
      </NeuCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 6, marginBottom: 4 },
  label: { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" },
  // The circle's right edge on the card's, the touch area a little past it.
  // The circle is the Compare button's size (40, GlassButton's), which this ✕
  // undoes: it was 32, smaller than every other round button on the page
  // (user feedback, 2026-10-22).
  stop: { width: 44, height: 44, marginRight: -2, alignItems: "center", justifyContent: "center" },
  inner: { paddingHorizontal: 16 },
  // A long name wraps (the whole name, never cut short), and the row grows.
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 10 },
  divider: { height: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 3 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  name: { flex: 1, fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  // Where a run's up to, or the dates a finished one ran ("1 Jun – 26 Jul"),
  // which can take a second line when it ran into another year.
  status: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 17, maxWidth: 150, textAlign: "right" },
});
