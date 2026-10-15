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
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue } from "../../constants/theme";
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
        <TouchableOpacity
          onPress={tap(onStop)}
          style={styles.stop}
          accessibilityRole="button"
          accessibilityLabel="Stop comparing"
          hitSlop={4}
        >
          <View style={[styles.stopCircle, { backgroundColor: t.ctrl }]}>
            <Ionicons name="close" size={16} color={t.tp} />
          </View>
        </TouchableOpacity>
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
  stop: { width: 44, height: 44, marginRight: -6, alignItems: "center", justifyContent: "center" },
  stopCircle: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4,
  },
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
