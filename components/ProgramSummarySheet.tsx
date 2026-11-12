// The whole program at a glance: every day in the cycle, and under each one the
// names of its exercises. No sets, no reps, no weights.
//
// The full view (components/ProgramSnapshotView.tsx) answers "how is this day
// programmed"; this answers "what is in this program", which is the question
// you have when a trainer sends you something eight days long and you want to
// know what it covers before reading any of it. Same idea as the program
// builder's Workout Summary sheet, and deliberately the same shape on screen —
// but read-only: nothing here reorders, edits or removes.
//
// The days alone are `ProgramSummaryDays`, for a sheet that shows them as one
// of its steps: My Programs' Program Summary, a step of a program's ··· sheet
// (user request, 2026-11-12).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SimpleSheet from "./trainer/SimpleSheet";
import NumberBadge from "./NumberBadge";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { workoutKey } from "../utils/programDays";
import type { SavedProgram } from "../constants/programs";

function summaryDays(snapshot: SavedProgram) {
  return snapshot.cyclePattern.map((dayName, i) => {
    const isRest = !dayName || dayName.toLowerCase() === "rest";
    return {
      i,
      label: isRest ? "Rest" : dayName,
      isRest,
      exercises: isRest ? [] : (snapshot.workouts[workoutKey(i, dayName)] ?? []),
    };
  });
}

/** "4 training days · 22 exercises": what the summary's days add up to. */
export function programSummaryLine(snapshot: SavedProgram): string {
  const days = summaryDays(snapshot);
  const trainingCount = days.filter(d => !d.isRest).length;
  const totalEx = days.reduce((n, d) => n + d.exercises.length, 0);
  return `${trainingCount} training day${trainingCount === 1 ? "" : "s"} · ${totalEx} exercise${totalEx === 1 ? "" : "s"}`;
}

/** Every day of the cycle with its exercises' names, in rows with a sheet's
 *  lines between them. Not scrolling: it goes in the sheet's own scroll. */
export function ProgramSummaryDays({ snapshot, isDark, style }: {
  snapshot: SavedProgram;
  isDark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The lines between the days: a sheet's (t.sheetLine). In light mode they
  // were t.div, which all but vanishes on a glass sheet, so the days ran
  // together (user request, 2026-11-06).
  const divider = t.sheetLine;
  const days = summaryDays(snapshot);

  return (
    <View style={[styles.list, style]}>
      {days.map((d, idx) => (
        <View
          key={d.i}
          style={[styles.dayBlock, idx < days.length - 1 && { borderBottomWidth: 1, borderBottomColor: divider }]}
        >
          <View style={styles.dayRow}>
            {/* The pop-ups' faded green number, its words' green so it reads
                (NumberBadge `wash`); a rest day's grey. */}
            <NumberBadge n={d.i + 1} isDark={isDark} size={26} wash muted={d.isRest} />
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
    </View>
  );
}

export default function ProgramSummarySheet({ visible, snapshot, isDark, onClose }: {
  visible: boolean;
  snapshot: SavedProgram;
  isDark: boolean;
  onClose: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  // The days go straight in the sheet, which stops below the status bar and
  // scrolls them (CLAUDE.md): they were in a box of their own, 420 high.
  return (
    <SimpleSheet visible={visible} onClose={onClose}>
      <View style={[styles.header, { borderBottomColor: t.sheetLine }]}>
        {/* The program's name, whole and wrapping, never cut short (user
            request, 2026-11-12: it said "Workout Summary", as the builder's). */}
        <Text style={[styles.title, { color: t.tp }]}>{snapshot.name.trim() || "Workout Summary"}</Text>
        <Text style={[styles.subtitle, { color: t.ts }]} numberOfLines={1}>
          {programSummaryLine(snapshot)}
        </Text>
      </View>
      <ProgramSummaryDays snapshot={snapshot} isDark={isDark} />
      {/* No Done: the glass X and a drag down close it, as every pop-up
          (user request, 2026-11-06). */}
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:       { alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  title:        { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  list:         { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  dayBlock:     { paddingVertical: 12 },
  dayRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  dayName:      { fontFamily: FontFamily.semibold, fontSize: 15 },
  dayMeta:      { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  exerciseList: { marginTop: 6, paddingLeft: 36, gap: 2 },
  exercise:     { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  empty:        { fontFamily: FontFamily.regular, fontSize: 13, fontStyle: "italic", marginTop: 6, paddingLeft: 36 },
});
