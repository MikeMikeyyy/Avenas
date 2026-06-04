// utils/progressStats.ts
//
// Pure derivation helpers for the Progress page. No React, no AsyncStorage.
// Every function is idempotent and takes its inputs explicitly so the screen
// can re-run them inside useMemo on every focus refresh.
//
// Conventions:
//   - Weight & reps are stored as strings in CompletedSet. We parseFloat; NaN
//     and weight<=0 are skipped from tonnage / PR math. ("BW" / "" / "0".)
//   - Only working sets with done===true contribute to tonnage and PRs.
//   - Exercise name match is case-insensitive trim across the whole module.
//   - Date math always uses Date objects + toYMD; never string arithmetic.

import { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { CustomExercise, SelectableMuscle } from "../constants/exercises";
import { MONTH_NAMES, toYMD, parseStoredDate } from "./dates";
import { musclesForExercise, RADAR_GROUPS } from "./muscleGroups";
import type {
  ExerciseDataPoint,
  LoggedExerciseRow,
  MuscleGroupStat,
  PRs,
  ProgramScope,
  RangeKey,
  RangeOption,
  VolumeBucket,
} from "../constants/progress";
import { RANGE_OPTIONS } from "../constants/progress";

// ─── small helpers ───────────────────────────────────────────────────────────

function key(name: string): string {
  return name.trim().toLowerCase();
}

function parsePositive(s: string): number {
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function parseNonNeg(s: string): number {
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymdToDate(ymd: string): Date {
  // ymd is "YYYY-MM-DD" local — split + construct avoids UTC shift.
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ─── public: per-workout metric aggregators ──────────────────────────────────

export function computeWorkoutTonnage(w: CompletedWorkout): number {
  let total = 0;
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.type !== "working" || !s.done) continue;
      const wt = parsePositive(s.weight);
      const r = parsePositive(s.reps);
      if (wt === 0 || r === 0) continue;
      total += wt * r;
    }
  }
  return total;
}

/** Total reps across working+done sets. Sets with no parseable reps are skipped. */
export function computeWorkoutReps(w: CompletedWorkout): number {
  let total = 0;
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.type !== "working" || !s.done) continue;
      total += parsePositive(s.reps);
    }
  }
  return total;
}

/** Per-workout total duration in minutes. Used as the bucket aggregate so the
 *  chart's Y-axis can show clean minute counts; the header re-expands minutes
 *  back to seconds for `fmtDuration` to format as "1h 23m" / "47m". */
export function computeWorkoutDurationMinutes(w: CompletedWorkout): number {
  if (!Number.isFinite(w.durationSeconds) || w.durationSeconds <= 0) return 0;
  return w.durationSeconds / 60;
}

// ─── public: muscle-group breakdown (Strength radar) ─────────────────────────

/** Empty per-group accumulator with every radar group present at zero. */
function emptyMuscleStats(): Record<SelectableMuscle, MuscleGroupStat> {
  const out = {} as Record<SelectableMuscle, MuscleGroupStat>;
  for (const g of RADAR_GROUPS) out[g] = { volume: 0, sessions: 0, sets: 0 };
  return out;
}

/**
 * Aggregate volume / session-frequency / set-count per muscle group across the
 * given workouts. Exercise→group resolution goes through musclesForExercise,
 * so both bundled (single primaryMuscle) and custom (multi-muscle) exercises
 * are handled.
 *
 * Even-split rule for multi-muscle custom exercises (N listed groups):
 *   - volume & sets: each exercise's contribution is divided by N across its
 *     groups, so page-wide volume totals stay correct (no double counting).
 *   - frequency: per session we take, per group, the *largest* single-exercise
 *     credit (1 for a bundled/1-muscle exercise, 1/N for an N-muscle custom)
 *     and sum that across sessions. A bundled exercise therefore yields whole
 *     session counts; an isolated 2-muscle custom contributes 0.5 to each.
 *
 * Uncategorized exercises (no catalogue/custom match) are skipped.
 */
