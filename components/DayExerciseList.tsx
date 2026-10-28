import { useState, useMemo, useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing as ReEasing,
} from "react-native-reanimated";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import SheetPill from "./SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { collectLoggedExercisesForDay, sessionCountForDay } from "../utils/progressStats";
import type { CompletedWorkout, ProgramDayRef } from "../constants/programs";
import type { ExerciseSelection, LoggedExerciseRow } from "../constants/progress";
import type { CustomExercise } from "../constants/exercises";
import { exerciseIdentity, type ExerciseRef } from "../utils/exerciseNames";
import { isDeletedExercise } from "../utils/customExercises";
import { displayWorkoutName } from "../utils/programDays";

interface Props {
  /** Every non-Rest day of the in-scope program(s), as identified refs. Two
   *  days that share a name are two entries here, not one. */
  days: ProgramDayRef[];
  /** Workouts already filtered to the active scope. */
  workouts: CompletedWorkout[];
  /**
   * Currently selected (day, exercise) pair, or null. The day is part of the
   * identity: the same exercise under a different day row is a different
   * selection and does NOT highlight — including under a day that merely
   * shares the selected day's name.
   */
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, ex: ExerciseRef) => void;
  /** Every custom exercise the rows can be (knownCustomExercises), deleted ones
   *  included: a deleted one's row says so. */
  customExercises: CustomExercise[];
  /** The open day row (ProgramDayRef.key), or null. Keyed by the ref, not the
   *  name, so two "Upper" rows expand independently. Held by the page, which
   *  remembers it between visits (utils/progressSession.ts). */
  expandedDay: string | null;
  onExpandedDayChange: (key: string | null) => void;
}

const sessionsText = (n: number) => (n === 0 ? "No sessions yet" : `${n} session${n === 1 ? "" : "s"}`);

/** Extra line under a day's name. Explains a day that has left the program, and
 *  otherwise disambiguates two days that read alike. */
function dayQualifier(day: ProgramDayRef): string | null {
  // A day of Custom workouts that was a program's says whose (user request,
  // 2026-10-23), by name when it was kept as the program was deleted.
  if (day.custom) {
    if (day.custom.programName) return `From ${day.custom.programName}`;
    return day.custom.deletedProgram ? "From a deleted program" : null;
  }
  // Always shown for a historical day: it's the answer to "why are there two
  // Upper rows?", and it has to read even when the label happens to be unique.
  if (day.isHistorical) return "No longer in your program";
  if (!day.duplicateLabel) return null;
  if (day.index < 0) return `${day.programName} · extra`;
  return `${day.programName} · day ${day.index + 1}`;
}

// Accordion panel — animates height between 0 and the children's measured
// natural height. The content view is absolutely positioned, so it always lays
// out at its natural height even while the animated container clips it; its
// onLayout re-measures on EVERY content change, not just the first. That
// re-measure is load-bearing here: the Progress tab stays mounted for days
// while new workouts land, so a measure-once panel (the pattern programs.tsx
// uses for its static content) freezes at the row count it had on first render
// and clips newly logged exercises out of view.
//
// A panel that's ALREADY open when it mounts (the page coming back to a day it
// was left on) appears open: its first measurement is snapped to rather than
// animated, since nothing was tapped. Every later change animates.
//
// Also the muscle groups' panel under "All programs" (progress/AllExercisesList).
export function ExpandablePanel({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  const height = useSharedValue(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const openedOnMount = useRef(expanded);

  useEffect(() => {
    if (openedOnMount.current && expanded) {
      // Wait for the content's height, then take it without animating.
      if (measuredHeight === 0) return;
      openedOnMount.current = false;
      height.value = measuredHeight;
      return;
    }
    openedOnMount.current = false;
    height.value = withTiming(expanded ? measuredHeight : 0, {
      duration: 280,
      easing: ReEasing.out(ReEasing.cubic),
    });
  }, [expanded, measuredHeight, height]);

  const style = useAnimatedStyle(() => ({ height: height.value, overflow: "hidden" as const }));

  return (
    <Reanimated.View style={style}>
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setMeasuredHeight(prev => (prev === h ? prev : h));
        }}
      >
        {children}
      </View>
    </Reanimated.View>
  );
}

