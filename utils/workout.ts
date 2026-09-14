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

import { parseStoredDate, toYMD, todayYMD } from "./dates";
import { dayIdAt, indexOfDayId, normalizeDayName, programDays, workoutKey } from "./programDays";
import type { CompletedWorkout, Exercise, SavedProgram } from "../constants/programs";

export type ResolvedWorkout = {
  /** Index into cyclePattern. -1 when resolved from a free-workout override
   *  whose name isn't a day in the program (so there are no program exercises). */
  dayIndex: number;
  name: string;
  exercises: Exercise[];
  /** Id of the program the exercises came from. Undefined when the workout
   *  matched no program (free-workout override, or its source program is gone). */
  programId?: string;
  /** Stable id of the cycle slot these exercises came from — what a completed
   *  session records so it stays attached to this day across a rename, and so
   *  two same-named days never share progress. Undefined alongside programId. */
  dayId?: string;
};

export type DayOverride = {
  date: string;
  workoutName: string;
  /** The program the chosen day belongs to. Set by change-day when the user
   *  picks a day (possibly from a NON-active program); absent on free-workout
   *  overrides and on overrides written before this field existed — those
   *  resolve against the active program, as before. */
  programId?: string;
  /** The chosen day's stable slot id. Set by change-day so a cycle with two
   *  same-named days resolves to the slot the user actually tapped — a name
   *  lookup always returned the first one. Absent on free-workout overrides
   *  and legacy records, which fall back to matching by name. */
  dayId?: string;
};

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
  // A held program schedules nothing from the pause date onward. This is the
  // single chokepoint: getWorkoutForDate, getTodaysWorkout, resolveWorkoutForDate
  // and resolveTodayWorkout all funnel through here, and Home, the Workout tab
  // and the notification scheduler funnel through those.
  //
  // Bounded at >= pausedAt rather than blanket-null so dates BEFORE the pause
  // still resolve — Home's weekly strip and history must not rewrite themselves
  // when a program is paused. Both sides are "YYYY-MM-DD", so a string compare
  // is a date compare.
  if (program.pausedAt && dateYMD >= program.pausedAt) return null;
  return cycleIndexForDate(program, dateYMD);
}

/**
 * The raw cycle index for `dateYMD`, ignoring any hold on the program.
 *
 * Scheduling must respect a hold — that's `resolveDayIndex` above — but the
 * one-shot dayId backfill asks a different question: "which slot was this
 * session, already logged on this date, performed on?" A hold applied later
 * must not erase the answer, so the backfill reads the cycle math directly.
 */
export function cycleIndexForDate(program: SavedProgram, dateYMD: string): number | null {
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
  const exercises = program.workouts[workoutKey(dayIndex, name)] ?? [];
  return { dayIndex, name, exercises, programId: program.id, dayId: dayIdAt(program, dayIndex) };
}

/** The program's scheduled workout for today (local date). */
export function getTodaysWorkout(program: SavedProgram): ResolvedWorkout | null {
  return getWorkoutForDate(program, todayYMD());
}

/**
 * The workout scheduled for `dateYMD`, taking a change-day / free-workout
 * override into account. The override is honored only when its date matches
 * `dateYMD` (stale overrides from another day are ignored). A `"Rest"` override
 * resolves to null (the user explicitly changed today onto a rest day).
 *
 * The override's day is resolved against its SOURCE program: `override.programId`
 * looked up in `allPrograms` when it names a non-active program (change-day can
 * pick a day from any program), else the active `program`. When the source
 * program can't be found — free-workout override, no programId, deleted program,
 * or `allPrograms` not supplied — the name is surfaced with no exercises (or
 * against the active program's same-named day, matching pre-programId behavior).
 *
 * Inside that program the slot is found by `override.dayId` when the override
 * carries one. Falling back to `cyclePattern.indexOf(name)` — the only option
 * for a free-workout or pre-dayId override — always lands on the FIRST day with
 * that name, which is wrong whenever a cycle schedules the same name twice.
 *
 * Callers should pass the effective training date (see getEffectiveToday) as
 * `dateYMD`, not the raw calendar date, so late-night sessions resolve to the
 * right day.
 */