export function computeMuscleGroupStats(
  workouts: CompletedWorkout[],
  customExercises: CustomExercise[],
): Record<SelectableMuscle, MuscleGroupStat> {
  const stats = emptyMuscleStats();

  for (const w of workouts) {
    // Per-session best frequency credit per group (see rule above).
    const sessionCredit = {} as Record<SelectableMuscle, number>;

    for (const ex of w.exercises) {
      const groups = musclesForExercise(ex.name, customExercises);
      if (groups.length === 0) continue;
      const share = 1 / groups.length;

      let exVolume = 0;
      let exSets = 0;
      for (const s of ex.sets) {
        if (s.type !== "working" || !s.done) continue;
        const wt = parsePositive(s.weight);
        const r = parsePositive(s.reps);
        exSets += 1; // a completed working set, regardless of weight (e.g. BW)
        if (wt > 0 && r > 0) exVolume += wt * r;
      }
      if (exSets === 0) continue; // no completed working sets → didn't train anything

      for (const g of groups) {
        stats[g].volume += exVolume * share;
        stats[g].sets += exSets * share;
        const prev = sessionCredit[g] ?? 0;
        if (share > prev) sessionCredit[g] = share;
      }
    }

    for (const g of RADAR_GROUPS) {
      const credit = sessionCredit[g];
      if (credit) stats[g].sessions += credit;
    }
  }

  return stats;
}

// ─── public: range window resolution ─────────────────────────────────────────

export function getRangeOption(range: RangeKey): RangeOption {
  return RANGE_OPTIONS.find(r => r.key === range) ?? RANGE_OPTIONS[0];
}

/** Monday (00:00 local) of the ISO-style week containing `d`. Sunday is treated
 *  as the *end* of the previous week, so Sun May 17 → Mon May 11. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0 = Sun, 1 = Mon, …, 6 = Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

/**
 * Resolve the [start, end] inclusive YMD window for a range.
 *   - thisWeek:    Monday → Sunday of the current ISO week (end capped at today)
 *   - lastWeek:    Monday → Sunday of the previous ISO week
 *   - thisMonth:   Monday of (currentWeek-3) → today                (4 rolling weekly bars)
 *   - last3Months: 1st of (currentMonth-2) → today                  (3 monthly bars)
 */
export function rangeWindow(range: RangeKey, today: Date): { startYMD: string; endYMD: string } {
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  switch (range) {
    case "thisWeek": {
      const mon = mondayOf(base);
      const sun = addDays(mon, 6);
      // Cap end at today so future days don't show empty bars.
      const end = sun.getTime() > base.getTime() ? base : sun;
      return { startYMD: toYMD(mon), endYMD: toYMD(end) };
    }
    case "lastWeek": {
      const thisMonday = mondayOf(base);
      const lastMon = addDays(thisMonday, -7);
      const lastSun = addDays(lastMon, 6);
      return { startYMD: toYMD(lastMon), endYMD: toYMD(lastSun) };
    }
    case "thisMonth": {
      // Monday of the current week, then walk back 3 weeks for the start.
      const currentMonday = mondayOf(base);
      const start = addDays(currentMonday, -21);
      return { startYMD: toYMD(start), endYMD: toYMD(base) };
    }
    case "last3Months": {
      // First day of the month two months before the current month.
      const threeMonthsStart = new Date(base.getFullYear(), base.getMonth() - 2, 1);
      return { startYMD: toYMD(threeMonthsStart), endYMD: toYMD(base) };
    }
    case "year": {
      // First day of the month eleven months before the current month —
      // produces exactly 12 monthly buckets (current month inclusive).
      const yearStart = new Date(base.getFullYear(), base.getMonth() - 11, 1);
      return { startYMD: toYMD(yearStart), endYMD: toYMD(base) };
    }
  }
}

/**
 * Filter workouts to those whose `date` falls within [startYMD, endYMD]
 * inclusive. "YYYY-MM-DD" strings sort lexicographically in date order, so a
 * plain string compare is correct and avoids Date construction.
 */
export function filterByDateWindow(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
): CompletedWorkout[] {
  return workouts.filter(w => w.date >= startYMD && w.date <= endYMD);
}

// ─── public: metric bucketing ────────────────────────────────────────────────
//
// The three bucketing templates (day / rollingWeeks / month) are shared across
// every metric. Pass any per-workout aggregator and the bucket's `total` ends
// up holding the aggregate of that metric across the workouts in the bucket.