export const RotatingChevron = ({ color, rotated }: { color: string; rotated: boolean }) => {
  const r = useSharedValue(rotated ? 1 : 0);
  useEffect(() => {
    r.value = withTiming(rotated ? 1 : 0, { duration: 180 });
  }, [rotated, r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 90}deg` }] }));
  return (
    <Reanimated.View style={style}>
      <Ionicons name="chevron-forward" size={16} color={color} />
    </Reanimated.View>
  );
};

/**
 * An exercise in the Exercise Progress list: a pill, the white control-surface
 * button the Trainer page puts inside its cards; the one being charted is
 * `selected` (accent ring + tick). Under a day and under "All programs" alike.
 */
export function ExercisePill({ row, deleted, selected, onPress }: {
  row: LoggedExerciseRow;
  /** A deleted custom exercise (utils/customExercises.ts isDeletedExercise). */
  deleted: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // A deleted custom exercise is out of every program, so it would read
  // "Swapped out"; it says what happened instead, which also tells it apart
  // from a new exercise later given its name.
  const note = deleted ? "Deleted" : row.inProgram ? null : "Swapped out";
  return (
    <SheetPill
      compact
      label={row.name}
      selected={selected}
      onPress={onPress}
      accessibilityLabel={
        deleted ? `${row.name}, a deleted exercise`
          : row.inProgram ? row.name
            : `${row.name}, swapped out of this day`
      }
      accessibilityState={{ selected }}
      badge={note ? (
        // Logged on this day, but the program doesn't prescribe it any
        // more. Shown so a trend that stops mid-run reads as a change to
        // the programming rather than as someone quietly dropping the
        // exercise. Deliberately quiet — a soft fill and the muted text
        // colour, never the accent — so it annotates the row instead of
        // flagging it as a problem.
        <View style={[styles.swappedChip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)" }]}>
          <Ionicons name={deleted ? "trash-outline" : "swap-horizontal"} size={11} color={t.ts} />
          <Text style={[styles.swappedText, { color: t.ts }]}>{note}</Text>
        </View>
      ) : null}
    />
  );
}

/**
 * Drill-down list of workout days. Each day row is tappable and expands to
 * reveal the exercises that have been logged on that day name across the
 * in-scope completed workouts. Tapping an exercise selects it (the parent
 * Progress screen will render the per-exercise progression chart).
 *
 * For one program and for Custom workouts. "All programs" lists every
 * exercise instead, in muscle groups (components/progress/AllExercisesList.tsx).
 */
export default function DayExerciseList({
  days,
  workouts,
  selectedExercise,
  onSelectExercise,
  customExercises,
  expandedDay,
  onExpandedDayChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Precompute counts per day so the row labels are stable.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.key, sessionCountForDay(workouts, d));
    return m;
  }, [days, workouts]);

  if (days.length === 0) {
    return (
      <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 36 }}>
        <View style={styles.empty}>
          <DumbbellIcon size={28} color={t.ts} />
          <Text style={[styles.emptyText, { color: t.ts }]}>No workout days yet.</Text>
        </View>
      </NeuCard>
    );
  }

  return (
    <View style={{ marginHorizontal: 20, marginTop: 36 }}>
      <Text style={[styles.sectionTitle, { color: t.tp }]}>Exercise Progress</Text>

      {days.map((day, i) => (
        <View key={day.key} style={{ marginTop: i === 0 ? 0 : 12 }}>
          <NeuCard dark={isDark} radius={20}>
            <DayRow
              day={day}
              sessions={counts.get(day.key) ?? 0}
              open={expandedDay === day.key}
              onToggle={() => onExpandedDayChange(expandedDay === day.key ? null : day.key)}
              workouts={workouts}
              selectedExercise={selectedExercise}
              onSelectExercise={onSelectExercise}
              customExercises={customExercises}
            />
          </NeuCard>
        </View>
      ))}
    </View>
  );
}

/** A day's row and, opened, the exercises logged on it, inside its own card. */
function DayRow({
  day,
  sessions,
  open,
  onToggle,
  workouts,
  selectedExercise,
  onSelectExercise,
  customExercises,
}: {
  day: ProgramDayRef;
  sessions: number;
  open: boolean;
  onToggle: () => void;
  workouts: CompletedWorkout[];
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, ex: ExerciseRef) => void;
  customExercises: CustomExercise[];
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const qualifier = dayQualifier(day);
  // A custom workout saved as "Custom WorkoutLegs" reads as "Legs".
  const label = displayWorkoutName(day.label);
  return (
    <>
      <BounceButton
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}${qualifier ? `, ${qualifier}` : ""}, ${sessions} session${sessions === 1 ? "" : "s"} logged`}
      >
        <View style={styles.dayRow}>
          <View style={styles.dayNameCol}>
            <Text style={[styles.dayName, { color: t.tp }]} numberOfLines={1}>{label}</Text>
            {qualifier ? (
              <Text style={[styles.dayQualifier, { color: t.ts }]} numberOfLines={1}>{qualifier}</Text>
            ) : null}
          </View>
          <Text style={[styles.daySub, { color: t.ts }]} numberOfLines={1}>{sessionsText(sessions)}</Text>
          <View style={{ flex: 1 }} />
          <RotatingChevron color={t.ts} rotated={open} />
        </View>
      </BounceButton>

      <ExpandablePanel expanded={open}>
        <ExpandedExercises
          workouts={workouts}
          day={day}
          selectedExercise={selectedExercise}
          onSelectExercise={onSelectExercise}
          customExercises={customExercises}
          textSecondary={t.ts}
          divider={t.div}
        />
      </ExpandablePanel>
    </>
  );
}

