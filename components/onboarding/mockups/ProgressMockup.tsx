import { View, Text, StyleSheet } from "react-native";
import { useEffect } from "react";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, interpolate, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import NeuCard from "../../NeuCard";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../../constants/theme";

// Illustrative weight-progression chart — bars grow from the baseline in a
// rising trend when the slide activates. Each bar is a training week.
const BARS = [0.38, 0.5, 0.46, 0.62, 0.7, 0.84, 1.0];
const CHART_H = 124;

interface MockupProps {
  dark: boolean;
  active: boolean;
}

function Bar({
  progress, index, frac,
}: { progress: SharedValue<number>; index: number; frac: number }) {
  const start = index * 0.08;
  const style = useAnimatedStyle(() => {
    const local = interpolate(progress.value, [start, start + 0.4], [0, 1], Extrapolation.CLAMP);
    return { height: Math.max(4, frac * CHART_H * local) };
  });
  // The final (tallest) bar is the "new PR" — full accent; the rest sit back.
  const isPeak = index === BARS.length - 1;
  return (
    <Reanimated.View
      style={[styles.bar, { backgroundColor: ACCT, opacity: isPeak ? 1 : 0.45 }, style]}
    />
  );
}

export default function ProgressMockup({ dark, active }: MockupProps) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = active ? withTiming(1, { duration: 1100 }) : 0;
  }, [active]);

  const chipStyle = useAnimatedStyle(() => {
    const c = interpolate(progress.value, [0.7, 1], [0, 1], Extrapolation.CLAMP);
    return { opacity: c, transform: [{ scale: 0.8 + c * 0.2 }] };
  });

  return (
    <NeuCard dark={dark} style={styles.card}>
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.label, { color: t.ts }]}>BENCH PRESS</Text>
            <Text style={[styles.value, { color: t.tp }]}>Weight trending up</Text>
          </View>
          <Reanimated.View style={[styles.chip, chipStyle]}>
            <Ionicons name="trending-up" size={13} color="#fff" />
            <Text style={styles.chipText}>+24%</Text>
          </Reanimated.View>
        </View>

        <View style={[styles.chart, { height: CHART_H }]}>
          {BARS.map((frac, i) => (
            <Bar key={i} progress={progress} index={i} frac={frac} />
          ))}
        </View>
        <View style={[styles.baseline, { backgroundColor: t.div }]} />
        <View style={styles.weekRow}>
          {BARS.map((_, i) => (
            <Text key={i} style={[styles.weekLabel, { color: t.ts }]}>wk{i + 1}</Text>
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  card:     { width: 280, borderRadius: 22 },
  inner:    { padding: 16 },
  topRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 },
  label:    { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1.2 },
  value:    { fontFamily: FontFamily.bold, fontSize: 15, marginTop: 3 },
  chip:     { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: ACCT, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff" },
  chart:     { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  bar:       { flex: 1, borderRadius: 6 },
  baseline:  { height: 2, borderRadius: 1, marginTop: 6 },
  weekRow:   { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 6 },
  weekLabel: { flex: 1, textAlign: "center", fontFamily: FontFamily.semibold, fontSize: 9, letterSpacing: 0.2 },
});
