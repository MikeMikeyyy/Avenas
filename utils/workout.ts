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
import { cycleDrift } from "./cycleDrift";
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
  // A date the user explicitly marked as rest. Checked HERE and not in
  // cycleIndexForDate for the same reason the hold is: the dayId backfill asks
  // "which slot was this already-logged session performed on", and marking a
  // date off afterwards must not erase that answer.
  if (program.skippedDates?.includes(dateYMD)) return null;
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
  const daysPassed = daysSinceStart(program, dateYMD);
  if (daysPassed === null || daysPassed < 0) return null;
  // Shift the calendar by the net drift: pushed days held the cycle still,
  // pulled days spent a rest to catch it back up. Counting against DATES rather
  // than nudging cycleOffset is what keeps this local — an offset is a phase
  // shift over the whole timeline, which re-labelled days BEFORE the change and
  // swallowed a completed workout. See utils/cycleDrift.ts.
  return slotFor(program, daysPassed - cycleDrift(program, dateYMD));
}

/**
 * Whole days from the program's start to `dateYMD`, or null when either end is
 * unparseable. Negative before the program started.
 *
 * Rounds rather than floors. Both ends are LOCAL midnights, and a span that
 * crosses a daylight-saving transition is 23 or 25 hours on that day — flooring
 * the millisecond quotient silently drops a day, which shifted the whole cycle
 * one slot early for every date between the spring and autumn transitions.
 * `utils/dates.ts:daysBetweenYMD` has always done it this way; this is the same
 * arithmetic against a display-format start date.
 */