type WorkoutAggregator = (w: CompletedWorkout) => number;

/**
 * One bucket per local day in [startYMD, endYMD] (inclusive).
 * Bars are labelled with short weekday name ("Mon").
 */
export function bucketMetricByDay(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
  aggregate: WorkoutAggregator,
): VolumeBucket[] {
  const start = ymdToDate(startYMD);
  const end = ymdToDate(endYMD);
  const buckets: VolumeBucket[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    const ymd = toYMD(d);
    buckets.push({
      label: SHORT_WEEKDAY[d.getDay()],
      startYMD: ymd,
      endYMD: ymd,
      total: 0,
      workoutIds: [],
    });
  }
  // Index workouts by date for O(n + m).
  const byDate = new Map<string, CompletedWorkout[]>();
  for (const w of workouts) {
    const list = byDate.get(w.date);
    if (list) list.push(w);
    else byDate.set(w.date, [w]);
  }
  for (const b of buckets) {
    const list = byDate.get(b.startYMD) ?? [];
    for (const w of list) {
      b.total += aggregate(w);
      b.workoutIds.push(w.id);
    }
  }
  return buckets;
}

/** Back-compat: existing call sites can still use the volume-specific name. */
export function bucketVolumeByDay(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
): VolumeBucket[] {
  return bucketMetricByDay(workouts, startYMD, endYMD, computeWorkoutTonnage);
}

/**
 * Format a Mon–Sun week as a compact axis label.
 *   Same month        → "May 11-17"
 *   Crosses months    → "Apr 27-May 3"
 */
function formatWeekRange(monday: Date, sunday: Date): string {
  const startMonth = MONTH_NAMES[monday.getMonth()];
  const endMonth = MONTH_NAMES[sunday.getMonth()];
  if (monday.getMonth() === sunday.getMonth()) {
    return `${startMonth} ${monday.getDate()}-${sunday.getDate()}`;
  }
  return `${startMonth} ${monday.getDate()}-${endMonth} ${sunday.getDate()}`;
}

/**
 * Always returns exactly 4 weekly buckets (Mon–Sun) ending with the week
 * that contains `endYMD` (today). The current week's total only counts the
 * days that have actually happened (Mon → today), but the bucket's label
 * always shows the full Mon-Sun range so the timeline reads consistently.
 *
 * `startYMD` is expected to be 21 days before the Monday of the current week.
 */
export function bucketMetricByRollingWeeks(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
  aggregate: WorkoutAggregator,
): VolumeBucket[] {
  const start = ymdToDate(startYMD);
  const today = ymdToDate(endYMD);

  const buckets: VolumeBucket[] = [];
  for (let i = 0; i < 4; i++) {
    const monday = addDays(start, i * 7);
    const sunday = addDays(monday, 6);
    // Aggregate cap = sunday or today, whichever is earlier (current week is partial).
    const aggEnd = sunday.getTime() <= today.getTime() ? sunday : today;
    buckets.push({
      // Label is just the Monday — e.g. "Apr 27" — so we don't get long
       // cross-month strings like "Apr 27-May 3".
      label: `${MONTH_NAMES[monday.getMonth()]} ${monday.getDate()}`,
      startYMD: toYMD(monday),
      endYMD: toYMD(aggEnd),
      total: 0,
      workoutIds: [],
    });
  }

  // Bucket workouts by week index.
  const startMs = start.getTime();
  for (const w of workouts) {
    const wDate = ymdToDate(w.date);
    if (wDate.getTime() < startMs || wDate.getTime() > today.getTime()) continue;
    const dayDelta = Math.floor((wDate.getTime() - startMs) / 86400000);
    const idx = Math.floor(dayDelta / 7);
    const b = buckets[idx];
    if (!b) continue;
    b.total += aggregate(w);
    b.workoutIds.push(w.id);
  }
  return buckets;
}

export function bucketVolumeByRollingWeeks(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
): VolumeBucket[] {
  return bucketMetricByRollingWeeks(workouts, startYMD, endYMD, computeWorkoutTonnage);
}

