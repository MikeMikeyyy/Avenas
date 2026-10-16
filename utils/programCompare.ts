// utils/programCompare.ts
//
// The Progress page's comparison of two programs (user request and design,
// 2026-10-14, on the Program Compare canvas): the program picked at the top
// (green) against a FINISHED one (periwinkle), which can be another program
// or an earlier run of the same one (utils/programRuns.ts).
//
// Two ways things line up, each where it reads naturally:
//
//   - An exercise lines up by its SESSIONS: the Nth time it came round in
//     each program, 4th against 4th, every day it's on counted in date order.
//     A session that came round and wasn't done keeps its place and its number
//     (liftSlots), so the line goes dotted through it (user decision, 2026-10-14,
//     after seeing misses squeezed between the sessions done: "if we miss
//     session 5 and 6 it should just be dotted lines through there").
//   - The program's whole week (its volume, the radar, At a glance) lines up
//     by program day and week: day 1 is the day the run began, and held and
//     pushed days don't count, the timeline "Week 3 of 8" counts.
//
// "Same point" reads both over the first days of each, as many as the
// shorter has run (the green one's so far, while it runs); "Whole program"
// reads each as far as it went.
//
// Pure: no RN imports, so scripts/verify-program-compare.ts and the training
// simulation run it.

import { getCurrentWeek, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import type { CustomExercise, SelectableMuscle } from "../constants/exercises";
import type { ExerciseDataPoint, MetricKey, MuscleGroupStat, ProgramScope } from "../constants/progress";
import { achievementsForWorkout } from "./achievements";
import { cycleDrift } from "./cycleDrift";
import { addDaysYMD, daysBetweenYMD, MONTH_NAMES, parseStoredDate, toYMD } from "./dates";
import { currentExerciseName, exerciseIdentity, type ExerciseRef } from "./exerciseNames";
import { chartValue, drawsOn, percentChange } from "./exerciseChartLayout";
import { dayIdAt, workoutKey } from "./programDays";
import { programAsOf } from "./programHolds";
import { buildProgramHistory, sessionStats } from "./programHistory";
import {
  collectExerciseHistory, computeMuscleGroupStats, computeWorkoutDurationMinutes, computeWorkoutReps,
  computeWorkoutTonnage, workoutBelongsToProgram,
} from "./progressStats";
import { programRunViews, sameRun, type ProgramRunView, type RunRef } from "./programRuns";
import { occurrencesOfDay } from "./sessionTrack";
import { ordinal } from "./workoutSummary";

// ─── The two sides ───────────────────────────────────────────────────────────

/** The run the page reads as green when a comparison starts: the latest run of
 *  the program picked at the top; with none picked ("Current program", "All
 *  programs"), the active program's; with none active either, the run that
 *  finished last, so two finished programs can be compared with nothing on the
 *  go (user request, 2026-10-14). Green's row changes it from there. */
export function greenRunFor(
  scope: ProgramScope,
  programs: readonly SavedProgram[],
  history: readonly CompletedWorkout[],
): ProgramRunView | null {
  if (scope.kind === "program") {
    const p = programs.find(q => q.id === scope.programId);
    return p ? programRunViews(p, history).find(v => v.ref.run === "latest") ?? null : null;
  }
  const active = programs.find(q => q.status === "active");
  if (active) return programRunViews(active, history).find(v => v.ref.run === "latest") ?? null;
  return compareCandidates(programs, history, null)[0] ?? null;
}

/** What green can be compared with: every FINISHED run with a session in it
 *  (the user's rule), any program's, an earlier run of green's own included,
 *  but not green itself. The most recently finished first. */
export function compareCandidates(
  programs: readonly SavedProgram[],
  history: readonly CompletedWorkout[],
  green: RunRef | null,
): ProgramRunView[] {
  const out: ProgramRunView[] = [];
  for (const p of programs) {
    for (const v of programRunViews(p, history)) {
      if (!v.finished || v.sessions.length === 0) continue;
      if (green && sameRun(v.ref, green)) continue;
      out.push(v);
    }
  }
  return out.sort((a, b) => (b.endYMD ?? "").localeCompare(a.endYMD ?? ""));
}

/** The active program's run on the go, if it has one. */
function currentRun(programs: readonly SavedProgram[], history: readonly CompletedWorkout[]): ProgramRunView | null {
  const active = programs.find(q => q.status === "active");
  return active ? programRunViews(active, history).find(v => v.ref.run === "latest") ?? null : null;
}

/** Green when the compare button is tapped: `greenRunFor`, unless that has
 *  nothing to be compared with (the program picked at the top is the one
 *  finished program), when the current program takes green so the picked one
 *  can go in blue, and failing that the run that finished last. So the page
 *  can compare whenever `compareReadiness` says both steps are done. */
export function compareStartGreen(
  scope: ProgramScope,
  programs: readonly SavedProgram[],
  history: readonly CompletedWorkout[],
): ProgramRunView | null {
  const picked = greenRunFor(scope, programs, history);
  const fallbacks = [picked, currentRun(programs, history), compareCandidates(programs, history, null)[0] ?? null];
  return fallbacks.find(v => v && compareCandidates(programs, history, v.ref).length > 0) ?? picked;
}

/** What comparing needs, for the compare sheet's checklist while it can't
 *  (user request, 2026-10-15): a FINISHED program with a session in it, and
 *  another to set beside it, the one on the go (the same program run again
 *  counts) or a second finished one. The second step only counts once the
 *  first is done: before anything is finished, the program on the go is the
 *  one to finish, not "another". */
export function compareReadiness(
  programs: readonly SavedProgram[],
  history: readonly CompletedWorkout[],
): { finished: boolean; another: boolean } {
  const finished = compareCandidates(programs, history, null);
  return {
    finished: finished.length > 0,
    another: finished.length > 0 && (currentRun(programs, history) !== null || finished.length > 1),
  };
}

/** A run's name: the program's, with which run when it's had more than one
 *  ("Push Pull Legs, 1st run"); the one it's on now goes by the name alone. */
export function runName(view: ProgramRunView): string {
  const base = view.program.name;
  if (view.ref.run === "earlier") return `${base}, earlier run`;
  if (view.ref.run === "latest" && !view.finished) return base;
  return view.number !== null ? `${base}, ${ordinal(view.number)} run` : base;
}

/** "26 Jul", or "3 May 2025" when it isn't this year. */
function shortDate(ymd: string, todayYMD: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const mon = MONTH_NAMES[(m - 1) % 12];
  return ymd.slice(0, 4) === todayYMD.slice(0, 4) ? `${d} ${mon}` : `${d} ${mon} ${y}`;
}

/** Where a run is up to, beside its name: "Week 5 of 8", "On hold",
 *  "Finished 26 Jul", "Stopped in week 3". */
export function runStatus(view: ProgramRunView, todayYMD: string): string {
  const p = view.program;
  if (view.finished) return view.endYMD ? `Finished ${shortDate(view.endYMD, todayYMD)}` : "Finished";
  if (view.ref.run === "latest" && p.status === "active") {
    if (p.pausedAt) return "On hold";
    return `Week ${getCurrentWeek(p, new Date(`${todayYMD}T12:00:00`))} of ${p.totalWeeks}`;
  }
  return `Stopped in week ${Math.max(1, p.currentWeek)}`;
}

/** When a finished run ran, beside its name at the top, which tells two
 *  programs of one name apart (user request, 2026-10-14): "1 Jun – 26 Jul",
 *  the year once when it isn't this year ("1 Jun – 26 Jul 2025"), and on each
 *  date when it ran into the next ("3 Nov 2025 – 26 Jan 2026"). */
export function runDates(view: ProgramRunView, todayYMD: string): string {
  const start = view.startYMD;
  const end = view.endYMD ?? todayYMD;
  const fmt = (ymd: string, withYear: boolean) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return `${d} ${MONTH_NAMES[(m - 1) % 12]}${withYear ? ` ${y}` : ""}`;
  };
  const otherYear = end.slice(0, 4) !== todayYMD.slice(0, 4);
  if (start === end) return fmt(end, otherYear);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${fmt(start, false)} – ${fmt(end, otherYear)}`;
  return `${fmt(start, true)} – ${fmt(end, true)}`;
}

/** A finished run in the picker: "Finished 26 Jul · 8 weeks · 31 workouts". */
export function runSummary(view: ProgramRunView, todayYMD: string): string {
  const weeks = weekOfDay(runDays(view, todayYMD));
  const n = view.sessions.length;
  return `${runStatus(view, todayYMD)} · ${weeks} ${weeks === 1 ? "week" : "weeks"} · ${n} ${n === 1 ? "workout" : "workouts"}`;
}

// ─── Program days and weeks ──────────────────────────────────────────────────

/**
 * Which day of its run `ymd` is for `program`, from 1, on the program's own
 * timeline: a day held or pushed doesn't move it on, a rest day spent moves it
 * on by two (the "Week 3 of 8" counting, getCurrentWeek). A date before a hold
 * is read as the program stood then. Null before the run began, or when its
 * start can't be read.
 */
export function programDayOf(program: SavedProgram, ymd: string): number | null {
  const p = programAsOf(program, ymd);
  const start = parseStoredDate(p.startDate);
  if (!start) return null;
  const days = daysBetweenYMD(toYMD(start), ymd);
  if (days === null) return null;
  const day = days - cycleDrift(p, ymd) + 1;
  return day >= 1 ? day : null;
}

/** The program week a program day is in, from 1. */
export const weekOfDay = (day: number): number => Math.floor((Math.max(1, day) - 1) / 7) + 1;

/** How many days `view` has run: to its last day, or for one still going, to
 *  `todayYMD` (to the day before a hold it's on). A session logged past the
 *  end still counts. At least 1. */
export function runDays(view: ProgramRunView, todayYMD: string): number {
  const p = view.program;
  let end = view.endYMD ?? todayYMD;
  if (!view.endYMD && p.pausedAt && p.pausedAt <= end) end = addDaysYMD(p.pausedAt, -1);
  const last = view.sessions.at(-1)?.date;
  if (last && last > end) end = last;
  return Math.max(1, programDayOf(p, end) ?? 1);
}

export type CompareSpan = "same" | "whole";

/** The days each side is read over: "same", the first days of each, as many
 *  as the shorter has run; "whole", each as far as it went. */
export function spanDays(
  green: ProgramRunView,
  blue: ProgramRunView,
  span: CompareSpan,
  todayYMD: string,
): { green: number; blue: number } {
  const g = runDays(green, todayYMD);
  const b = runDays(blue, todayYMD);
  if (span === "whole") return { green: g, blue: b };
  const n = Math.min(g, b);
  return { green: n, blue: n };
}

/** A run as a sentence names it: "the current Push Pull Legs program", "the
 *  1st run of Upper Lower", "an earlier run of Upper Lower", or its name. A run
 *  of the program `other` is a run of goes by "its": "its 1st run". */
function runPhrase(view: ProgramRunView, other?: ProgramRunView): string {
  const name = view.program.name.trim();
  if (view.ref.run === "latest" && !view.finished && view.program.status === "active") {
    return `the current ${/\bprogram(me)?$/i.test(name) ? name : `${name} program`}`;
  }
  const own = other?.program.id === view.program.id;
  if (view.ref.run === "earlier") return own ? "its earlier run" : `an earlier run of ${name}`;
  if (view.ref.run === "latest" && !view.finished) return name;
  if (view.number === null) return name;
  return own ? `its ${ordinal(view.number)} run` : `the ${ordinal(view.number)} run of ${name}`;
}

/**
 * What At a glance reads, in words, under its title (user request, 2026-10-14):
 * "First 5 weeks of the current Push Pull Legs program, against the first 5
 * weeks of Upper Lower". Each side says how many program weeks it's read over
 * and which run it is; a side read to its end says "all", one still going "so
 * far".
 */
export function spanCaption(green: ProgramRunView, blue: ProgramRunView, span: CompareSpan, todayYMD: string): string {
  const days = spanDays(green, blue, span, todayYMD);
  const part = (view: ProgramRunView, read: number, phrase: string) => {
    const n = weekOfDay(read);
    const running = !view.finished && view.ref.run === "latest" && view.program.status === "active";
    if (read >= runDays(view, todayYMD) && (!running || span === "whole")) {
      const all = n === 1 ? (running ? "the first week" : "the one week") : `all ${n} weeks`;
      return `${all} of ${phrase}${running ? " so far" : ""}`;
    }
    return `the first ${n === 1 ? "week" : `${n} weeks`} of ${phrase}`;
  };
  const lead = part(green, days.green, runPhrase(green)).replace(/^the first/, "first").replace(/^the one/, "one");
  return `${lead.charAt(0).toUpperCase()}${lead.slice(1)}, against ${part(blue, days.blue, runPhrase(blue, green))}`;
}

/** `view`'s sessions in its first `days` program days, oldest first. */
export function sessionsWithin(view: ProgramRunView, days: number): CompletedWorkout[] {
  return view.sessions.filter(w => {
    const d = programDayOf(view.program, w.date);
    return d !== null && d <= days;
  });
}

// ─── At a glance ─────────────────────────────────────────────────────────────

export type GlanceStats = {
  /** Days trained, and days that asked for a workout (trained, missed, or
   *  trained with something else), within the span. Today's workout, not done
   *  yet, isn't counted against it. */
  workoutsDone: number;
  workoutsPlanned: number;
  /** The sessions' average length, of the ones that recorded one. */
  avgSessionSeconds: number | null;
  /** Kilos moved and working sets done, per program week of the span. */
  volumePerWeekKg: number;
  setsPerWeek: number;
  /** Personal records set (a lift's new heaviest), each one counted, as the
   *  session's PR card lists them. */
  prs: number;
};

/** `history` without the sessions of `view`'s program after its last day:
 *  those are a later run's. */
function historyForRun(view: ProgramRunView, history: readonly CompletedWorkout[]): CompletedWorkout[] {
  const end = view.endYMD;
  if (!end) return [...history];
  return history.filter(w => !(w.date > end && workoutBelongsToProgram(w, view.program)));
}

/** At a glance for one side, over its first `days` program days. */
export function glanceStats(
  view: ProgramRunView,
  days: number,
  history: readonly CompletedWorkout[],
  todayYMD: string,
): GlanceStats {
  const p = view.program;
  const runHistory = historyForRun(view, history);
  // The day states the program page draws, so the two can't disagree.
  const page = buildProgramHistory(p, runHistory, todayYMD);
  let done = 0;
  let planned = 0;
  for (const week of page.weeks) {
    for (const d of week.days) {
      const day = programDayOf(p, d.ymd);
      if (day === null || day > days) continue;
      if (d.state === "trained") done += 1;
      if (d.state === "trained" || d.state === "missed" || d.state === "replaced") planned += 1;
    }
  }
  const sessions = sessionsWithin(view, days);
  const timed = sessions.filter(w => w.durationSeconds > 0);
  const weeks = Math.max(1, days / 7);
  let volume = 0;
  let sets = 0;
  let prs = 0;
  for (const w of sessions) {
    volume += computeWorkoutTonnage(w);
    sets += sessionStats(w).sets;
    for (const a of achievementsForWorkout(w, runHistory)) if (a.category === "pr") prs += a.prs.length;
  }
  return {
    workoutsDone: done,
    workoutsPlanned: planned,
    avgSessionSeconds: timed.length ? timed.reduce((s, w) => s + w.durationSeconds, 0) / timed.length : null,
    volumePerWeekKg: volume / weeks,
    setsPerWeek: sets / weeks,
    prs,
  };
}

// ─── The program's weeks: volume and the radar ───────────────────────────────

/** `view`'s totals per program week over its first `days` days (Volume, Reps
 *  or Duration in minutes, as the Volume card reads them), week 1 first. */
export function weeklyTotals(view: ProgramRunView, days: number, metric: MetricKey): number[] {
  const out = new Array<number>(weekOfDay(days)).fill(0);
  const total = metric === "volume" ? computeWorkoutTonnage : metric === "reps" ? computeWorkoutReps : computeWorkoutDurationMinutes;
  for (const w of sessionsWithin(view, days)) {
    const day = programDayOf(view.program, w.date);
    if (day === null) continue;
    out[weekOfDay(day) - 1] += total(w);
  }
  return out;
}

/** The radar's numbers for one side, per program week of its first `days`
 *  days, so a longer program doesn't win by being longer. */
export function muscleStatsPerWeek(
  view: ProgramRunView,
  days: number,
  customExercises: CustomExercise[],
): Record<SelectableMuscle, MuscleGroupStat> {
  const stats = computeMuscleGroupStats(sessionsWithin(view, days), customExercises);
  const weeks = Math.max(1, days / 7);
  const out = { ...stats };
  for (const k of Object.keys(out) as SelectableMuscle[]) {
    out[k] = { volume: out[k].volume / weeks, sessions: out[k].sessions / weeks, sets: out[k].sets / weeks };
  }
  return out;
}

// ─── Exercises ───────────────────────────────────────────────────────────────

/** One exercise in the comparison: each side's sessions of it, oldest first
 *  (empty on the side that doesn't have it). */
export type CompareLift = {
  /** Its identity (utils/exerciseNames.ts exerciseIdentity). */
  key: string;
  /** The name it goes by now. */
  name: string;
  /** Which custom exercise of that name it is. */
  customId?: string;
  green: ExerciseDataPoint[];
  blue: ExerciseDataPoint[];
};

/** A run's exercises in the order it first did them, each with its sessions
 *  (collectExerciseHistory, every day it's on). */
function liftsOf(view: ProgramRunView): Map<string, { name: string; customId?: string; points: ExerciseDataPoint[] }> {
  const out = new Map<string, { name: string; customId?: string; points: ExerciseDataPoint[] }>();
  for (const w of view.sessions) {
    for (const ex of w.exercises) {
      const key = ex.name ? exerciseIdentity(ex) : "";
      if (!key || out.has(key)) continue;
      const points = collectExerciseHistory(view.sessions, ex);
      if (points.length > 0) {
        out.set(key, {
          name: ex.customId ? ex.name : currentExerciseName(ex.name),
          ...(ex.customId ? { customId: ex.customId } : {}),
          points,
        });
      }
    }
  }
  return out;
}

/** The exercises both runs did, in green's order, then each one's own. Matched
 *  by the exercise's identity, so a renamed one still matches. */
export function compareLifts(green: ProgramRunView, blue: ProgramRunView): {
  both: CompareLift[];
  onlyGreen: CompareLift[];
  onlyBlue: CompareLift[];
} {
  const g = liftsOf(green);
  const b = liftsOf(blue);
  const both: CompareLift[] = [];
  const onlyGreen: CompareLift[] = [];
  const ided = (v: { customId?: string }) => (v.customId ? { customId: v.customId } : {});
  for (const [key, v] of g) {
    const other = b.get(key);
    (other ? both : onlyGreen).push({ key, name: v.name, ...ided(v), green: v.points, blue: other?.points ?? [] });
  }
  const onlyBlue: CompareLift[] = [];
  for (const [key, v] of b) if (!g.has(key)) onlyBlue.push({ key, name: v.name, ...ided(v), green: [], blue: v.points });
  return { both, onlyGreen, onlyBlue };
}

/** A session's planned exercises: its plan when it saved one (0046), else
 *  what it swapped out (an exercise left out without a plan leaves no trace). */
function plannedIn(w: CompletedWorkout, key: string): boolean {
  if (w.plan) return w.plan.some(p => !!p.name && exerciseIdentity(p) === key);
  return w.exercises.some(e => !!e.swappedFrom && exerciseIdentity({ name: e.swappedFrom, customId: e.swappedFromId }) === key);
}

/**
 * The days a run missed `name` on, oldest first: each time a day that has the
 * exercise came round in the run (occurrencesOfDay, the session track's
 * schedule) and it wasn't done: the day missed, trained without it while it
 * was planned (nothing ticked counts), or with something else in its place. A
 * day has it when the run did it there, or the program plans it there now. The
 * day's session is the one logged from its date up to the next time the day
 * comes round, so a session logged a day late still fills it. A day it was
 * done on anyway, in another session (another of its days, a custom workout),
 * isn't missed: that session stands in the row instead. Only days already
 * past count (today's isn't missed yet). An earlier run from before runs were
 * kept has no schedule to read, so it has none.
 */
export function missedDates(
  view: ProgramRunView,
  exercise: string | ExerciseRef,
  points: readonly ExerciseDataPoint[],
  todayYMD: string,
): string[] {
  const missed: string[] = [];
  if (view.ref.run === "earlier" || points.length === 0) return missed;
  const key = exerciseIdentity(typeof exercise === "string" ? { name: exercise } : exercise);
  const p = view.program;
  const doneIds = new Set(points.map(q => q.workoutId));
  const doneOn = new Set(points.map(q => q.date));

  const dayIds = new Set<string>();
  for (const w of view.sessions) if (w.dayId && doneIds.has(w.id)) dayIds.add(w.dayId);
  p.cyclePattern.forEach((label, i) => {
    if (!label || label.trim().toLowerCase() === "rest") return;
    if ((p.workouts?.[workoutKey(i, label)] ?? []).some(e => !!e.name && exerciseIdentity(e) === key)) dayIds.add(dayIdAt(p, i));
  });

  const yesterday = addDaysYMD(todayYMD, -1);
  const through = view.endYMD && view.endYMD < yesterday ? view.endYMD : yesterday;
  for (const dayId of dayIds) {
    const occurrences = occurrencesOfDay(p, dayId, through).filter(o => o >= view.startYMD);
    const sessions = view.sessions.filter(w => w.dayId === dayId);
    occurrences.forEach((o, i) => {
      const next = occurrences[i + 1] ?? "9999-12-31";
      const filled = sessions.find(w => w.date >= o && w.date < next);
      if (filled && doneIds.has(filled.id)) return;
      if (filled && !plannedIn(filled, key)) return;
      if (doneOn.has(o)) return;
      missed.push(o);
    });
  }
  return missed.sort();
}

/** One place in a lift's row: a session of it, or a time it came round and
 *  wasn't done (the day it was missed on). */
export type LiftSlot =
  | { point: ExerciseDataPoint; missed?: undefined }
  | { point?: undefined; missed: string };

/**
 * A lift's row in the comparison: every time it came round in the run, its
 * sessions and the days it was missed (missedDates) in date order, a miss
 * before a session of the same day. Slot k is "the (k+1)th session", done or
 * missed, so each program's 5th stands over the same number whatever either
 * missed on the way.
 */
export function liftSlots(points: readonly ExerciseDataPoint[], missed: readonly string[]): LiftSlot[] {
  const out: LiftSlot[] = [];
  let m = 0;
  for (const point of points) {
    while (m < missed.length && missed[m] <= point.date) out.push({ missed: missed[m++] });
    out.push({ point });
  }
  while (m < missed.length) out.push({ missed: missed[m++] });
  return out;
}

/** The heaviest a session lifted at bodyweight: its best set's reps. */
const bestReps = (q: ExerciseDataPoint) => q.sets.reduce((m, s) => (s.reps > m ? s.reps : m), 0);

/**
 * Green against blue at the same point: the latest place in the row both did
 * (each one's Nth session, missed ones counted, so the number is the one on
 * the chart). By top set when both lifted a weight, by the best set's reps
 * when both were at bodyweight; null otherwise. `diff` is green's less blue's:
 * positive is ahead.
 */
export function aheadAtSamePoint(
  green: readonly LiftSlot[],
  blue: readonly LiftSlot[],
): { session: number; diff: number; by: "weight" | "reps" } | null {
  for (let k = Math.min(green.length, blue.length) - 1; k >= 0; k--) {
    const g = green[k].point;
    const b = blue[k].point;
    if (!g || !b) continue;
    if (g.topWeight > 0 && b.topWeight > 0) return { session: k + 1, diff: g.topWeight - b.topWeight, by: "weight" };
    if (g.topWeight === 0 && b.topWeight === 0 && !g.isHold && !b.isHold) return { session: k + 1, diff: bestReps(g) - bestReps(b), by: "reps" };
    return null;
  }
  return null;
}

/** A lift's change across a run, first session to `upTo` (all of them by
 *  default), by top set: null with fewer than two weighted sessions. */
export function liftChange(points: readonly ExerciseDataPoint[], upTo: number = points.length): number | null {
  const drawn = points.slice(0, upTo).filter(q => drawsOn(q, "strength"));
  if (drawn.length < 2) return null;
  return percentChange(chartValue(drawn[0], "strength"), chartValue(drawn[drawn.length - 1], "strength"));
}

/**
 * At a glance's "Strength, shared lifts": the average change in top set over
 * the lifts both runs did with a weight. "same", each lift over as many
 * sessions as the side with fewer did; "whole", each side over all of its
 * own. Null on a side with none to measure.
 */
export function sharedStrength(lifts: readonly CompareLift[], span: CompareSpan): { green: number | null; blue: number | null } {
  const g: number[] = [];
  const b: number[] = [];
  for (const l of lifts) {
    if (!l.green.length || !l.blue.length) continue;
    const n = span === "same" ? Math.min(l.green.length, l.blue.length) : undefined;
    const cg = liftChange(l.green, n);
    const cb = liftChange(l.blue, n);
    if (cg === null || cb === null) continue;
    g.push(cg);
    b.push(cb);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return { green: avg(g), blue: avg(b) };
}