function daysSinceStart(program: SavedProgram, dateYMD: string): number | null {
  const start = parseStoredDate(program.startDate);
  const target = ymdToLocalDate(dateYMD);
  if (!start || !target) return null;
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/** The cycle slot `effectiveDays` lands on. Negative-safe, per CLAUDE.md. */
function slotFor(program: SavedProgram, effectiveDays: number): number {
  return ((effectiveDays + (program.cycleOffset ?? 0)) % program.cycleDays + program.cycleDays) % program.cycleDays;
}

/** Parse a "YYYY-MM-DD" string to a local Date at midnight, or null. */
function ymdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Bring a program's skip/push/pull marks back into a legal state.
 *
 * Every path that PERSISTS a program must run this, exactly as every path that
 * rebuilds a `WorkoutMap` must run `canonicalizeWorkouts` — same failure mode
 * (a stored date silently invalidated by a neighbouring edit) and same remedy.
 *
 * The invariant it restores: **every pulled date sits on a Rest**. A pull is
 * recorded against a rest day, but adding a push in front of it, editing the
 * cycle, changing the offset or resuming from a hold can all slide a workout
 * onto that date — and a pull there would delete a session. Rather than letting
 * the reader second-guess (which breaks the cycleOffset solve, see
 * utils/cycleDrift.ts), a stale pull is RE-TARGETED to the next rest day within
 * one cycle, and only dropped if the cycle has none. Re-targeting keeps the
 * user's intent — "I want that day back" — which going inert would silently
 * discard.
 *
 * Also keeps a pull off any date that is also a push, where the two are
 * meaningless together. A skip and a pull on one date are fine: the skip
 * empties the day, the pull still shifts the days after it.
 *
 * Pure. Returns the SAME object when nothing needed fixing, so callers can use
 * identity to skip a write.
 */
export function normalizeDriftDates(program: SavedProgram): SavedProgram {
  const pulled = program.pulledDates ?? [];
  if (pulled.length === 0) return program;

  const skipped = new Set(program.skippedDates ?? []);
  const pushed = new Set(program.pushedDates ?? []);
  const next: string[] = [];
  let changed = false;

  for (const ymd of [...pulled].sort()) {
    // A pull can't share a date with a PUSH — the push says "nothing happens
    // here, wait a day", the pull says "a rest was spent here, catch up a day",
    // and together they're meaningless. A SKIP is different and may stay: it
    // just empties that one day, while the pull still shifts the days after.
    // Dropping the pull there would silently un-absorb the move it belongs to
    // and push the rest of the program a day late.
    if (pushed.has(ymd)) { changed = true; continue; }
    // Evaluate candidates WITHOUT this pull applied. The question is "what does
    // this day hold today?" — a rest we may spend, or a session we must not —
    // and `cycleDrift` counts pulls inclusively, so including the candidate
    // would answer the day's content AFTER spending it, which is circular.
    const asIs = { ...program, pulledDates: next };
    let target: string | null = null;
    // Search from the date itself out to one full cycle: if the cycle has a rest
    // at all there is one within `cycleDays`, and if it has none there is none.
    for (let i = 0; i <= program.cycleDays; i++) {
      const candidate = addDaysYMD(ymd, i);
      if (candidate === null) break;
      if (pushed.has(candidate) || next.includes(candidate)) continue;
      // Re-targeting must not LAND a pull on a skipped day; a pull that was
      // already there when the day got skipped (i === 0) stays put.
      if (i > 0 && skipped.has(candidate)) continue;
      const slot = cycleIndexForDate(asIs, candidate);
      if (slot === null) continue;
      const name = program.cyclePattern[slot];
      if (!name || name === "Rest") { target = candidate; break; }
    }
    if (target === null) { changed = true; continue; }
    if (target !== ymd) changed = true;
    next.push(target);
  }

  if (!changed) return program;
  return { ...program, pulledDates: next.length > 0 ? next.sort() : undefined };
}

/** `ymd` plus `days`, as "YYYY-MM-DD". Null when `ymd` is unparseable. */
function addDaysYMD(ymd: string, days: number): string | null {
  const d = ymdToLocalDate(ymd);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return toYMD(d);
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
/**
 * Map of normalized exercise name → the note written on it LAST TIME, for the
 * "Last time" hint under an exercise's notes box.
 *
 * Same walk and same day scoping as `buildPrevByName`, and deliberately only
 * the MOST RECENT session that included the exercise: if you wrote a note in
 * week 1 and none in week 2, week 3 shows nothing. Older notes aren't lost, they
 * live in the journal with the session that recorded them. Carrying the newest
 * note forward instead would make a one-off remark ("shoulder twinge today")
 * follow you for months.
 *
 * A session that included the exercise with an empty note therefore BLOCKS the
 * older one rather than being skipped over.
 *
 * An exercise SWAPPED IN during a session also stands for the one it replaced
 * (`swappedFrom`): swap Bench Press for Dumbbell Press and note "bench was
 * taken", and next week, when the program shows Bench Press again, that's its
 * hint. It's the most recent note written in that place, which is the rule
 * above. The swap-in keeps its own note under its own name too. Within one
 * session an exercise done under its own name wins over a swap-in standing for
 * it.
 */
export function buildPrevNotesByName(
  history: CompletedWorkout[],
  beforeDate?: string,
  day?: PrevDayScope,
): Record<string, string> {
  const sorted = [...history].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  const claim = (name: string, notes: string | undefined) => {
    const key = normalizeExerciseName(name);
    if (!key || seen.has(key)) return; // newest session wins, note or no note
    seen.add(key);
    const note = (notes ?? "").trim();
    if (note) out[key] = note;
  };
  for (const workout of sorted) {
    if (beforeDate && !(workout.date < beforeDate)) continue;
    if (day && !sessionIsOnDay(workout, day)) continue;
    for (const ex of workout.exercises) claim(ex.name, ex.notes);
    for (const ex of workout.exercises) if (ex.swappedFrom) claim(ex.swappedFrom, ex.notes);
  }
  return out;
}

/** What an exercise card asks the note lookup with. */
export type PrevExerciseKey = {
  name: string;
  /** Which program exercise the card is (its id in the day's WorkoutMap).
   *  Absent for one added during the session, which has no place in the
   *  program. */
  programExerciseId?: string;
  /** Set on a swap-in (see CompletedExercise.swappedFrom). */
  swappedFrom?: string;
};

/** The sessions a hint may draw on, newest first: strictly before
 *  `beforeDate` when given, and only those performed on `day` when given. The
 *  same filter `buildPrevByName` and `buildPrevNotesByName` apply inline. */
function hintSessions(history: CompletedWorkout[], beforeDate?: string, day?: PrevDayScope): CompletedWorkout[] {
  return [...history]
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .filter(w => (!beforeDate || w.date < beforeDate) && (!day || sessionIsOnDay(w, day)));
}

const sameExercise = (a?: string, b?: string) =>
  !!a && !!b && normalizeExerciseName(a) === normalizeExerciseName(b);

/** One logged exercise's sets as "weight×reps" hints (or weight / reps / "—"). */
function formatPrevSets(ex: CompletedWorkout["exercises"][number]): string[] {
  return ex.sets.map(s => {
    if (s.weight && s.reps) return `${s.weight}×${s.reps}`;
    return s.weight || s.reps || "—";
  });
}

/**
 * The "Previous:" note for each exercise card, under the same rules as
 * `buildPrevNotesByName` (last session only, an empty note blocks, day-scoped),
 * but with a program exercise matched by its PLACE in the program rather than
 * its name.
 *
 * Why: a day can list the same exercise twice (a heavy and a back-off Bench
 * Press). By name both would show whichever note came first last week; by
 * place each shows its own, and moving exercises around in the session changes
 * nothing. A place counts while it still holds that exercise, done as itself or
 * swapped out for another that session (whose note it then takes, which is the
 * swappedFrom rule). A place the program has since given a different exercise
 * doesn't pass on notes written about the old one.
 *
 * A session saved before places were recorded (no programExerciseId anywhere in
 * it) is read by name exactly as before, so existing history keeps working;
 * two same-named exercises share its note until a newer session separates them.
 *
 * A swap-in, or an exercise added during the session, has no place of its own,
 * and looks itself up by name (`buildPrevNotesByName`).
 */
export function buildPrevNoteLookup(
  history: CompletedWorkout[],
  beforeDate?: string,
  day?: PrevDayScope,
): (ex: PrevExerciseKey) => string | undefined {
  const sessions = hintSessions(history, beforeDate, day);
  const byName = buildPrevNotesByName(history, beforeDate, day);
  return ex => {
    if (!ex.programExerciseId || ex.swappedFrom) return byName[normalizeExerciseName(ex.name)];
    for (const w of sessions) {
      const placed = w.exercises.some(x => x.programExerciseId);
      const hit = placed
        ? w.exercises.find(x => x.programExerciseId === ex.programExerciseId
            && (sameExercise(x.name, ex.name) || sameExercise(x.swappedFrom, ex.name)))
        : w.exercises.find(x => sameExercise(x.name, ex.name)) ?? w.exercises.find(x => sameExercise(x.swappedFrom, ex.name));
      if (hit) return (hit.notes ?? "").trim() || undefined;
    }
    return undefined;
  };
}

/**
 * The "Previous:" hint in the SESSION notes box: the session note written the
 * last time this day was done, under the same rules as an exercise's note. Only
 * the most recent session counts, and one with no session note blocks the older
 * ones, so a one-off remark doesn't follow you for months.
 *
 * Scoped by `day` exactly as the exercise notes are, which is what makes it
 * follow the DAY rather than the date: do Monday's Upper on Tuesday (Change Day,
 * Move to Tomorrow, or a journal log) and it's the same slot, so last week's
 * note is there.
 */
export function buildPrevSessionNote(
  history: CompletedWorkout[],
  beforeDate?: string,
  day?: PrevDayScope,
): string | undefined {
  const last = hintSessions(history, beforeDate, day)[0];
  return (last?.sessionNotes ?? "").trim() || undefined;
}

/**
 * What `swappedFrom` becomes when the exercise now called `current.name` is
 * swapped for `newName`: the FIRST exercise in that place, so swapping A for B
 * and then B for C still records A (the one the program has). Swapping back to
 * the original records nothing, since nothing was replaced.
 */
export function swapOrigin(
  current: { name: string; swappedFrom?: string },
  newName: string,
): string | undefined {
  const origin = current.swappedFrom ?? current.name;
  return normalizeExerciseName(origin) === normalizeExerciseName(newName) ? undefined : origin;
}

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
      out[key] = formatPrevSets(ex);
    }
  }
  return out;
}