/**
 * One bucket per calendar month spanned by [startYMD, endYMD] inclusive.
 * Labels are the short month name (e.g. "Mar"). The last bucket's endYMD is
 * clamped to endYMD (today), so partial months sum only logged days.
 *
 * Used by the "3M" range — produces exactly 3 bars (one per month).
 */
export function bucketMetricByMonth(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
  aggregate: WorkoutAggregator,
): VolumeBucket[] {
  const start = ymdToDate(startYMD);
  const end = ymdToDate(endYMD);
  const buckets: VolumeBucket[] = [];

  // Iterate month-by-month from start's month to end's month.
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    const monthFirst = new Date(y, m, 1);
    const monthLast = new Date(y, m + 1, 0);
    const bStart = monthFirst.getTime() < start.getTime() ? start : monthFirst;
    const bEnd = monthLast.getTime() > end.getTime() ? end : monthLast;
    buckets.push({
      label: MONTH_NAMES[m],
      startYMD: toYMD(bStart),
      endYMD: toYMD(bEnd),
      total: 0,
      workoutIds: [],
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  // Bucket workouts by month index (offset from start month).
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  for (const w of workouts) {
    const wDate = ymdToDate(w.date);
    if (wDate.getTime() < start.getTime() || wDate.getTime() > end.getTime()) continue;
    const idx = (wDate.getFullYear() - startYear) * 12 + (wDate.getMonth() - startMonth);
    const b = buckets[idx];
    if (!b) continue;
    b.total += aggregate(w);
    b.workoutIds.push(w.id);
  }
  return buckets;
}

export function bucketVolumeByMonth(
  workouts: CompletedWorkout[],
  startYMD: string,
  endYMD: string,
): VolumeBucket[] {
  return bucketMetricByMonth(workouts, startYMD, endYMD, computeWorkoutTonnage);
}

// ─── public: per-exercise history ────────────────────────────────────────────

/**
 * One ExerciseDataPoint per workout that contains `exerciseName` (case-insensitive trim).
 * Sorted ascending by completedAt so it can feed a left-to-right line chart.
 */
export function collectExerciseHistory(
  workouts: CompletedWorkout[],
  exerciseName: string,
): ExerciseDataPoint[] {
  const want = key(exerciseName);
  const points: ExerciseDataPoint[] = [];
  for (const w of workouts) {
    let topWeight = 0;
    let topReps = 0;
    let bestSetVolume = 0;
    let bestSetWeight = 0;
    let bestSetReps = 0;
    let sessionVolume = 0;
    let totalReps = 0;
    let found = false;
    for (const ex of w.exercises) {
      if (key(ex.name) !== want) continue;
      found = true;
      for (const s of ex.sets) {
        if (s.type !== "working" || !s.done) continue;
        const wt = parsePositive(s.weight);
        const r = parsePositive(s.reps);
        if (wt === 0 || r === 0) continue;
        const vol = wt * r;
        sessionVolume += vol;
        totalReps += r;
        if (wt > topWeight) {
          topWeight = wt;
          topReps = r;
        } else if (wt === topWeight && r > topReps) {
          // Same weight — prefer higher reps for the "top" set.
          topReps = r;
        }
        if (vol > bestSetVolume) {
          bestSetVolume = vol;
          bestSetWeight = wt;
          bestSetReps = r;
        }
      }
    }
    if (!found || sessionVolume === 0) continue;
    points.push({
      workoutId: w.id,
      date: w.date,
      completedAt: w.completedAt,
      topWeight,
      topReps,
      bestSetVolume,
      bestSetWeight,
      bestSetReps,
      sessionVolume,
      totalReps,
    });
  }
  points.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  return points;
}

// ─── public: PRs ─────────────────────────────────────────────────────────────

function epley(weight: number, reps: number): number {
  if (weight <= 0 || reps < 1) return 0;
  return weight * (1 + reps / 30);
}

/**
 * PRs derived from the full per-exercise history. Single pass.
 * For ties, keeps the *earliest* occurrence by completedAt — which matches the
 * sorted-ascending order of `collectExerciseHistory`, so a simple ">" check
 * (not ">=") yields the founding session.
 *
 * Note: heaviest/bestSet are per-session aggregates (topWeight / bestSetVolume),
 * not per-set; this is intentional because collectExerciseHistory already
 * picked the best single set inside each session.
 *
 * 1RM PR walks the entire set list (not just the session's top set) so that a
 * lighter-but-higher-rep set can take the 1RM crown.
 */
export function computePRs(history: ExerciseDataPoint[], workouts: CompletedWorkout[], exerciseName: string): PRs {
  const heaviest = history.reduce<{ p: ExerciseDataPoint; reps: number } | null>((acc, p) => {
    if (!acc || p.topWeight > acc.p.topWeight) return { p, reps: p.topReps };
    return acc;
  }, null);
  const bestSet = history.reduce<ExerciseDataPoint | null>((acc, p) => {
    if (!acc || p.bestSetVolume > acc.bestSetVolume) return p;
    return acc;
  }, null);
  const bestSession = history.reduce<ExerciseDataPoint | null>((acc, p) => {
    if (p.sessionVolume <= 0) return acc;
    if (!acc || p.sessionVolume > acc.sessionVolume) return p;
    return acc;
  }, null);

  // 1RM walks raw sets.
  const want = key(exerciseName);
  let oneRm: { value: number; workoutId: string; date: string; weight: number; reps: number; completedAt: string } | null = null;
  for (const w of workouts) {
    for (const ex of w.exercises) {
      if (key(ex.name) !== want) continue;
      for (const s of ex.sets) {
        if (s.type !== "working" || !s.done) continue;
        const wt = parsePositive(s.weight);
        const r = parsePositive(s.reps);
        if (wt === 0 || r === 0) continue;
        const e = epley(wt, r);
        if (!oneRm || e > oneRm.value) {
          oneRm = { value: e, workoutId: w.id, date: w.date, weight: wt, reps: r, completedAt: w.completedAt };
        }
      }
    }
  }

  return {
    heaviest: heaviest
      ? { value: heaviest.p.topWeight, workoutId: heaviest.p.workoutId, date: heaviest.p.date, weight: heaviest.p.topWeight, reps: heaviest.p.topReps }
      : null,
    bestSetVolume: bestSet
      ? { value: bestSet.bestSetVolume, workoutId: bestSet.workoutId, date: bestSet.date }
      : null,
    bestSessionVolume: bestSession
      ? { value: bestSession.sessionVolume, workoutId: bestSession.workoutId, date: bestSession.date }
      : null,
    oneRepMax: oneRm
      ? { value: oneRm.value, workoutId: oneRm.workoutId, date: oneRm.date, weight: oneRm.weight, reps: oneRm.reps }
      : null,
  };
}

// ─── public: program scope filter ────────────────────────────────────────────

export function programIncludes(p: SavedProgram, workoutName: string): boolean {
  const k = key(workoutName);
  if (p.cyclePattern.some(n => n && key(n) === k && key(n) !== "rest")) return true;
  if (p.extraWorkouts?.some(n => key(n) === k)) return true;
  return false;
}

/**
 * Does a completed workout belong to program `p`?
 *
 *   - New-style record (`programId` is a string, incl. "") → match by id. This
 *     is exact: a free workout ("") belongs to no program, and two programs that
 *     reuse the same day names never share sessions.
 *   - Legacy record (`programId` undefined — written before the field existed)
 *     → fall back to matching the day name, but ONLY inside `p`'s active date
 *     window [startDate, completedDate]. Without the date bound, a program
 *     created later would wrongly inherit an earlier program's same-named days.
 */
export function workoutBelongsToProgram(w: CompletedWorkout, p: SavedProgram): boolean {
  if (w.programId !== undefined) return w.programId === p.id;
  if (!programIncludes(p, w.workoutName)) return false;
  const start = parseStoredDate(p.startDate);
  if (start && w.date < toYMD(start)) return false;
  if (p.completedDate) {
    const end = parseStoredDate(p.completedDate);
    if (end && w.date > toYMD(end)) return false;
  }
  return true;
}

/**
 * Filter the history list by the user's selected program scope.
 *   - current: workouts belonging to the lone active program; [] if none.
 *   - all: identity.
 *   - program: workouts belonging to the named program; [] if it's gone.
 */
export function filterByProgramScope(
  history: CompletedWorkout[],
  scope: ProgramScope,
  programs: SavedProgram[],
): CompletedWorkout[] {
  if (scope.kind === "all") return history;
  let target: SavedProgram | null = null;
  if (scope.kind === "current") {
    target = programs.find(p => p.status === "active") ?? null;
  } else {
    target = programs.find(p => p.id === scope.programId) ?? null;
  }
  if (!target) return [];
  const t = target;
  return history.filter(w => workoutBelongsToProgram(w, t));
}

// ─── public: programs in scope (for the day drill-down) ──────────────────────

export function programsInScope(scope: ProgramScope, programs: SavedProgram[]): SavedProgram[] {
  if (scope.kind === "all") return programs;
  if (scope.kind === "current") {
    const p = programs.find(p => p.status === "active");
    return p ? [p] : [];
  }
  const p = programs.find(p => p.id === scope.programId);
  return p ? [p] : [];
}

/**
 * Unique non-Rest day names across the programs in scope. Case-insensitive trim
 * dedupe; preserves the case of the first occurrence in iteration order.
 */
export function uniqueDaysInScope(scope: ProgramScope, programs: SavedProgram[]): string[] {
  const seen = new Map<string, string>();
  for (const p of programsInScope(scope, programs)) {
    for (const name of p.cyclePattern) {
      if (!name) continue;
      const k = key(name);
      if (k === "rest") continue;
      if (!seen.has(k)) seen.set(k, name);
    }
    for (const name of p.extraWorkouts ?? []) {
      if (!name) continue;
      const k = key(name);
      if (k === "rest") continue;
      if (!seen.has(k)) seen.set(k, name);
    }
  }
  return Array.from(seen.values());
}

// ─── public: exercises logged for a workout day ──────────────────────────────

/**
 * Across the in-scope completed workouts whose `workoutName` matches `dayName`,
 * collect a deduped list of exercises (case-insensitive trim). Each row reports
 * the most recent weight × reps and the total session count.
 *
 * Sorted by lastDate desc (most recently logged first).
 */
export function collectLoggedExercisesForDay(
  workouts: CompletedWorkout[],
  dayName: string,
): LoggedExerciseRow[] {
  const want = key(dayName);
  // exerciseKey → { name (preserve case), latestSet, lastDate, lastCompletedAt, sessionCount }
  const acc = new Map<
    string,
    {
      name: string;
      lastWeight: string;
      lastReps: string;
      lastDate: string;
      lastCompletedAt: string;
      sessionCount: number;
    }
  >();
  for (const w of workouts) {
    if (key(w.workoutName) !== want) continue;
    // For each exercise in this workout, find the latest "working+done" set
    // to use as the "lastWeight × lastReps" preview.
    for (const ex of w.exercises) {
      const ek = key(ex.name);
      if (!ek) continue;
      const lastWorking = [...ex.sets].reverse().find(s => s.type === "working" && s.done);
      const prev = acc.get(ek);
      const isNewer = !prev || w.completedAt > prev.lastCompletedAt;
      if (!prev) {
        acc.set(ek, {
          name: ex.name,
          lastWeight: lastWorking?.weight ?? "",
          lastReps: lastWorking?.reps ?? "",
          lastDate: w.date,
          lastCompletedAt: w.completedAt,
          sessionCount: 1,
        });
      } else {
        prev.sessionCount += 1;
        if (isNewer) {
          prev.lastWeight = lastWorking?.weight ?? prev.lastWeight;
          prev.lastReps = lastWorking?.reps ?? prev.lastReps;
          prev.lastDate = w.date;
          prev.lastCompletedAt = w.completedAt;
        }
      }
    }
  }
  return Array.from(acc.values())
    .sort((a, b) => b.lastCompletedAt.localeCompare(a.lastCompletedAt))
    .map(r => ({
      name: r.name,
      lastWeight: r.lastWeight,
      lastReps: r.lastReps,
      lastDate: r.lastDate,
      sessionCount: r.sessionCount,
    }));
}

/**
 * Session count for `dayName` across in-scope workouts (used in the day row).
 */
export function sessionCountForDay(
  workouts: CompletedWorkout[],
  dayName: string,
): number {
  const want = key(dayName);
  let n = 0;
  for (const w of workouts) {
    if (key(w.workoutName) === want) n += 1;
  }
  return n;
}
