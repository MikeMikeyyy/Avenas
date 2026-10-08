// utils/holdMigration.ts
//
// One-shot backfill that marks the timed holds (a plank) in sessions logged
// before a session recorded them (CompletedExercise.isIsometric), from the
// program they were done on. A hold's "reps" are seconds, so until then every
// plank added its seconds to the Progress page's Reps bars.
//
// An exercise is a hold when the program says so (Exercise.isIsometric) for:
//   1. its place (programExerciseId), done as itself: a swap-in kept the place
//      but isn't the program's exercise, so it's left as it was; else
//   2. the same exercise on the session's day, by name (sessions saved before
//      places were recorded).
// Free workouts, and sessions whose program or day is gone, are left alone:
// nothing says what their exercises were. Same safety as the other one-shot
// migrations (utils/dayIdMigration.ts): history and the done-flag commit in one
// AsyncStorage.multiSet.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type Exercise,
  type SavedProgram,
} from "../constants/programs";
import { indexOfDayId, workoutKey } from "./programDays";

export const HOLD_MIGRATION_KEY = "@avenas/hold_migration_done";

const norm = (s: string) => s.trim().toLowerCase();

/** The exercises a program prescribes on the slot `dayId`. */
function exercisesOn(program: SavedProgram, dayId: string): Exercise[] {
  const index = indexOfDayId(program, dayId);
  if (index < 0) return [];
  return program.workouts[workoutKey(index, (program.cyclePattern[index] ?? "").trim() || "Workout")] ?? [];
}

/** `history` with every hold its programs can vouch for marked. Pure; a
 *  session with nothing to mark comes back as the same object. */
export function stampHolds(history: CompletedWorkout[], programs: SavedProgram[]): CompletedWorkout[] {
  const byId = new Map(programs.map(p => [p.id, p]));
  return history.map(w => {
    const program = w.programId ? byId.get(w.programId) : undefined;
    if (!program) return w;
    const everywhere = Object.values(program.workouts).flat();
    const onDay = w.dayId ? exercisesOn(program, w.dayId) : [];
    let changed = false;
    const exercises = w.exercises.map(ex => {
      if (ex.isIsometric) return ex;
      const atPlace = ex.programExerciseId ? everywhere.find(e => e.id === ex.programExerciseId) : undefined;
      const source = atPlace && norm(atPlace.name) === norm(ex.name)
        ? atPlace
        : onDay.find(e => norm(e.name) === norm(ex.name));
      if (!source?.isIsometric) return ex;
      changed = true;
      return { ...ex, isIsometric: true as const };
    });
    return changed ? { ...w, exercises } : w;
  });
}

/** Run the backfill once. No-op after the first successful run. Awaited at
 *  startup, after the day id backfill, before any screen reads history. */
export async function runHoldMigrationIfNeeded(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(HOLD_MIGRATION_KEY);
    if (done === "1") return;
    const [progRaw, histRaw] = await Promise.all([
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
    ]);
    const pairs: [string, string][] = [];
    if (histRaw) {
      const programs: SavedProgram[] = progRaw ? JSON.parse(progRaw) : [];
      const history: CompletedWorkout[] = JSON.parse(histRaw);
      pairs.push([WORKOUT_HISTORY_KEY, JSON.stringify(stampHolds(history, programs))]);
    }
    pairs.push([HOLD_MIGRATION_KEY, "1"]);
    await AsyncStorage.multiSet(pairs);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] hold migration", e);
  }
}
