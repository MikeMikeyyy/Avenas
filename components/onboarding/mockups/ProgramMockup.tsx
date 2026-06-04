import { View, Text, StyleSheet } from "react-native";
import { useEffect } from "react";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay,
} from "react-native-reanimated";
import NeuCard from "../../NeuCard";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../../constants/theme";

// Illustrative weekly cycle — an accent ring sweeps down the program days and
// settles on "today" (Legs) when the slide activates. Non-interactive.
const DAYS = [
  { day: "Day 1", name: "Push" },
  { day: "Day 2", name: "Pull" },
  { day: "Day 3", name: "Legs" },
  { day: "Day 4", name: "Rest" },
];
const TODAY_INDEX = 2;
const ROW_H = 46;
const ROW_GAP = 10;
const STEP = ROW_H + ROW_GAP;

interface MockupProps {
  dark: boolean;
  active: boolean;
}

export default function ProgramMockup({ dark, active }: MockupProps) {
  const t = dark ? APP_DARK : APP_LIGHT;
  const y = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      y.value = 0;
      return;
    }
    y.value = withSequence(
      withDelay(180, withTiming(STEP * 1, { duration: 240 })),
      withTiming(STEP * 3, { duration: 320 }),
      withDelay(140, withTiming(STEP * TODAY_INDEX, { duration: 340 })),
    );
  }, [active]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <NeuCard dark={dark} style={styles.card}>
      <View style={styles.inner}>
        <Text style={[styles.heading, { color: t.ts }]}>PUSH / PULL / LEGS</Text>
        <View style={styles.list}>
          <Reanimated.View
            pointerEvents="none"
            style={[styles.ring, ringStyle]}
          />
          {DAYS.map((d, i) => (
            <View key={d.day} style={[styles.row, i < DAYS.length - 1 && { marginBottom: ROW_GAP }]}>
              <View style={[styles.dot, { backgroundColor: d.name === "Rest" ? t.div : ACCT }]} />
              <View style={styles.rowText}>
                <Text style={[styles.dayLabel, { color: t.ts }]}>{d.day}</Text>
                <Text style={[styles.dayName, { color: t.tp }]}>{d.name}</Text>
              </View>
              {i === TODAY_INDEX && (
                <View style={styles.todayChip}>
                  <Text style={styles.todayText}>Today</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  card:      { width: 280, borderRadius: 22 },
  inner:     { padding: 16 },
  heading:   { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 1.4, marginBottom: 14 },
  list:      { position: "relative" },
  ring:      {
    position: "absolute", left: 0, right: 0, top: 0, height: ROW_H,
    borderRadius: 13, borderWidth: 1.5, borderColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  row:       { flexDirection: "row", alignItems: "center", height: ROW_H, paddingHorizontal: 12, gap: 12 },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  rowText:   { flex: 1 },
  dayLabel:  { fontFamily: FontFamily.regular, fontSize: 11 },
  dayName:   { fontFamily: FontFamily.bold, fontSize: 15, marginTop: 1 },
  todayChip: { backgroundColor: ACCT, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 3 },
  todayText: { fontFamily: FontFamily.bold, fontSize: 11, color: "#fff" },
});