/**
 * The previous sets ("Previous: 100×5") for each exercise card, under the same
 * day scoping as `buildPrevByName`, but with a program exercise matched by its
 * PLACE in the program (programExerciseId), as `buildPrevNoteLookup` does for
 * notes: a day that lists Bench Press twice shows the heavy numbers on the
 * heavy one and the back-off numbers on the back-off one, whatever order the
 * session was done in.
 *
 * One deliberate difference from notes: a place only answers with numbers
 * lifted by THIS exercise there. When it was swapped out last time, the
 * swap-in's weights were for another lift, so the walk goes on to the last time
 * this exercise itself was done in that place. And a place with no numbers of
 * its own (new to the program, or only ever swapped out) shows the exercise's
 * last numbers from anywhere on this day, by name, which is the same lift.
 *
 * Sessions saved before places were recorded are read by name, as before. A
 * swap-in, or an exercise added during the session, is looked up by name.
 */
export function buildPrevSetsLookup(
  history: CompletedWorkout[],
  beforeDate?: string,
  day?: PrevDayScope,
): (ex: PrevExerciseKey) => string[] | undefined {
  const sessions = hintSessions(history, beforeDate, day);
  const byName = buildPrevByName(history, beforeDate, day);
  return ex => {
    const ownName = byName[normalizeExerciseName(ex.name)];
    if (!ex.programExerciseId || ex.swappedFrom) return ownName;
    for (const w of sessions) {
      const placed = w.exercises.some(x => x.programExerciseId);
      const hit = placed
        ? w.exercises.find(x => x.programExerciseId === ex.programExerciseId && sameExercise(x.name, ex.name))
        : w.exercises.find(x => sameExercise(x.name, ex.name));
      if (hit) return formatPrevSets(hit);
    }
    return ownName;
  };
}
