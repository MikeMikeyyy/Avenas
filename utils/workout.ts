// Single source of truth for two things every workout-facing screen needs:
//   1. Resolving which workout an active program schedules on a given day
//      (the "active program → today's workout" contract documented in CLAUDE.md).
//   2. Building the "previous values" map (last logged sets per exercise) from
//      completed-workout history.
//
// This module is RN-free: it imports only pure date helpers and *types*, so it
// can be unit-tested under plain node/tsx (see scripts/verify-data-layer.ts).
// Previously this logic was copy-pasted across home.tsx, workout.tsx and
// log-workout.tsx; keeping one copy stops the screens from drifting.

import { parseStoredDate, todayYMD } from "./dates";
import type { CompletedWorkout, Exercise, SavedProgram } from "../constants/programs";

export type ResolvedWorkout = {
  /** Index into cyclePattern. -1 when resolved from a free-workout override
   *  whose name isn't a day in the program (so there are no program exercises). */
  dayIndex: number;
  name: string;
  exercises: Exercise[];
};

export type DayOverride = { date: string; workoutName: string };

/** Parse a "YYYY-MM-DD" string to a local Date at midnight, or null. */
function ymdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The negative-safe cycle-day index for `dateYMD`, matching the documented
 * formula: `(((daysPassed + cycleOffset) mod cycleDays) + cycleDays) mod cycleDays`.
 * Returns null when the program's startDate is unparseable (never the Jan-year-0
 * fallback) or when `dateYMD` is before the program started.
 */
export function resolveDayIndex(program: SavedProgram, dateYMD: string): number | null {
  const start = parseStoredDate(program.startDate);
  const target = ymdToLocalDate(dateYMD);
  if (!start || !target) return null;
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const daysPassed = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (daysPassed < 0) return null;
  return (((daysPassed + (program.cycleOffset ?? 0)) % program.cycleDays) + program.cycleDays) % program.cycleDays;
}

/** The program's scheduled workout for `dateYMD`, or null for Rest/empty days,
 *  pre-start dates, or unparseable startDate. */
export function getWorkoutForDate(program: SavedProgram, dateYMD: string): ResolvedWorkout | null {
  const dayIndex = resolveDayIndex(program, dateYMD);
  if (dayIndex === null) return null;
  const name = program.cyclePattern[dayIndex];
  if (!name || name === "Rest") return null;
  const exercises = program.workouts[`${dayIndex}:${name}`] ?? [];
  return { dayIndex, name, exercises };
}

/** The program's scheduled workout for today (local date). */
export function getTodaysWorkout(program: SavedProgram): ResolvedWorkout | null {
  return getWorkoutForDate(program, todayYMD());
}

/**
 * Today's workout taking a change-day / free-workout override into account.
 * The override is honored only when `override.date === todayYMD()` (stale
 * overrides from a previous day are ignored). When the override names a day in
 * the program its exercises are used; otherwise (free workout, no program) the
 * name is surfaced with no exercises.
 */
export function resolveTodayWorkout(
  program: SavedProgram | null,
  override: DayOverride | null,
): ResolvedWorkout | null {
  if (override && override.date === todayYMD()) {
    const name = override.workoutName;
    if (program) {
      const dayIndex = program.cyclePattern.indexOf(name);
      const exercises = dayIndex >= 0 ? (program.workouts[`${dayIndex}:${name}`] ?? []) : [];
      return { dayIndex, name, exercises };
    }
    return { dayIndex: -1, name, exercises: [] };
  }
  return program ? getTodaysWorkout(program) : null;
}

/** Canonical key for matching an exercise across sessions — trimmed + lowercased
 *  so "Bench Press" and "bench press" resolve to the same previous values. */
export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Map of normalized exercise name → that exercise's set list from the most
 * recent prior session, formatted as "weight×reps" (or weight/reps/"—").
 * History is sorted newest-first, so the first time a name is seen wins.
 * When `beforeDate` (a "YYYY-MM-DD") is given, only sessions strictly before it
 * are considered — used when logging a past workout. (completedAt is an ISO
 * timestamp; since the bare date is a lexicographic prefix, same-day and later
 * sessions correctly sort as not-less-than `beforeDate`.)
 */
export function buildPrevByName(
  history: CompletedWorkout[],
  beforeDate?: string,
): Record<string, string[]> {
  const sorted = [...history].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const filtered = beforeDate ? sorted.filter(w => w.completedAt < beforeDate) : sorted;
  const result: Record<string, string[]> = {};
  for (const workout of filtered) {
    for (const ex of workout.exercises) {
      const key = normalizeExerciseName(ex.name);
      if (result[key]) continue;
      result[key] = ex.sets.map(s => {
        if (s.weight && s.reps) return `${s.weight}×${s.reps}`;
        return s.weight || s.reps || "—";
      });
    }
  }
  return result;
}