function ExpandedExercises({
  workouts,
  day,
  selectedExercise,
  onSelectExercise,
  customExercises,
  textSecondary,
  divider,
}: {
  workouts: CompletedWorkout[];
  day: ProgramDayRef;
  selectedExercise: ExerciseSelection | null;
  onSelectExercise: (day: ProgramDayRef, ex: ExerciseRef) => void;
  customExercises: CustomExercise[];
  textSecondary: string;
  divider: string;
}) {
  const rows: LoggedExerciseRow[] = useMemo(
    () => collectLoggedExercisesForDay(workouts, day),
    [workouts, day],
  );

  if (rows.length === 0) {
    return (
      <View style={[styles.expandedBody, { borderTopColor: divider }]}>
        <Text style={[styles.placeholder, { color: textSecondary }]}>
          No exercises logged on this day yet.
        </Text>
      </View>
    );
  }

  // Highlight only within the selection's own day row — the same exercise
  // under another day is a different (day, exercise) pair, and so is the same
  // exercise under a day that merely reads the same. By identity, so a deleted
  // custom exercise and a new one given its name are two rows.
  const selKey =
    selectedExercise && selectedExercise.dayKey === day.key
      ? exerciseIdentity(selectedExercise)
      : "";

  return (
    <View style={[styles.expandedBody, { borderTopColor: divider }]}>
      {rows.map((r, i) => {
        const k = exerciseIdentity(r);
        return (
          <ExercisePill
            key={`${k}-${i}`}
            row={r}
            deleted={isDeletedExercise(r, customExercises)}
            selected={k === selKey}
            onPress={() => onSelectExercise(day, r)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: FontFamily.bold, fontSize: 18, lineHeight: 24, marginBottom: 12 },

  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  dayNameCol: { flexShrink: 1 },
  dayName: { fontFamily: FontFamily.bold, fontSize: 15 },
  dayQualifier: { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 1 },
  daySub: { fontFamily: FontFamily.regular, fontSize: 12 },

  // Padding on all sides leaves the pills' shadows room inside the panel's
  // clipped height.
  expandedBody: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  swappedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  swappedText: { fontFamily: FontFamily.semibold, fontSize: 10 },
  placeholder: { fontFamily: FontFamily.regular, fontSize: 13, paddingVertical: 8, textAlign: "center" },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },
});
