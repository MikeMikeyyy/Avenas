// The whole program at a glance: every day in the cycle, and under each one the
// names of its exercises. No sets, no reps, no weights.
//
// The full view (components/ProgramSnapshotView.tsx) answers "how is this day
// programmed"; this answers "what is in this program", which is the question
// you have when a trainer sends you something eight days long and you want to
// know what it covers before reading any of it. Same idea as the program
// builder's Workout Summary sheet, and deliberately the same shape on screen —
// but read-only: nothing here reorders, edits or removes.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import SimpleSheet from "./trainer/SimpleSheet";
import BounceButton from "./BounceButton";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../constants/theme";
import { pill, PILL_H_SM } from "../constants/buttons";
import { workoutKey } from "../utils/programDays";
import type { SavedProgram } from "../constants/programs";

export default function ProgramSummarySheet({ visible, snapshot, isDark, onClose }: {
  visible: boolean;
  snapshot: SavedProgram;
  isDark: boolean;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const divider = isDark ? "rgba(255,255,255,0.12)" : t.div;

  const days = snapshot.cyclePattern.map((dayName, i) => {
    const isRest = !dayName || dayName.toLowerCase() === "rest";
    return {
      i,
      label: isRest ? "Rest" : dayName,
      isRest,
      exercises: isRest ? [] : (snapshot.workouts[workoutKey(i, dayName)] ?? []),
    };
  });

  const trainingCount = days.filter(d => !d.isRest).length;
  const totalEx = days.reduce((n, d) => n + d.exercises.length, 0);

  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={[styles.header, { borderBottomColor: divider }]}>
        <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>Workout Summary</Text>
        <Text style={[styles.subtitle, { color: t.ts }]} numberOfLines={1}>
          {trainingCount} training day{trainingCount === 1 ? "" : "s"} · {totalEx} exercise{totalEx === 1 ? "" : "s"}
        </Text>
      </View>

      <ScrollView
        style={{ maxHeight: 420 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {days.map((d, idx) => (
          <View
            key={d.i}
            style={[styles.dayBlock, idx < days.length - 1 && { borderBottomWidth: 1, borderBottomColor: divider }]}
          >
            <View style={styles.dayRow}>
              <View style={[styles.numChip, { backgroundColor: d.isRest
                ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)")
                : `${ACCT}18` }]}
              >
                <Text style={[styles.num, { color: d.isRest ? t.ts : ACCT }]}>{d.i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dayName, { color: d.isRest ? t.ts : t.tp }]} numberOfLines={1}>{d.label}</Text>
                {!d.isRest && (
                  <Text style={[styles.dayMeta, { color: t.ts }]} numberOfLines={1}>
                    {d.exercises.length} exercise{d.exercises.length === 1 ? "" : "s"}
                  </Text>
                )}
              </View>
              {d.isRest && <Ionicons name="moon-outline" size={15} color={t.ts} />}
            </View>
            {!d.isRest && (
              d.exercises.length === 0 ? (
                <Text style={[styles.empty, { color: t.ts }]}>No exercises</Text>
              ) : (
                <View style={styles.exerciseList}>
                  {d.exercises.map((ex, ei) => (
                    <Text
                      key={ex.id ?? `${ei}-${ex.name}`}
                      style={[styles.exercise, { color: t.ts }]}
                      numberOfLines={1}
                    >
                      · {ex.name}
                    </Text>
                  ))}
                </View>
              )
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.doneRow}>
        <BounceButton
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onClose(); }}
          accessibilityLabel="Done"
          accessibilityRole="button"
        >
          <View style={[styles.doneBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }]}>
            <Text style={[styles.doneText, { color: t.tp }]}>Done</Text>
          </View>
        </BounceButton>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:       { alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  title:        { fontFamily: FontFamily.bold, fontSize: 16 },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  list:         { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  dayBlock:     { paddingVertical: 12 },
  dayRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  numChip:      { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  num:          { fontFamily: FontFamily.bold, fontSize: 13 },
  dayName:      { fontFamily: FontFamily.semibold, fontSize: 15 },
  dayMeta:      { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  exerciseList: { marginTop: 6, paddingLeft: 36, gap: 2 },
  exercise:     { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  empty:        { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", marginTop: 6, paddingLeft: 36 },
  doneRow:      { paddingHorizontal: 20, paddingTop: 10 },
  doneBtn:      { ...pill(PILL_H_SM) },
  doneText:     { fontFamily: FontFamily.bold, fontSize: 15 },
});
