import { View, Text, StyleSheet } from "react-native";
import { useEffect } from "react";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, interpolate, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import NeuCard from "../../NeuCard";
import FlameIcon from "../../FlameIcon";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../../constants/theme";
import { STREAK_TIERS } from "../../../constants/streakTiers";

// Illustrative streak — the flame pulses, the count fades in, and the week
// dots pop in one by one when the slide activates. Non-interactive.
// Colored to match the app's first flame tier (Orange) rather than the accent.
const FLAME = STREAK_TIERS[0].color;
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const FILLED = [true, true, true, true, true, false, false];

interface MockupProps {
  dark: boolean;
  active: boolean;
}

function Dot({
  progress, index, filled, dark, label,
}: { progress: SharedValue<number>; index: number; filled: boolean; dark: boolean; label: string }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const start = 0.3 + index * 0.07;
  const popStyle = useAnimatedStyle(() => {
    if (!filled) return { transform: [{ scale: 1 }] };
    const c = interpolate(progress.value, [start, start + 0.16], [0, 1], Extrapolation.CLAMP);
    return { transform: [{ scale: 0.5 + c * 0.5 }], opacity: 0.4 + c * 0.6 };
  });
  return (
    <View style={styles.dayCol}>
      <Reanimated.View
        style={[styles.dot, { backgroundColor: filled ? FLAME : t.div }, popStyle]}
      />
      <Text style={[styles.dayLabel, { color: t.ts }]}>{label}</Text>
    </View>
  );
}

export default function StreakMockup({ dark, active }: MockupProps) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = active ? withTiming(1, { duration: 1200 }) : 0;
  }, [active]);

  const countStyle = useAnimatedStyle(() => {
    const c = interpolate(progress.value, [0.05, 0.35], [0, 1], Extrapolation.CLAMP);
    return { opacity: c, transform: [{ translateY: (1 - c) * 8 }] };
  });

  return (
    <NeuCard dark={dark} style={styles.card}>
      <View style={styles.inner}>
        <FlameIcon size={72} color={FLAME} animated={active} />
        <Reanimated.View style={[styles.countRow, countStyle]}>
          <Text style={[styles.count, { color: t.tp }]}>12</Text>
          <Text style={[styles.countLabel, { color: t.ts }]}>day streak</Text>
        </Reanimated.View>
        <View style={styles.week}>
          {WEEK.map((label, i) => (
            <Dot key={i} progress={progress} index={i} filled={FILLED[i]} dark={dark} label={label} />
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  card:       { width: 280, borderRadius: 22 },
  inner:      { padding: 20, alignItems: "center", gap: 6 },
  countRow:   { alignItems: "center", marginTop: 4, marginBottom: 8 },
  count:      { fontFamily: FontFamily.bold, fontSize: 40, lineHeight: 46 },
  countLabel: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: -2 },
  week:       { flexDirection: "row", justifyContent: "space-between", alignSelf: "stretch", marginTop: 4 },
  dayCol:     { alignItems: "center", gap: 6 },
  dot:        { width: 18, height: 18, borderRadius: 9 },
  dayLabel:   { fontFamily: FontFamily.semibold, fontSize: 11 },
});