export function resolveWorkoutForDate(
  program: SavedProgram | null,
  override: DayOverride | null,
  dateYMD: string,
  allPrograms?: SavedProgram[],
): ResolvedWorkout | null {
  if (override && override.date === dateYMD) {
    const name = override.workoutName;
    if (name === "Rest") return null;
    const src =
      override.programId && override.programId !== program?.id
        ? allPrograms?.find(p => p.id === override.programId) ?? null
        : program;
    if (src) {
      const byId = override.dayId ? indexOfDayId(src, override.dayId) : -1;
      const dayIndex = byId >= 0 ? byId : src.cyclePattern.indexOf(name);
      const label = dayIndex >= 0 ? (src.cyclePattern[dayIndex] ?? name) : name;
      const exercises = dayIndex >= 0 ? (src.workouts[workoutKey(dayIndex, label)] ?? []) : [];
      return {
        dayIndex,
        // A day resolved by id shows its CURRENT name, so a rename since the
        // override was written surfaces the new label rather than the stale one.
        name: label,
        exercises,
        programId: dayIndex >= 0 ? src.id : undefined,
        dayId: dayIndex >= 0 ? dayIdAt(src, dayIndex) : undefined,
      };
    }
    return { dayIndex: -1, name, exercises: [] };
  }
  return program ? getWorkoutForDate(program, dateYMD) : null;
}

/**
 * Today's workout taking a change-day / free-workout override into account.
 * Thin wrapper over resolveWorkoutForDate for the raw calendar date — prefer
 * resolveWorkoutForDate(program, override, getEffectiveToday(...)) so late-night
 * sessions are handled.
 */
export function resolveTodayWorkout(
  program: SavedProgram | null,
  override: DayOverride | null,
  allPrograms?: SavedProgram[],
): ResolvedWorkout | null {
  return resolveWorkoutForDate(program, override, todayYMD(), allPrograms);
}

/**
 * Local hour before which a session still "belongs" to the previous calendar
 * day. A workout logged or in progress between midnight and this hour counts as
 * the prior day's training, matching how late-night lifters think about it.
 */
export const LATE_NIGHT_GRACE_HOUR = 3;

/**
 * The training day the app should treat as "today" for scheduling and for the
 * completed-workout lookup. This is the local calendar date, with one twist for
 * the small hours: before LATE_NIGHT_GRACE_HOUR we keep treating the session as
 * *yesterday* while yesterday's scheduled workout is still unfinished, so a 1-2am
 * lifter isn't bumped onto the next day mid-session.
 *
 * It uses the real calendar date as soon as any of these hold:
 *   - it's at/after the grace cutoff,
 *   - there's no active program, or yesterday was a rest day (nothing to hold), or
 *   - yesterday's workout has already been logged.
 *
 * That last rule is what makes "finished last night → today is a rest day" roll
 * over immediately instead of pinning yesterday's completed workout in place.
 *
 * Pure + RN-free so it can be unit-tested (see scripts/verify-data-layer.ts).
 */
export function getEffectiveToday(
  program: SavedProgram | null,
  history: CompletedWorkout[],
  now: Date = new Date(),
): string {
  const todayStr = toYMD(now);
  if (now.getHours() >= LATE_NIGHT_GRACE_HOUR) return todayStr;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = toYMD(yesterday);
  // Nothing to extend if there's no program or yesterday wasn't a training day.
  if (!program || !getWorkoutForDate(program, yStr)) return todayStr;
  // Already trained yesterday → don't keep showing it; roll over now.
  if (history.some(w => w.date === yStr)) return todayStr;
  return yStr;
}

/** Canonical key for matching an exercise across sessions — trimmed + lowercased
 *  so "Bench Press" and "bench press" resolve to the same previous values. */
export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The workout day a previous-values lookup is scoped to. A narrow view of
 * `ProgramDayRef` so the two screens that build one don't have to synthesize a
 * full ref — but the matching rules are deliberately identical to
 * `workoutMatchesDay` (utils/progressStats.ts), because "which day was this
 * session performed on" must have exactly one answer app-wide.
 */
