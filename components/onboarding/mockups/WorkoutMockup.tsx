import { View, Text, StyleSheet } from "react-native";
import { useEffect } from "react";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, interpolate, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import NeuCard from "../../NeuCard";
import ExerciseImage from "../../ExerciseImage";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../../constants/theme";

// Illustrative "log a set" card — set rows fade up and tick off in sequence
// when the slide becomes active. Non-interactive; no real workout data.
const SETS = [
  { label: "Set 1", detail: "60 kg × 10" },
  { label: "Set 2", detail: "65 kg × 8" },
  { label: "Set 3", detail: "70 kg × 6" },
];

interface MockupProps {
  dark: boolean;
  active: boolean;
}

function SetRow({
  progress, index, dark, label, detail,
}: { progress: SharedValue<number>; index: number; dark: boolean; label: string; detail: string }) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const start = 0.1 + index * 0.22;

  const rowStyle = useAnimatedStyle(() => {
    const local = interpolate(progress.value, [start, start + 0.2], [0, 1], Extrapolation.CLAMP);
    return { opacity: local, transform: [{ translateY: (1 - local) * 14 }] };
  });
  const checkStyle = useAnimatedStyle(() => {
    const c = interpolate(progress.value, [start + 0.14, start + 0.3], [0, 1], Extrapolation.CLAMP);
    return { opacity: c, transform: [{ scale: c }] };
  });

  return (
    <Reanimated.View style={[styles.setRow, { backgroundColor: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)" }, rowStyle]}>
      <Text style={[styles.setLabel, { color: t.ts }]}>{label}</Text>
      <Text style={[styles.setDetail, { color: t.tp }]}>{detail}</Text>
      <Reanimated.View style={[styles.check, checkStyle]}>
        <Ionicons name="checkmark" size={13} color="#fff" />
      </Reanimated.View>
    </Reanimated.View>
  );
}

export default function WorkoutMockup({ dark, active }: MockupProps) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = active ? withTiming(1, { duration: 1200 }) : 0;
  }, [active]);

  return (
    <NeuCard dark={dark} style={styles.card}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <ExerciseImage
            exerciseId="barbell-bench-press"
            variant="thumb"
            size={48}
            radius={12}
            backgroundColor={t.div}
            fallbackColor={t.icon}
          />
          <View style={styles.headerText}>
            <Text style={[styles.exName, { color: t.tp }]} numberOfLines={1}>Bench Press</Text>
            <Text style={[styles.exSub, { color: t.ts }]} numberOfLines={1}>Chest · Barbell</Text>
          </View>
        </View>

        <View style={styles.sets}>
          {SETS.map((s, i) => (
            <SetRow key={s.label} progress={progress} index={i} dark={dark} label={s.label} detail={s.detail} />
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  card:       { width: 280, borderRadius: 22 },
  inner:      { padding: 16, gap: 14 },
  header:     { flexDirection: "row", alignItems: "center", gap: 12 },
  headerText: { flex: 1 },
  exName:     { fontFamily: FontFamily.bold, fontSize: 17 },
  exSub:      { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  sets:       { gap: 8 },
  setRow:     { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  setLabel:   { fontFamily: FontFamily.semibold, fontSize: 13, width: 48 },
  setDetail:  { fontFamily: FontFamily.semibold, fontSize: 14, flex: 1 },
  check:      { width: 22, height: 22, borderRadius: 11, backgroundColor: ACCT, alignItems: "center", justifyContent: "center" },
});