export type PrevDayScope = {
  /** Display name of the day. The only handle for sessions with no `dayId`. */
  name: string;
  /** The day's stable slot id, when it has one (absent for a free workout). */
  dayId?: string;
  /** The program the day belongs to. Required to scope the positional fallback
   *  ids (`d0`, `d1`, …), which are only unique WITHIN one program — without it
   *  an old program's slot `d3` matches the current program's slot `d3`. */
  programId?: string;
  /** False when an earlier day of the program already carries this name, so a
   *  session that recorded no `dayId` attaches to that day and not to this one.
   *  See `ProgramDayRef.absorbsUnidentified`. */
  absorbsUnidentified?: boolean;
};

/** Was completed session `w` performed on `day`? Mirrors `workoutMatchesDay`. */
function sessionIsOnDay(w: CompletedWorkout, day: PrevDayScope): boolean {
  // Program scoping first, so it covers both branches below. "" = free workout:
  // it belongs to no program, so it isn't excluded by the guard.
  if (w.programId && day.programId && w.programId !== day.programId) return false;
  // Both sides identified → exact slot match. Two days sharing a name never
  // trade numbers, and a renamed day still finds its own history.
  if (w.dayId && day.dayId) return w.dayId === day.dayId;
  if (normalizeDayName(w.workoutName ?? "") !== normalizeDayName(day.name)) return false;
  // The session can't say WHICH same-named day it was performed on (legacy
  // record the backfill couldn't attribute, or a free workout). It attaches to
  // the first day carrying the name and to no other — otherwise the second
  // "Upper" would show numbers that were actually lifted on the first.
  return day.absorbsUnidentified !== false;
}

/**
 * The previous-values scope for a resolved workout, resolving
 * `absorbsUnidentified` against the day's own program. Pass the program the
 * workout came from (`resolvedWorkout.programId` looked up in the stored list);
 * a free workout, or a day whose program is gone, absorbs unidentified sessions
 * since there is no sibling day to lose them to.
 */
export function prevDayScopeFor(
  workout: { name: string; programId?: string; dayId?: string },
  program?: SavedProgram | null,
): PrevDayScope {
  const scope: PrevDayScope = {
    name: workout.name,
    dayId: workout.dayId,
    programId: workout.programId,
    absorbsUnidentified: true,
  };
  if (!program || !workout.dayId) return scope;
  // programDays() comes back already marked, in cycle order.
  const ref = programDays(program).find(d => d.dayId === workout.dayId);
  if (ref) scope.absorbsUnidentified = ref.absorbsUnidentified;
  return scope;
}

/**
 * Map of normalized exercise name → that exercise's set list from the most
 * recent prior session, formatted as "weight×reps" (or weight/reps/"—").
 * History is sorted newest-first, so the first time a name is seen wins.
 * When `beforeDate` (a "YYYY-MM-DD") is given, only sessions strictly before it
 * are considered — used when logging a past workout. We compare on the workout's
 * local `date` (also "YYYY-MM-DD"), NOT the ISO `completedAt` timestamp: in a
 * positive-UTC timezone a session's completedAt can roll back to the previous
 * UTC day, so a string compare against the local `beforeDate` would wrongly
 * include a same-day session. Comparing local date to local date is exact.
 *
 * When `day` is given the walk is restricted to sessions performed on THAT day
 * (see `sessionIsOnDay`) — strictly, with no any-day fallback. An exercise
 * programmed on two days (Lateral Raise on both Push and Arms, or a push
 * movement on both of two days called "Upper") shows the numbers it was last
 * lifted at on the day in front of the user, and shows nothing at all until it
 * has been logged there. Borrowing another day's numbers reads identically to
 * the day's own, which is exactly how the second "Upper" came to display the
 * first one's weights.
 *
 * Omit `day` for the day-agnostic map (most recent appearance anywhere).
 */
export function buildPrevByName(
  history: CompletedWorkout[],
  beforeDate?: string,
  day?: PrevDayScope,
): Record<string, string[]> {
  const sorted = [...history].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const out: Record<string, string[]> = {};
  for (const workout of sorted) {
    if (beforeDate && !(workout.date < beforeDate)) continue;
    if (day && !sessionIsOnDay(workout, day)) continue;
    for (const ex of workout.exercises) {
      const key = normalizeExerciseName(ex.name);
      if (out[key]) continue; // newest session wins
      out[key] = ex.sets.map(s => {
        if (s.weight && s.reps) return `${s.weight}×${s.reps}`;
        return s.weight || s.reps || "—";
      });
    }
  }
  return out;
}
