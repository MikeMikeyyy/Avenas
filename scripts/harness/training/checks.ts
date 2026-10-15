// What the lifter would SEE, held to what they DID.
//
// Each screen is computed the way the screen computes it: through the app's
// own functions, put together as the screen puts them together (with where
// from). What it should say is worked out separately, from the lifter's ledger
// (./lifter.ts): what was typed, in which unit, and when each session really
// finished. Never from the app's own helpers, or a check would only agree with
// itself.
//
//   progress/      the Progress page: volume / reps / time bars for every
//                  program scope and range, the Exercise Progress day list, the
//                  exercise chart, its records, and the Exercise History page
//                  the chart opens
//   chart-layout/  the exercise chart on every phone width: every session in
//                  reach, the newest on screen when it opens, and on every
//                  screenful a scroll stops on, an axis that reads cleanly with
//                  every dot, block and bar inside the plot
//   program-page/  the program page the Journal opens: weeks and totals
//   home/          this week's ring and totals, Recent Activity
//   hints/         the Workout tab's "Previous" sets and notes, and its "Last
//                  session:" lines (what the last session moved, swapped, skipped)
//   save/          a saved session: weights read back as typed, PR cards
//   journal/       a saved session's "Planned 2nd" / "Instead of" / "Added"
//                  lines, its Skipped rows and its card's summary
//   compare/       the Progress page comparing the program on the go with a
//                  finished one: which runs it offers, which it starts from
//                  with nothing on the go, each run's sessions, its weekly
//                  volume, At a glance, and the exercises both did with each
//                  one's sessions lined up and the gap at the same point

import {
  bucketMetricByDay, bucketMetricByMonth, bucketMetricByRollingWeeks, collectExerciseHistory,
  collectLoggedExercisesForDay, computePRs, computeWorkoutDurationMinutes, computeWorkoutReps,
  computeWorkoutTonnage, filterByProgramScope, getRangeOption, rangeWindow, scopedProgramDays,
  sessionCountForDay, yearBarCount,
} from "../../../utils/progressStats";
import { programFinishDate, type CompletedWorkout, type PlannedExercise, type ProgramDayRef, type SavedProgram } from "../../../constants/programs";
import { lastTimeCues, sessionChanges } from "../../../utils/exerciseChanges";
import type { ExerciseDataPoint, ExerciseMetricKey, MetricKey, ProgramScope, RangeKey } from "../../../constants/progress";
import { EXERCISE_METRIC_OPTIONS } from "../../../constants/progress";
import { EXERCISES } from "../../../constants/exerciseData";
import { exerciseHistoryRows } from "../../../utils/exerciseHistory";
import {
  CHART_HEIGHT, LABEL_H, LABEL_INK_DOWN, LABEL_INK_UP, LINE_STROKE, PLOT_TOP,
  axisLoadStep, chartChange, chartValue, dotY, drawsOn, exerciseChartGeometry, setStacks, slotX, strengthDots, strengthLabel,
  strengthLabelInkWidth, visibleSlots, volumeBars, windowAxis, type ExerciseChartGeometry,
} from "../../../utils/exerciseChartLayout";
import { buildProgramHistory } from "../../../utils/programHistory";
import { buildWeekSchedule, weekStartFor, weekTotals } from "../../../utils/weekSchedule";
import { addDaysYMD, toYMD } from "../../../utils/dates";
import {
  buildPrevNoteLookup, buildPrevSetsLookup, getEffectiveToday, lastSessionOfDay, prevDayScopeFor, resolveWorkoutForDate, type DayOverride,
} from "../../../utils/workout";
import { formatPrevHint, formatWeightForDisplay, trimNumber } from "../../../utils/units";
import { detectWorkoutAchievements } from "../../../utils/achievements";
import { EMPTY_ACHIEVEMENTS } from "../../../constants/achievements";
import {
  aheadAtSamePoint, compareCandidates, compareLifts, glanceStats, greenRunFor, liftSlots, missedDates, runDays, weeklyTotals,
} from "../../../utils/programCompare";
import type { ProgramRunView } from "../../../utils/programRuns";
import type { AfterSave, BeforeLog, LedgerExercise, LedgerSession, Lifter, ProgramRun } from "./lifter";
import { LIFTS } from "./programs";

export type Problem = { code: string; what: string };

const KG_PER_LB = 0.45359237;
const LB_PER_KG = 1 / KG_PER_LB;
const DAY_MS = 86_400_000;

// ─── The ledger's own arithmetic ─────────────────────────────────────────────

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** A typed weight in kg, or null for none. */
function kgOf(typed: string, unit: "kg" | "lb"): number | null {
  const n = num(typed);
  if (n === null) return null;
  return unit === "kg" ? n : n * KG_PER_LB;
}

/** Working sets that were done, with their kg and reps (null when blank). */
function workingDone(s: LedgerSession, e: LedgerExercise) {
  return e.sets
    .filter(x => x.type === "working" && x.done)
    .map(x => ({ kg: kgOf(x.weight, s.unit), reps: num(x.reps) }));
}

/** Kilos moved. A timed hold moves none: its "reps" are seconds. */
function tonnage(s: LedgerSession): number {
  let t = 0;
  for (const e of s.exercises) {
    if (e.kind === "hold") continue;
    for (const x of workingDone(s, e)) if (x.kg && x.kg > 0 && x.reps && x.reps > 0) t += x.kg * x.reps;
  }
  return t;
}

/** Reps done in working sets. A timed hold's "reps" are seconds, which aren't
 *  reps, so they're left out unless `holds` says otherwise. */
function repsDone(s: LedgerSession, holds = false): number {
  let t = 0;
  for (const e of s.exercises) {
    if (e.kind === "hold" && !holds) continue;
    for (const x of workingDone(s, e)) if (x.reps && x.reps > 0) t += x.reps;
  }
  return t;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Stored kg keep three decimals, so a sum can drift by that per set. */
const tolFor = (sessions: LedgerSession[]) => 0.01 + 0.001 * sessions.reduce((n, s) => n + repsDone(s, true), 0);

const norm = (s: string) => s.trim().toLowerCase();

/** Which exercise a typed name is now. A renamed exercise keeps its former
 *  names in the catalogue (`formerNames`), and a session logged under one of
 *  them is that exercise's, shown under its current name. Read from the
 *  catalogue's data, not the app's lookup. Day names never go through this. */
const CURRENT = new Map<string, string>();
for (const e of EXERCISES) for (const f of e.formerNames ?? []) CURRENT.set(norm(f), norm(e.name));
const liftKey = (s: string) => CURRENT.get(norm(s)) ?? norm(s);
const kindOf = (name: string) => Object.entries(LIFTS).find(([n]) => liftKey(n) === liftKey(name))?.[1].kind ?? "weighted";

/** The sessions logged on a program day, by the ledger: its program, and its
 *  slot (or for a custom workout added to it, its name). */
function ledgerOnDay(sessions: LedgerSession[], day: ProgramDayRef): LedgerSession[] {
  if (day.dayId.startsWith("extra:")) {
    return sessions.filter(s => s.programId === day.programId && !s.dayId && norm(s.workoutName) === norm(day.label));
  }
  return sessions.filter(s => s.programId === day.programId && s.dayId === day.dayId);
}

/** The run of `programId` going now (or its last). */
function currentRun(runs: ProgramRun[], programId: string): ProgramRun | null {
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].programId === programId) return runs[i];
  return null;
}

const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort().join(",");
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Roughly how wide a date label is drawn: Nunito at 10pt. */
function labelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[0-9]/.test(ch) ? 5.6 : ch === "/" ? 3.4 : /[A-Z]/.test(ch) ? 6.6 : 5.4;
  return w;
}

// ─── The state a check reads ─────────────────────────────────────────────────

export type Snapshot = {
  history: CompletedWorkout[];
  programs: SavedProgram[];
  override: DayOverride | null;
  now: Date;
  calendarToday: string;
  /** The day the Workout tab is on (getEffectiveToday). */
  today: string;
  isKg: boolean;
};

export async function snapshot(l: Lifter): Promise<Snapshot> {
  const programs = await l.readPrograms();
  const history = await l.readHistory();
  const active = programs.find(p => p.status === "active") ?? null;
  const now = new Date();
  return {
    history, programs, override: await l.readOverride(), now,
    calendarToday: toYMD(now),
    today: getEffectiveToday(active, history),
    isKg: l.unit === "kg",
  };
}

// ─── Progress page ───────────────────────────────────────────────────────────

const RANGES: RangeKey[] = ["thisWeek", "lastWeek", "thisMonth", "last3Months", "year"];
const METRICS: MetricKey[] = ["volume", "reps", "duration"];

/** The window the range should cover, worked out on its own: [first, last]
 *  inclusive, today included, and how many bars. */
function expectedWindow(range: RangeKey, today: string, earliest: string | null): { start: string; end: string; bars: number } {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const monday = addDaysYMD(today, dow === 0 ? -6 : 1 - dow);
  const firstOfMonth = (back: number) => toYMD(new Date(y, m - 1 - back, 1));
  switch (range) {
    case "thisWeek": return { start: monday, end: today, bars: 7 };
    case "lastWeek": return { start: addDaysYMD(monday, -7), end: addDaysYMD(monday, -1), bars: 7 };
    case "thisMonth": return { start: addDaysYMD(monday, -21), end: today, bars: 4 };
    case "last3Months": return { start: firstOfMonth(2), end: today, bars: 3 };
    case "year": {
      let spanned = 3;
      if (earliest) {
        const [ey, em] = earliest.split("-").map(Number);
        spanned = Math.min(12, Math.max(3, (y - ey) * 12 + (m - em) + 1));
      }
      return { start: firstOfMonth(spanned - 1), end: today, bars: spanned };
    }
  }
}

/** ProgressView's bars for one scope, range and metric (its `buckets` and
 *  `volumeSlotsCount` memos). */
function progressBars(snap: Snapshot, scope: ProgramScope, range: RangeKey, metric: MetricKey) {
  const scoped = filterByProgramScope(snap.history, scope, snap.programs);
  let earliest: string | null = null;
  for (const w of scoped) if (earliest === null || w.date < earliest) earliest = w.date;
  const win = rangeWindow(range, snap.now, earliest);
  const aggregate = metric === "volume" ? computeWorkoutTonnage : metric === "reps" ? computeWorkoutReps : computeWorkoutDurationMinutes;
  const kind = getRangeOption(range).bucket;
  const buckets = kind === "day" ? bucketMetricByDay(scoped, win.startYMD, win.chartEndYMD, aggregate)
    : kind === "rollingWeeks" ? bucketMetricByRollingWeeks(scoped, win.startYMD, win.chartEndYMD, aggregate)
    : bucketMetricByMonth(scoped, win.startYMD, win.chartEndYMD, aggregate);
  const slots = range === "thisWeek" || range === "lastWeek" ? 7 : range === "thisMonth" ? 4 : range === "last3Months" ? 3 : yearBarCount(snap.now, earliest);
  return { scoped, earliest, buckets, slots };
}

function scopesFor(snap: Snapshot): { scope: ProgramScope; label: string; programId: string | null }[] {
  const active = snap.programs.find(p => p.status === "active") ?? null;
  return [
    { scope: { kind: "all" }, label: "All programs", programId: null },
    ...(active ? [{ scope: { kind: "current" } as ProgramScope, label: `Current (${active.name})`, programId: active.id }] : []),
    ...snap.programs.map(p => ({ scope: { kind: "program", programId: p.id } as ProgramScope, label: p.name, programId: p.id })),
  ];
}

export function checkProgressBars(l: Lifter, snap: Snapshot): Problem[] {
  const out: Problem[] = [];
  for (const { scope, label, programId } of scopesFor(snap)) {
    const mine = l.sessions.filter(s => programId === null || s.programId === programId);
    let earliest: string | null = null;
    for (const s of mine) if (earliest === null || s.date < earliest) earliest = s.date;
    for (const range of RANGES) {
      const win = expectedWindow(range, snap.calendarToday, earliest);
      const inWindow = mine.filter(s => s.date >= win.start && s.date <= win.end);
      for (const metric of METRICS) {
        const { buckets, slots } = progressBars(snap, scope, range, metric);
        const where = `${label}, ${range}, ${metric}`;
        if (buckets.length !== win.bars || slots !== buckets.length) {
          out.push({ code: "progress/bucket-count", what: `${where}: ${buckets.length} bars drawn on ${slots} slots; the range has ${win.bars}` });
        }
        // Every session in the window in exactly one bar, and nothing else.
        const counted = buckets.flatMap(b => b.workoutIds);
        if (counted.length !== new Set(counted).size) out.push({ code: "progress/bucket-sessions", what: `${where}: a session is counted in two bars` });
        if ([...counted].sort().join(",") !== ids(inWindow)) {
          const missing = inWindow.filter(s => !counted.includes(s.id)).map(s => `${s.workoutName} ${s.date}`);
          const extra = counted.filter(id => !inWindow.some(s => s.id === id));
          out.push({ code: "progress/bucket-sessions", what: `${where}: bars hold the wrong sessions (${win.start}..${win.end}); missing ${missing.join(", ") || "none"}, extra ${extra.length}` });
        }
        const total = buckets.reduce((n, b) => n + b.total, 0);
        if (metric === "volume") {
          const want = inWindow.reduce((n, s) => n + tonnage(s), 0);
          if (!near(total, want, tolFor(inWindow))) out.push({ code: "progress/bucket-total", what: `${where}: bars add to ${fmt(total)} kg; logged ${fmt(want)} kg` });
        } else if (metric === "reps") {
          const want = inWindow.reduce((n, s) => n + repsDone(s), 0);
          const withHolds = inWindow.reduce((n, s) => n + repsDone(s, true), 0);
          if (total !== want) {
            out.push(total === withHolds && withHolds !== want
              ? { code: "progress/hold-seconds-as-reps", what: `${where}: the Reps bars count a plank's seconds as reps (${total} shown, ${want} reps done, ${withHolds - want} were seconds held)` }
              : { code: "progress/bucket-total", what: `${where}: bars add to ${total} reps; ${want} done` });
          }
        } else {
          const want = inWindow.reduce((n, s) => n + s.durationSeconds / 60, 0);
          if (!near(total, want, 0.001)) out.push({ code: "progress/bucket-total", what: `${where}: bars add to ${fmt(total)} min; logged ${fmt(want)} min` });
        }
      }
    }
  }
  return out;
}

/** One chart as the page draws it: the selected (day, exercise)'s points. */
type DrawnChart = { day: ProgramDayRef; name: string; points: ExerciseDataPoint[]; scopeLabel: string };

/** The Exercise Progress list and every chart it opens, for the scopes a
 *  lifter uses most. */
export function checkProgressDays(l: Lifter, snap: Snapshot): { problems: Problem[]; charts: DrawnChart[] } {
  const out: Problem[] = [];
  const charts: DrawnChart[] = [];
  const counts = new Map<string, Map<string, number>>(); // day key → scope → count
  for (const { scope, label, programId } of scopesFor(snap)) {
    const scoped = filterByProgramScope(snap.history, scope, snap.programs);
    const days = scopedProgramDays(scope, snap.programs, scoped);
    const mine = l.sessions.filter(s => programId === null || s.programId === programId);
    for (const day of days) {
      const where = `${label}: ${day.programName} ${day.label} (${day.dayId})`;
      const logged = ledgerOnDay(mine, day);
      const shown = sessionCountForDay(scoped, day);
      (counts.get(day.key) ?? counts.set(day.key, new Map()).get(day.key)!).set(label, shown);
      if (shown !== logged.length) {
        const leaked = shown > logged.length && day.dayId.startsWith("extra:")
          ? ` (free "${day.label}" workouts that aren't this program's count on it)` : "";
        out.push({ code: "progress/day-count", what: `${where}: the row says ${shown} sessions; ${logged.length} were logged on it${leaked}` });
      }

      // The day's exercises: every one logged on it, each with its sessions.
      const rows = collectLoggedExercisesForDay(scoped, day);
      const names = new Map<string, { name: string; sessions: number }>();
      for (const s of logged) {
        for (const n of new Set(s.exercises.map(e => liftKey(e.name)))) {
          const e = s.exercises.find(x => liftKey(x.name) === n)!;
          names.set(n, { name: e.name, sessions: (names.get(n)?.sessions ?? 0) + 1 });
        }
      }
      // (Only the names show: a row's sessionCount and last set aren't drawn.)
      // Read as shown, so a row for a renamed exercise must carry its new name.
      const shownNames = rows.map(r => norm(r.name)).sort().join(", ");
      if (shownNames !== [...names.keys()].sort().join(", ")) {
        out.push({ code: "progress/exercise-rows", what: `${where}: lists ${shownNames || "nothing"}; logged ${[...names.keys()].sort().join(", ") || "nothing"}` });
      }

      // Each exercise's chart, its records, and the history page it opens.
      if (scope.kind === "program") continue;
      for (const r of rows) {
        const points = collectExerciseHistory(scoped, r.name, day);
        charts.push({ day, name: r.name, points, scopeLabel: label });
        out.push(...checkChart(l, snap, scoped, day, r.name, points, logged, where));
      }
    }
  }
  // One program day reads the same under All programs as under its program.
  for (const byScope of counts.values()) {
    const values = new Set(byScope.values());
    if (values.size > 1) {
      out.push({ code: "progress/day-count-scope", what: `a day row counts differently by scope: ${[...byScope].map(([s, n]) => `${s} ${n}`).join(", ")}` });
    }
  }
  return { problems: out, charts };
}

function checkChart(
  l: Lifter, snap: Snapshot, scoped: CompletedWorkout[], day: ProgramDayRef, name: string,
  points: ExerciseDataPoint[], logged: LedgerSession[], where: string,
): Problem[] {
  const out: Problem[] = [];
  const at = `${where} › ${name}`;
  const kind = kindOf(name);
  // Sessions that did it: a working set done with reps. (A timed hold's chart
  // isn't held to this: its "reps" are seconds, see hold-seconds-as-reps.)
  const did = logged
    .filter(s => s.exercises.some(e => liftKey(e.name) === liftKey(name) && workingDone(s, e).some(x => x.reps && x.reps > 0)))
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const plotted = points.map(p => p.workoutId);
  if (kind !== "hold") {
    const missing = did.filter(s => !plotted.includes(s.id));
    if (missing.length > 0) {
      const bodyweight = missing.every(s => s.exercises.filter(e => liftKey(e.name) === liftKey(name))
        .every(e => workingDone(s, e).every(x => !x.kg || x.kg <= 0)));
      out.push(bodyweight
        ? { code: "progress/chart-bodyweight", what: `${at}: ${missing.length} of ${did.length} sessions done at bodyweight have no dot (the chart says "${points.length === 0 ? "No sessions yet" : `Sessions logged · ${points.length}`}")` }
        : { code: "progress/chart-sessions", what: `${at}: the chart leaves out ${missing.map(s => s.date).join(", ")}` });
    }
  }
  const extra = plotted.filter(id => !logged.some(s => s.id === id));
  if (extra.length > 0) out.push({ code: "progress/chart-sessions", what: `${at}: the chart plots ${extra.length} sessions not done on this day` });

  // In the order they were done, with what was lifted.
  const order = did.filter(s => plotted.includes(s.id)).map(s => s.id).join(",");
  const drawn = points.filter(p => did.some(s => s.id === p.workoutId)).map(p => p.workoutId).join(",");
  if (order !== drawn) out.push({ code: "progress/chart-order", what: `${at}: dots aren't in the order the sessions were done` });
  for (const p of points) {
    const s = l.sessions.find(x => x.id === p.workoutId);
    if (!s) continue;
    const sets = s.exercises.filter(e => liftKey(e.name) === liftKey(name)).flatMap(e => workingDone(s, e))
      .filter(x => x.kg && x.kg > 0 && x.reps && x.reps > 0) as { kg: number; reps: number }[];
    const top = Math.max(0, ...sets.map(x => x.kg));
    const volume = sets.reduce((n, x) => n + x.kg * x.reps, 0);
    if (!near(p.topWeight, top, 0.002) || !near(p.sessionVolume, volume, 0.01 + 0.001 * sets.length * 20)) {
      out.push({ code: "progress/chart-values", what: `${at} ${s.date}: dot reads ${fmt(p.topWeight)} kg top / ${fmt(p.sessionVolume)} volume; lifted ${fmt(top)} / ${fmt(volume)}` });
    }
    // Est. 1RM: the best set, as weight × (1 + reps / 30). A timed hold has
    // none: its "reps" are seconds.
    const e1rm = kind === "hold" ? 0 : Math.max(0, ...sets.map(x => x.kg * (1 + x.reps / 30)));
    if (!near(p.e1rm, e1rm, 0.01)) {
      out.push({ code: "progress/chart-e1rm", what: `${at} ${s.date}: Est. 1RM reads ${fmt(p.e1rm)} kg; the best set lifted works out at ${fmt(e1rm)}` });
    }
  }

  // Each tab's sessions: Sets every session it was done in, Strength the
  // sessions with weight on the bar.
  const weighted = did.filter(s => s.exercises.some(e => liftKey(e.name) === liftKey(name)
    && workingDone(s, e).some(x => x.kg && x.kg > 0 && x.reps && x.reps > 0)));
  for (const metric of ["strength", "sets"] as const) {
    const want = (metric === "sets" ? did : weighted).map(s => s.id).join(",");
    const got = points.filter(p => drawsOn(p, metric)).map(p => p.workoutId).filter(id => did.some(s => s.id === id)).join(",");
    if (kind !== "hold" && want !== got) {
      out.push({ code: "progress/chart-metric", what: `${at}: ${metric === "sets" ? "Sets" : "Strength"} draws ${got.split(",").filter(Boolean).length} sessions; ${(metric === "sets" ? did : weighted).length} should show there` });
    }
  }

  // Sets: a block for every working set lifted, in the order lifted, with its
  // own weight and reps (a hold's seconds).
  const liftedSets = (s: LedgerSession) => s.exercises.filter(e => liftKey(e.name) === liftKey(name)).flatMap(e => workingDone(s, e))
    .filter(x => x.reps && x.reps > 0).map(x => ({ kg: x.kg && x.kg > 0 ? x.kg : 0, reps: x.reps! }));
  for (const p of points) {
    const s = l.sessions.find(x => x.id === p.workoutId);
    if (!s) continue;
    const want = liftedSets(s);
    if (want.length !== p.sets.length || want.some((w, i) => p.sets[i].reps !== w.reps || !near(p.sets[i].weight, w.kg, 0.002))) {
      out.push({ code: "progress/chart-sets", what: `${at} ${s.date}: Sets draws ${p.sets.map(x => `${fmt(x.weight)}×${x.reps}`).join(" ")}; lifted ${want.map(x => `${fmt(x.kg)}×${x.reps}`).join(" ")}` });
    }
  }

  // The records under the chart: weights only, so none from a bodyweight set.
  const prs = computePRs(points, scoped, name, day);
  const withWeight = points.filter(p => p.topWeight > 0);
  if (withWeight.length === 0) {
    if (prs.heaviest || prs.bestSetVolume || prs.bestSessionVolume) {
      out.push({ code: "progress/pr-tiles", what: `${at}: done only at bodyweight, yet a record reads ${fmt(prs.heaviest?.value ?? prs.bestSetVolume?.value ?? prs.bestSessionVolume?.value ?? 0)}` });
    }
  } else {
    const heaviest = Math.max(...withWeight.map(p => p.topWeight));
    if (!prs.heaviest || !near(prs.heaviest.value, heaviest, 0.002)) {
      out.push({ code: "progress/pr-tiles", what: `${at}: Heaviest says ${prs.heaviest ? fmt(prs.heaviest.value) : "—"}; the chart's heaviest is ${fmt(heaviest)}` });
    }
    const best = Math.max(...withWeight.map(p => p.sessionVolume));
    if (!prs.bestSessionVolume || !near(prs.bestSessionVolume.value, best, 0.01)) {
      out.push({ code: "progress/pr-tiles", what: `${at}: Most Volume says ${prs.bestSessionVolume ? fmt(prs.bestSessionVolume.value) : "—"}; the chart's best is ${fmt(best)}` });
    }
  }

  // Most reps: the most reps done in a set, bodyweight included, at the
  // heaviest weight that did them; and the set it names is the block Sets
  // draws gold.
  const everySet = did.flatMap(s => liftedSets(s));
  if (everySet.length > 0) {
    const maxReps = Math.max(...everySet.map(x => x.reps));
    const heaviestAt = Math.max(...everySet.filter(x => x.reps === maxReps).map(x => x.kg));
    const m = prs.mostReps;
    if (!m || m.value !== maxReps || !near(m.weight ?? 0, heaviestAt, 0.002)) {
      out.push({ code: "progress/pr-most-reps", what: `${at}: Most reps reads ${m ? `${m.value} at ${fmt(m.weight ?? 0)}` : "—"}; the most lifted was ${maxReps} at ${fmt(heaviestAt)}` });
    } else {
      const block = points.find(p => p.workoutId === m.workoutId)?.sets[m.setIndex ?? -1];
      if (!block || block.reps !== m.value || !near(block.weight, m.weight ?? 0, 0.002)) {
        out.push({ code: "progress/pr-most-reps", what: `${at}: Most reps names set ${(m.setIndex ?? -1) + 1} on ${m.date}, which wasn't ${m.value} reps` });
      }
    }
  }
  // Estimated 1RM, the record row marked as an estimate: the best set lifted,
  // as weight × (1 + reps / 30). A timed hold has none.
  if (kind !== "hold") {
    const best = Math.max(0, ...everySet.filter(x => x.kg > 0).map(x => x.kg * (1 + x.reps / 30)));
    if (best > 0 ? !prs.oneRepMax || !near(prs.oneRepMax.value, best, 0.01) : prs.oneRepMax !== null) {
      out.push({ code: "progress/pr-e1rm", what: `${at}: Estimated 1RM reads ${prs.oneRepMax ? fmt(prs.oneRepMax.value) : "—"}; the best set lifted works out at ${fmt(best)}` });
    }
  }

  // What the two tiles and the header say, from what was lifted (a timed
  // hold moves no volume and has no 1RM): Best Set is a set that was done,
  // the heaviest by weight × reps ("90 kg × 8"); Most Volume, the sets and
  // reps of the session that moved the most ("4 sets · 38 reps"); and the
  // header's % change, each line's last session against its first.
  if (kind !== "hold") {
    const rows = did.map(s => ({
      s,
      sets: s.exercises.filter(e => liftKey(e.name) === liftKey(name)).flatMap(e => workingDone(s, e))
        .filter(x => x.kg && x.kg > 0 && x.reps && x.reps > 0) as { kg: number; reps: number }[],
    })).filter(r => r.sets.length > 0);
    if (rows.length > 0) {
      const maxSet = Math.max(...rows.flatMap(r => r.sets.map(x => x.kg * x.reps)));
      const set = prs.bestSetVolume;
      const setDone = !!set && set.weight != null && set.reps != null
        && rows.some(r => r.sets.some(x => near(x.kg, set.weight!, 0.002) && x.reps === set.reps && near(x.kg * x.reps, maxSet, 0.5)));
      if (!set || !near(set.value, maxSet, 0.5) || !setDone) {
        out.push({ code: "progress/pr-best-set", what: `${at}: Best Set reads ${set ? `${fmt(set.weight ?? 0)} × ${set.reps ?? 0} (${fmt(set.value)})` : "—"}; the best set lifted was ${fmt(maxSet)}` });
      }
      const sessions = rows.map(r => ({
        vol: r.sets.reduce((n, x) => n + x.kg * x.reps, 0), sets: r.sets.length, reps: r.sets.reduce((n, x) => n + x.reps, 0),
      }));
      const maxVol = Math.max(...sessions.map(v => v.vol));
      const most = prs.bestSessionVolume;
      if (!most || !sessions.some(v => near(v.vol, maxVol, 0.5) && v.sets === most.sets && v.reps === most.reps)) {
        out.push({ code: "progress/pr-most-volume", what: `${at}: Most Volume reads ${most ? `${most.sets} sets · ${most.reps} reps` : "—"}; the session that moved ${fmt(maxVol)} kg had ${sessions.filter(v => near(v.vol, maxVol, 0.5)).map(v => `${v.sets} sets · ${v.reps} reps`).join(" or ")}` });
      }
      for (const [metric, values] of [
        ["strength", rows.map(r => Math.max(...r.sets.map(x => x.kg)))],
        ["volume", sessions.map(v => v.vol)],
      ] as const) {
        const shown = chartChange(points, metric);
        const want = values.length >= 2 ? ((values[values.length - 1] - values[0]) / values[0]) * 100 : null;
        const agrees = shown === null
          ? want === null
          : want !== null && near(shown.pct, want, 0.05) && shown.sinceYMD === rows[0].s.date;
        if (!agrees) {
          out.push({ code: "progress/chart-change", what: `${at}: ${metric} reads ${shown ? `${fmt(shown.pct)}% since ${shown.sinceYMD}` : "no change"}; lifted ${want === null ? "one session" : `${fmt(want)}% since ${rows[0].s.date}`}` });
        }
      }
    }
  }

  // "See Exercise History": the same sessions as the chart it's opened from.
  const page = exerciseHistoryRows(snap.history, snap.programs, {
    exerciseName: name, dayName: day.label, dayId: day.dayId, programId: day.programId, days: 365, today: snap.now,
  });
  const cutoff = addDaysYMD(snap.calendarToday, -365);
  const shouldList = logged.filter(s => s.date >= cutoff && s.exercises.some(e => liftKey(e.name) === liftKey(name) && e.sets.some(x => x.done)));
  if (ids(page.map(r => ({ id: r.workoutId }))) !== ids(shouldList)) {
    const others = page.filter(r => !shouldList.some(s => s.id === r.workoutId));
    const fromOther = others.map(r => l.sessions.find(s => s.id === r.workoutId)).filter(Boolean) as LedgerSession[];
    const why = fromOther.length > 0
      ? ` (it also lists ${fromOther.length} from ${[...new Set(fromOther.map(s => `${programName(snap, s.programId)} ${s.workoutName}`))].join(", ")})`
      : "";
    out.push({ code: "progress/history-page", what: `${at}: Exercise History lists ${page.length} sessions, the chart's day has ${shouldList.length}${why}` });
  }
  return out;
}

function programName(snap: Snapshot, id: string): string {
  return id ? snap.programs.find(p => p.id === id)?.name ?? id : "a free workout's";
}

// ─── The exercise chart's layout ─────────────────────────────────────────────

const WIDTHS = [375, 390, 393, 402, 428, 430, 440];

/**
 * The exercise chart as it's drawn (utils/exerciseChartLayout.ts), on every
 * phone width: every session in reach of the scroll and the newest on screen
 * when it opens; then every screenful the row can stop on, a slot at a time:
 * an axis that steps by the load jump on Strength, never repeats or dips below
 * zero, shows a real change across the plot without stretching a wobble, and
 * holds every dot, block and bar on screen (and the numbers over them) inside
 * the chart.
 */
export function checkChartLayout(drawn: DrawnChart[]): Problem[] {
  const out: Problem[] = [];
  for (const c of drawn) {
    const points = c.points;
    const n = points.length;
    if (n === 0) continue;
    const name = `${c.day.programName} ${c.day.label} › ${c.name} (${n} sessions)`;
    for (const width of WIDTHS) {
      const g = exerciseChartGeometry(n, width);
      if (slotX(g, 0) < g.spacing / 2 - 0.01 || slotX(g, n - 1) > g.contentWidth - g.spacing / 2 + 0.01) {
        out.push({ code: "chart-layout/slot-outside", what: `${name} on ${width}pt: the row is ${fmt(g.contentWidth)} wide, its slots run ${fmt(slotX(g, 0))}..${fmt(slotX(g, n - 1))}` });
      }
      // It opens on the newest, wholly on screen.
      const newest = slotX(g, n - 1) - g.maxScrollX;
      const opened = visibleSlots(g, n, g.maxScrollX);
      if (newest - g.spacing / 2 < -0.01 || newest + g.spacing / 2 > g.viewportWidth + 0.01 || opened.last !== n - 1) {
        out.push({ code: "chart-layout/newest-hidden", what: `${name} on ${width}pt: it opens on sessions ${opened.first + 1}–${opened.last + 1}, the newest at ${fmt(newest)} of ${fmt(g.viewportWidth)}` });
      }
    }
    // Every screenful a scroll can stop on, a slot at a time (on a 390pt
    // phone: the axis depends on which sessions are on screen, not the width).
    const g = exerciseChartGeometry(n, 390);
    const seen = new Set<string>();
    for (let x = g.maxScrollX; ; x = Math.max(0, x - g.spacing)) {
      const { first, last } = visibleSlots(g, n, x);
      if (!seen.has(`${first}-${last}`)) {
        seen.add(`${first}-${last}`);
        for (const metric of EXERCISE_METRIC_OPTIONS.map(o => o.key)) {
          out.push(...checkScreenful(points, metric, first, last, g, `${name}, sessions ${first + 1}–${last + 1} on ${metric}`));
        }
      }
      if (x === 0) break;
    }
  }
  return out;
}

function checkScreenful(
  points: ExerciseDataPoint[], metric: ExerciseMetricKey, first: number, last: number, g: ExerciseChartGeometry, at: string,
): Problem[] {
  const out: Problem[] = [];
  const on = points.slice(first, last + 1).filter(p => drawsOn(p, metric));
  if (on.length === 0) return out;
  const axis = windowAxis(points, metric, first, last)!;
  const values = on.map(p => chartValue(p, metric));
  if (new Set(axis.labels).size !== axis.labels.length) {
    out.push({ code: "chart-layout/axis-repeat", what: `${at}: the y-axis reads ${axis.labels.join(", ")}` });
  }
  if (axis.min < 0) out.push({ code: "chart-layout/axis-below-zero", what: `${at}: the y-axis starts at ${fmt(axis.min)}` });
  // A bar's height is its value: Sets and Volume stand on zero.
  if (metric !== "strength" && axis.min !== 0) {
    out.push({ code: "chart-layout/bars-off-zero", what: `${at}: the bars stand on ${fmt(axis.min)}, not zero` });
  }
  const inPlot = (y: number) => y >= PLOT_TOP - 0.01 && y <= PLOT_TOP + CHART_HEIGHT + 0.01;
  const shown = (slot: number) => slot >= first && slot <= last;
  if (metric === "strength") {
    // Strength reads in the jumps the weights were loaded in: sessions loaded
    // mainly 5 kg at a time read "40, 50, 60", never "44, 48, 52" (user
    // report, 2026-10-12).
    const jump = axisLoadStep(values);
    const off = jump === null ? [] : axis.labels.map((_, i) => axis.min + i * axis.stepValue)
      .filter(v => Math.abs(v - Math.round(v / jump) * jump) > 0.01);
    if (off.length) {
      out.push({ code: "chart-layout/axis-off-load", what: `${at}: weights loaded ${jump} at a time read against ${axis.labels.join(", ")}` });
    }
    // Zoomed to the dots: a change worth seeing fills the plot, and a wobble
    // stays a wobble.
    const hi = Math.max(...values);
    const lo = Math.min(...values);
    const share = (dotY(lo, axis) - dotY(hi, axis)) / CHART_HEIGHT;
    if (hi - lo >= 0.2 * hi && share < 0.3) {
      out.push({ code: "chart-layout/axis-squash", what: `${at}: sessions from ${fmt(lo)} to ${fmt(hi)} fill ${Math.round(share * 100)}% of the plot (axis ${axis.labels.join(" ")})` });
    }
    if (hi - lo <= 0.05 * hi && share > 0.25) {
      out.push({ code: "chart-layout/axis-stretch", what: `${at}: a ${fmt(hi - lo)} wobble on ${fmt(hi)} spans ${Math.round(share * 100)}% of the plot (axis ${axis.labels.join(" ")})` });
    }
    const dots = strengthDots(points, g, axis);
    for (const [i, d] of dots.entries()) {
      if (!shown(d.slot)) continue;
      if (!inPlot(d.y)) {
        out.push({ code: "chart-layout/dot-outside", what: `${at}: session ${d.slot + 1}'s ${fmt(chartValue(points[d.slot], metric))} dot sits outside the ${axis.labels[0]}–${axis.labels[axis.labels.length - 1]} axis` });
        break;
      }
      if (d.labelY - LABEL_H / 2 < 0 || d.labelY + LABEL_H / 2 > PLOT_TOP + CHART_HEIGHT) {
        out.push({ code: "chart-layout/label-outside", what: `${at}: session ${d.slot + 1}'s reps don't fit over or under its dot` });
        break;
      }
      // Its reps clear of the line either side, by a point at least, walked a
      // quarter of a point at a time (user report, 2026-10-13: a steep climb
      // ran the line through them).
      const half = strengthLabelInkWidth(strengthLabel(points[d.slot])) / 2;
      const ink = { l: d.labelX - half, r: d.labelX + half, t: d.labelY - LABEL_INK_UP, b: d.labelY + LABEL_INK_DOWN };
      let gap = Infinity;
      for (const n of [dots[i - 1], dots[i + 1]]) {
        if (!n) continue;
        const steps = Math.ceil(Math.hypot(n.x - d.x, n.y - d.y) * 4);
        for (let s = 0; s <= steps; s++) {
          const x = d.x + ((n.x - d.x) * s) / steps;
          const y = d.y + ((n.y - d.y) * s) / steps;
          gap = Math.min(gap, Math.hypot(Math.max(ink.l - x, 0, x - ink.r), Math.max(ink.t - y, 0, y - ink.b)) - LINE_STROKE / 2);
        }
      }
      if (gap < 1) {
        out.push({ code: "chart-layout/label-on-line", what: `${at}: session ${d.slot + 1}'s reps sit ${gap.toFixed(1)}pt from the line` });
        break;
      }
    }
  } else if (metric === "sets") {
    for (const st of setStacks(points, g, axis).filter(s => shown(s.slot))) {
      if (!inPlot(st.top) || st.blocks.some(b => !(b.h > 0) || !inPlot(b.y) || !inPlot(b.y + b.h))) {
        out.push({ code: "chart-layout/block-outside", what: `${at}: session ${st.slot + 1}'s stack runs outside the ${axis.labels[0]}–${axis.labels[axis.labels.length - 1]} axis` });
        break;
      }
      // Its weight over it, inside the chart (under its top, it would sit on
      // the blocks).
      if (st.labelY > st.top || st.labelY - LABEL_H / 2 < 0) {
        out.push({ code: "chart-layout/label-outside", what: `${at}: the weight over session ${st.slot + 1} has no room over its stack` });
        break;
      }
    }
  } else {
    for (const b of volumeBars(points, g, axis).filter(b => shown(b.slot))) {
      if (!inPlot(b.y)) {
        out.push({ code: "chart-layout/bar-outside", what: `${at}: session ${b.slot + 1}'s bar runs outside the ${axis.labels[0]}–${axis.labels[axis.labels.length - 1]} axis` });
        break;
      }
      if (b.labelY > b.y || b.labelY - LABEL_H / 2 < 0) {
        out.push({ code: "chart-layout/label-outside", what: `${at}: the kilos over session ${b.slot + 1} have no room over its bar` });
        break;
      }
    }
  }
  return out;
}

// ─── The program page ────────────────────────────────────────────────────────

export function checkProgramPages(l: Lifter, snap: Snapshot): Problem[] {
  const out: Problem[] = [];
  for (const p of snap.programs) {
    const run = currentRun(l.runs, p.id);
    if (!run) continue;
    const page = buildProgramHistory(p, snap.history, snap.today);
    const mine = l.sessions.filter(s => s.programId === p.id && s.date >= run.startYMD);
    const where = `${p.name}'s page (run from ${run.startYMD}, ${p.status}${p.pausedAt ? ", on hold" : ""})`;
    if (page.totals.sessions !== mine.length) {
      const shown = new Set(page.weeks.flatMap(w => w.sessions.map(s => s.id)));
      const dropped = mine.filter(s => !shown.has(s.id));
      const startNow = p.startDate;
      out.push({
        code: dropped.length > 0 && dropped.every(s => s.date < run.startYMD || s.date < startNowYMD(p)) ? "program-page/sessions-before-start" : "program-page/sessions",
        what: `${where}: shows ${page.totals.sessions} sessions; ${mine.length} were logged in this run${dropped.length ? `, ${dropped.length} missing (${dropped.slice(0, 4).map(s => s.date).join(", ")}${dropped.length > 4 ? "…" : ""}); its start date now reads ${startNow}` : ""}`,
      });
    }
    // A past day reads as it did on the day (whatever holds, moves and logs
    // came after), and a hold the run came back from reads as held.
    // Past the program's end the page reads "off" by design (it's over, even
    // while the app keeps scheduling until it's marked complete), and a
    // shelved program's page ends at its last session.
    const finish = programFinishDate(p);
    const lastSession = mine.reduce((m, s) => (s.date > m ? s.date : m), "");
    const endsAt = p.status === "paused" ? lastSession : finish ? toYMD(finish) : "9999-12-31";
    const days = page.weeks.flatMap(w => w.days).filter(d => d.ymd < snap.today && d.ymd >= run.startYMD);
    for (const d of days) {
      const was = l.plans.get(d.ymd);
      if (!was || was.programId !== p.id || d.ymd > endsAt) continue;
      const ok = was.planned
        ? d.state === "trained" || d.state === "missed" || d.state === "replaced"
        : d.state === "rest" || d.state === "trained" || d.state === "held" || d.state === "off";
      if (!ok) {
        out.push({ code: "program-page/day-rewritten", what: `${where}: ${d.ymd} reads ${d.state}; that day had ${was.planned ? "a workout planned" : "nothing planned"}` });
        break;
      }
    }
    for (const h of l.holds.filter(x => x.programId === p.id && x.from >= run.startYMD)) {
      const wrong = days.find(d => d.ymd >= h.from && d.ymd < (h.to ?? snap.today) && d.state !== "held" && d.state !== "trained");
      if (wrong) out.push({ code: "program-page/hold", what: `${where}: ${wrong.ymd}, on hold from ${h.from}${h.to ? ` to ${h.to}` : ""}, reads ${wrong.state}` });
    }

    // Newest first, a week apart, numbered from the first.
    for (let i = 1; i < page.weeks.length; i++) {
      if (addDaysYMD(page.weeks[i].startYMD, 7) !== page.weeks[i - 1].startYMD) {
        out.push({ code: "program-page/weeks", what: `${where}: weeks ${page.weeks[i].startYMD} and ${page.weeks[i - 1].startYMD} aren't a week apart` });
        break;
      }
    }
    for (const w of page.weeks) {
      const inWeek = mine.filter(s => s.date >= w.startYMD && s.date <= addDaysYMD(w.startYMD, 6));
      if (ids(w.sessions) !== ids(inWeek)) {
        if (!out.some(x => x.code.startsWith("program-page/sessions"))) {
          out.push({ code: "program-page/week-sums", what: `${where}, week of ${w.startYMD}: ${w.sessions.length} sessions shown, ${inWeek.length} logged` });
        }
        continue;
      }
      const vol = inWeek.reduce((n, s) => n + tonnage(s), 0);
      const sets = inWeek.reduce((n, s) => n + s.exercises.reduce((m, e) => m + workingDone(s, e).length, 0), 0);
      const secs = inWeek.reduce((n, s) => n + s.durationSeconds, 0);
      const dates = new Set(inWeek.map(s => s.date)).size;
      if (!near(w.volumeKg, vol, tolFor(inWeek)) || w.sets !== sets || w.durationSeconds !== secs || w.done !== dates) {
        out.push({ code: "program-page/week-sums", what: `${where}, week of ${w.startYMD}: shows ${fmt(w.volumeKg)} kg, ${w.sets} sets, ${w.durationSeconds}s, ${w.done} days; logged ${fmt(vol)} kg, ${sets} sets, ${secs}s, ${dates} days` });
      }
    }
  }
  return out;
}

function startNowYMD(p: SavedProgram): string {
  const [d, mon, y] = p.startDate.split(" ");
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(mon);
  return m < 0 ? "" : toYMD(new Date(Number(y), m, Number(d)));
}

// ─── Home ────────────────────────────────────────────────────────────────────

export function checkHome(l: Lifter, snap: Snapshot): Problem[] {
  const out: Problem[] = [];
  const active = snap.programs.find(p => p.status === "active") ?? null;
  const resolved = resolveWorkoutForDate(active, snap.override, snap.today, snap.programs);
  const weekStart = weekStartFor(snap.today);
  const schedule = buildWeekSchedule({
    program: active, history: snap.history, weekStartYMD: weekStart, effectiveToday: snap.today,
    resolvedTodayName: resolved?.name ?? null, override: snap.override, allPrograms: snap.programs,
  });
  const totals = weekTotals(schedule.sessions);
  const week = l.sessions.filter(s => s.date >= weekStart && s.date <= addDaysYMD(weekStart, 6));
  // The ring counts DAYS trained, as its plan counts days.
  const daysTrained = new Set(week.map(s => s.date)).size;
  if (schedule.completedCount !== daysTrained) out.push({ code: "home/week-count", what: `this week's ring counts ${schedule.completedCount} days trained; ${daysTrained} had a session` });
  const vol = week.reduce((n, s) => n + tonnage(s), 0);
  const mins = Math.round(week.reduce((n, s) => n + s.durationSeconds, 0) / 60);
  if (!near(totals.totalVolumeKg, vol, tolFor(week)) || totals.totalMinutes !== mins) {
    out.push({ code: "home/week-totals", what: `this week reads ${fmt(totals.totalVolumeKg)} kg in ${totals.totalMinutes} min; logged ${fmt(vol)} kg in ${mins} min` });
  }
  if (active && schedule.plannedCount > 0 && schedule.completedCount > schedule.plannedCount) {
    const twice = [...new Set(week.map(s => s.date))].filter(d => week.filter(s => s.date === d).length > 1);
    out.push({ code: "home/ring-over", what: `this week's ring reads ${schedule.completedCount}/${schedule.plannedCount}${twice.length ? ` (two sessions on ${twice.join(", ")} count twice; a day counts once in the plan)` : ""}` });
  }
  // Home's week and the Progress page's "This Week" are one week, when both
  // are on the same day (Progress reads the calendar day, Home the day the
  // Workout tab is on: they differ before 3am).
  if (snap.today === snap.calendarToday) {
    const { buckets } = progressBars(snap, { kind: "all" }, "thisWeek", "volume");
    const progress = buckets.reduce((n, b) => n + b.total, 0);
    if (!near(progress, totals.totalVolumeKg, tolFor(week))) {
      out.push({ code: "home/week-vs-progress", what: `Home's week says ${fmt(totals.totalVolumeKg)} kg, Progress's This Week ${fmt(progress)} kg` });
    }
  }
  // Recent Activity: the last seven days' sessions, newest first (home.tsx
  // recentWorkouts, by completedAt).
  const cutoff = snap.now.getTime() - 7 * DAY_MS;
  const shown = snap.history.filter(w => new Date(w.completedAt).getTime() >= cutoff);
  const should = l.sessions.filter(s => s.finishedAt >= cutoff && s.finishedAt <= snap.now.getTime());
  const lost = should.filter(s => !shown.some(w => w.id === s.id));
  if (lost.length > 0) {
    out.push({ code: "home/recent", what: `Recent Activity leaves out ${lost.map(s => `${s.workoutName} finished ${new Date(s.finishedAt).toString().slice(0, 21)} (saved as ${snap.history.find(w => w.id === s.id)?.completedAt})`).join("; ")}` });
  }
  return out;
}

// ─── The Workout tab's "Previous" ────────────────────────────────────────────

/** A ledger set as the "Previous" hint should read it, in the unit on screen. */
function hintToken(x: { weight: string; reps: string }, unitThen: "kg" | "lb", isKgNow: boolean): string {
  const kg = kgOf(x.weight, unitThen);
  const weight = kg === null ? x.weight : trimNumber(isKgNow ? kg : kg * LB_PER_KG, isKgNow ? 2 : 1);
  // Both sides, either left blank, so a tick knows which box a figure goes in.
  return weight || x.reps ? `${weight}×${x.reps}` : "—";
}

/** Two hint tokens read the same: weights within a rounding step. (A weight
 *  typed in lbs is stored to three decimals of a kilo, then shown to two, so
 *  the last digit can land either way: 83.91 or 83.92 for 185 lbs.) */
function sameToken(a: string, b: string, isKg: boolean): boolean {
  if (a === b) return true;
  const [aw, ar] = a.split("×");
  const [bw, br] = b.split("×");
  if ((ar ?? null) !== (br ?? null)) return false;
  const an = parseFloat(aw);
  const bn = parseFloat(bw);
  return Number.isFinite(an) && Number.isFinite(bn) && near(an, bn, isKg ? 0.011 : 0.051);
}

export function checkHints(b: BeforeLog): Problem[] {
  const out: Problem[] = [];
  const { lifter: l, workout, cards, isKg } = b;
  if (!workout.dayId) return out;
  const program = b.programs.find(p => p.id === workout.programId) ?? null;
  const scope = prevDayScopeFor(workout, program);
  const setsOf = buildPrevSetsLookup(b.history, undefined, scope);
  const noteOf = buildPrevNoteLookup(b.history, undefined, scope);
  // The ledger's sessions of this day, newest first.
  const day = l.sessions
    .filter(s => s.programId === workout.programId && s.dayId === workout.dayId)
    .sort((x, y) => y.finishedAt - x.finishedAt);
  for (const card of cards) {
    const where = `${workout.name} (${workout.dayId}) › ${card.name}${card.swappedFrom ? ` (in for ${card.swappedFrom})` : ""}`;
    // Sets: this place, done as this exercise; else the exercise by name on
    // this day (the first time it appears in a session).
    let want: string[] | undefined;
    const byName = () => {
      for (const s of day) {
        const e = s.exercises.find(x => liftKey(x.name) === liftKey(card.name));
        if (e) return e.sets.map(x => hintToken(x, s.unit, isKg));
      }
      return undefined;
    };
    if (card.programExerciseId && !card.swappedFrom) {
      for (const s of day) {
        const e = s.exercises.find(x => x.place === card.programExerciseId && liftKey(x.name) === liftKey(card.name));
        if (e) { want = e.sets.map(x => hintToken(x, s.unit, isKg)); break; }
      }
      want ??= byName();
    } else {
      want = byName();
    }
    const shown = setsOf({ name: card.name, programExerciseId: card.programExerciseId, swappedFrom: card.swappedFrom })?.map(t => formatPrevHint(t, isKg));
    const same = (want ?? []).length === (shown ?? []).length && (want ?? []).every((t, i) => sameToken(t, shown![i], isKg));
    if (!same) {
      const weightOnly = (want ?? []).some((t, i) => t.endsWith("×") && shown?.[i] !== t);
      out.push({
        code: weightOnly ? "hints/prev-weight-only" : "hints/prev-sets",
        what: `${where}: Previous reads ${shown?.join("  ") ?? "nothing"}; last time was ${want?.join("  ") ?? "nothing"} (${isKg ? "kg" : "lbs"} on screen)`,
      });
    }
    // Notes: the last session this place was done in, as itself or by a swap
    // in for it; an empty note blocks an older one.
    if (card.programExerciseId && !card.swappedFrom) {
      let note: string | undefined;
      for (const s of day) {
        const e = s.exercises.find(x => x.place === card.programExerciseId
          && (liftKey(x.name) === liftKey(card.name) || (x.swappedFrom && liftKey(x.swappedFrom) === liftKey(card.name))));
        if (e) { note = e.note.trim() || undefined; break; }
      }
      const shownNote = noteOf({ name: card.name, programExerciseId: card.programExerciseId });
      if (shownNote !== note) out.push({ code: "hints/prev-note", what: `${where}: the note hint reads "${shownNote ?? ""}"; last time's note was "${note ?? ""}"` });
    }
  }

  // "Last session:" lines: what the last session of this day did, against
  // today's plan; nothing when the day has changed since that session's plan.
  if (b.plan) {
    const shown = lastTimeCues(lastSessionOfDay(b.history, undefined, scope), b.plan);
    const prev = day[0];
    const same = !!prev?.plan && prev.plan.length === b.plan.length
      && prev.plan.every((p, i) => p.id === b.plan![i].id && p.name === b.plan![i].name);
    const where = `${workout.name} (${workout.dayId}), the last-session lines`;
    if (!same) {
      if (Object.keys(shown).length) out.push({ code: "hints/changes-after-edit", what: `${where}: ${Object.keys(shown).length} shown, but the day isn't planned as it was last time` });
    } else {
      const want = ledgerChanges(prev.plan!, prev.exercises);
      const swaps = want.swapped.map(i => `${prev.exercises[i].place}:${prev.exercises[i].name}`).sort();
      const shownSwaps = Object.entries(shown).flatMap(([id, c]) => (c.kind === "swapped" ? [`${id}:${c.to}`] : [])).sort();
      if (swaps.join(",") !== shownSwaps.join(",")) out.push({ code: "hints/changes-swap", what: `${where}: swaps shown ${shownSwaps.join(", ") || "none"}; done ${swaps.join(", ") || "none"}` });
      const shownSkips = Object.entries(shown).flatMap(([id, c]) => (c.kind === "skipped" ? [id] : [])).sort();
      if (want.skipped.slice().sort().join(",") !== shownSkips.join(",")) out.push({ code: "hints/changes-skip", what: `${where}: skips shown ${shownSkips.join(", ") || "none"}; left out ${want.skipped.join(", ") || "none"}` });
      const moved = Object.entries(shown).flatMap(([id, c]) => (c.kind === "moved" ? [{ id, at: c.donePosition }] : []));
      for (const m of moved) {
        if (prev.exercises[m.at - 1]?.place !== m.id) out.push({ code: "hints/changes-move", what: `${where}: "done ${m.at}" on ${m.id}, which was done ${prev.exercises.findIndex(e => e.place === m.id) + 1}` });
      }
      if (!movesAccountFor(want, prev.exercises, new Set(moved.map(m => m.id)))) {
        out.push({ code: "hints/changes-move", what: `${where}: ${moved.length} marked moved; ${want.moves} had to move (${prev.exercises.map(e => e.place ?? "+").join(" ")})` });
      }
    }
  }
  return out;
}

// ─── What a session changed about its plan ───────────────────────────────────

/** Worked out from what the lifter did: the exercises swapped in, added, left
 *  out, and how many had to move to get the order done (all but the longest
 *  run kept in plan order). */
function ledgerChanges(plan: PlannedExercise[], exercises: LedgerExercise[]) {
  const at = new Map(plan.map((p, i) => [p.id, i]));
  const placed = exercises.flatMap((e, i) => (e.place && at.has(e.place) ? [{ i, at: at.get(e.place)! }] : []));
  const run = placed.map(() => 1);
  for (let x = 0; x < placed.length; x++) {
    for (let y = 0; y < x; y++) if (placed[y].at < placed[x].at) run[x] = Math.max(run[x], run[y] + 1);
  }
  return {
    placed,
    moves: placed.length - (placed.length ? Math.max(...run) : 0),
    swapped: exercises.flatMap((e, i) => (e.place && at.has(e.place) && e.swappedFrom ? [i] : [])),
    added: exercises.flatMap((e, i) => (!e.place || !at.has(e.place) ? [i] : [])),
    skipped: plan.filter(p => !exercises.some(e => e.place === p.id)).map(p => p.id),
  };
}

/** The exercises left unmarked (`marked` by place, a swap-in counting as
 *  marked) are in plan order, and no more were marked than had to move. */
function movesAccountFor(want: ReturnType<typeof ledgerChanges>, exercises: LedgerExercise[], marked: Set<string>): boolean {
  const left = want.placed.filter(p => !marked.has(exercises[p.i].place!) && !exercises[p.i].swappedFrom);
  const inOrder = left.every((p, k) => k === 0 || left[k - 1].at < p.at);
  const markedPlain = want.placed.filter(p => marked.has(exercises[p.i].place!) && !exercises[p.i].swappedFrom).length;
  return inOrder && markedPlain <= want.moves;
}

// ─── A save ──────────────────────────────────────────────────────────────────

// ─── Comparing two programs ──────────────────────────────────────────────────

/** A ledger session's heaviest working set of a lift with reps in it, in kg
 *  (0 at bodyweight), and whether it did the lift at all (a working set ticked
 *  with its reps in: what puts a session on the exercise's chart). */
function ledgerLift(s: LedgerSession, key: string): { did: boolean; topKg: number } {
  let did = false;
  let topKg = 0;
  for (const e of s.exercises) {
    if (liftKey(e.name) !== key) continue;
    for (const x of workingDone(s, e)) {
      if (!x.reps || x.reps <= 0) continue;
      did = true;
      if (x.kg && x.kg > topKg) topKg = x.kg;
    }
  }
  return { did, topKg };
}

/** The lifts a run's ledger sessions did, each with those sessions, in order. */
function ledgerLifts(sessions: LedgerSession[]): Map<string, LedgerSession[]> {
  const out = new Map<string, LedgerSession[]>();
  const ordered = [...sessions].sort((a, b) => a.finishedAt - b.finishedAt);
  for (const s of ordered) {
    for (const key of new Set(s.exercises.map(e => liftKey(e.name)))) {
      if (!ledgerLift(s, key).did) continue;
      (out.get(key) ?? out.set(key, []).get(key)!).push(s);
    }
  }
  return out;
}

/** Personal records a run's stored sessions set, by the PR card's rule worked
 *  out here (a strictly heavier top set on a lift logged with weight before),
 *  each against every session finished before it. */
function prsSet(run: CompletedWorkout[], history: CompletedWorkout[]): number {
  const top = (w: CompletedWorkout, key: string) => {
    let t = 0;
    for (const e of w.exercises) {
      if (liftKey(e.name) !== key) continue;
      for (const x of e.sets) {
        const kg = num(x.weight);
        const reps = num(x.reps);
        if (x.type === "working" && x.done && kg && kg > 0 && reps && reps > 0 && kg > t) t = kg;
      }
    }
    return t;
  };
  let n = 0;
  for (const w of run) {
    const before = history.filter(h => h.completedAt < w.completedAt);
    for (const key of new Set(w.exercises.map(e => liftKey(e.name)))) {
      const best = before.reduce((m, h) => Math.max(m, top(h, key)), 0);
      if (best > 0 && top(w, key) > best) n += 1;
    }
  }
  return n;
}

export function checkCompare(l: Lifter, snap: Snapshot): Problem[] {
  const out: Problem[] = [];
  const green = greenRunFor({ kind: "current" }, snap.programs, snap.history);
  if (!green) return out;
  const candidates = compareCandidates(snap.programs, snap.history, green.ref);

  // What can be compared: every run the lifter FINISHED with a session in it,
  // never the one going now (shelved runs aren't offered).
  const inRun = (r: ProgramRun, end: string) => (s: LedgerSession) => s.programId === r.programId && s.date >= r.startYMD && s.date <= end;
  const finished = l.runs.filter(r => r.endYMD && r.finished && l.sessions.some(inRun(r, r.endYMD)));
  const want = finished.map(r => `${programName(snap, r.programId)} from ${r.startYMD}`).sort();
  const got = candidates.map(c => `${programName(snap, c.ref.programId)} from ${c.startYMD}`).sort();
  if (want.join(", ") !== got.join(", ")) {
    out.push({ code: "compare/candidates", what: `offered ${got.join(", ") || "nothing"} to compare with; finished were ${want.join(", ") || "none"}` });
  }

  // With nothing on the go, green is the run that finished last, so two
  // finished programs can be compared (user request, 2026-10-14). The lifter
  // always starts the next program the day one ends, so it's played here by
  // shelving the one going now.
  {
    const idle = snap.programs.map(p => (p.status === "active" ? { ...p, status: "paused" as const } : p));
    const g = greenRunFor({ kind: "current" }, idle, snap.history);
    const last = [...finished].sort((a, b) => (b.endYMD ?? "").localeCompare(a.endYMD ?? ""))[0];
    const gotKey = g ? `${programName(snap, g.ref.programId)} from ${g.startYMD}` : "nothing";
    const wantKey = last ? `${programName(snap, last.programId)} from ${last.startYMD}` : "nothing";
    if (gotKey !== wantKey) {
      out.push({ code: "compare/green", what: `with nothing on the go, green was ${gotKey}; the run that finished last was ${wantKey}` });
    }
  }

  // The latest finished run, and the program's own last finished run when
  // it's been run before: two pairs at most, which covers both kinds.
  const pairs = candidates.slice(0, 1);
  const own = candidates.find(c => c.ref.programId === green.ref.programId);
  if (own && !pairs.includes(own)) pairs.push(own);

  const ledgerOf = (view: ProgramRunView): LedgerSession[] => {
    const run = view.ref.run === "latest" && !view.finished
      ? currentRun(l.runs, view.ref.programId)
      : l.runs.find(r => r.programId === view.ref.programId && r.startYMD === view.startYMD) ?? null;
    if (!run) return [];
    return l.sessions.filter(inRun(run, run.endYMD ?? snap.today));
  };

  for (const blue of pairs) {
    const pair = `${programName(snap, green.ref.programId)} vs ${programName(snap, blue.ref.programId)} from ${blue.startYMD}`;
    for (const view of [green, blue]) {
      const side = view === green ? "green" : "blue";
      const where = `${pair}, ${side}`;
      const mine = ledgerOf(view);
      // Its sessions are the run's, by the ledger.
      if (ids(view.sessions) !== ids(mine)) {
        out.push({ code: "compare/sessions", what: `${where}: ${view.sessions.length} sessions read as the run's; the run logged ${mine.length}` });
        continue;
      }
      const days = runDays(view, snap.today);
      const tons = mine.reduce((n, s) => n + tonnage(s), 0);
      const weeks = weeklyTotals(view, days, "volume");
      const total = weeks.reduce((n, v) => n + v, 0);
      if (!near(total, tons, tolFor(mine))) {
        out.push({ code: "compare/weekly", what: `${where}: the weeks add to ${fmt(total)} kg; the run moved ${fmt(tons)} kg` });
      }
      if (mine.length && weeks.length < Math.ceil(days / 7)) {
        out.push({ code: "compare/weekly", what: `${where}: ${weeks.length} weeks drawn for a run ${days} days long` });
      }
      // At a glance, over the whole run.
      const g = glanceStats(view, days, snap.history, snap.today);
      const trained = new Set(mine.map(s => s.date)).size;
      if (g.workoutsDone !== trained) out.push({ code: "compare/glance", what: `${where}: ${g.workoutsDone} workouts done; trained on ${trained} days` });
      if (g.workoutsPlanned < g.workoutsDone) out.push({ code: "compare/glance", what: `${where}: ${g.workoutsDone} done of only ${g.workoutsPlanned} planned` });
      const perWeek = Math.max(1, days / 7);
      if (!near(g.volumePerWeekKg * perWeek, tons, tolFor(mine))) {
        out.push({ code: "compare/glance", what: `${where}: ${fmt(g.volumePerWeekKg)} kg a week over ${days} days; the run moved ${fmt(tons)} kg` });
      }
      const sets = mine.reduce((n, s) => n + s.exercises.reduce((k, e) => k + e.sets.filter(x => x.type === "working" && x.done).length, 0), 0);
      if (!near(g.setsPerWeek * perWeek, sets, 1e-6)) out.push({ code: "compare/glance", what: `${where}: ${fmt(g.setsPerWeek)} sets a week; the run did ${sets} working sets in ${days} days` });
      const prs = prsSet(view.sessions, snap.history);
      if (g.prs !== prs) out.push({ code: "compare/glance", what: `${where}: ${g.prs} PRs; its sessions set ${prs}` });
    }

    // The exercises both did, and each one's sessions in order.
    const lifts = compareLifts(green, blue);
    const lg = ledgerLifts(ledgerOf(green));
    const lb = ledgerLifts(ledgerOf(blue));
    const keys = (xs: { name: string }[]) => xs.map(x => liftKey(x.name)).sort().join(", ");
    const wantBoth = [...lg.keys()].filter(k => lb.has(k)).sort().join(", ");
    if (keys(lifts.both) !== wantBoth) out.push({ code: "compare/lifts", what: `${pair}: in both ${keys(lifts.both) || "none"}; both did ${wantBoth || "none"}` });
    const wantOnlyG = [...lg.keys()].filter(k => !lb.has(k)).sort().join(", ");
    const wantOnlyB = [...lb.keys()].filter(k => !lg.has(k)).sort().join(", ");
    if (keys(lifts.onlyGreen) !== wantOnlyG) out.push({ code: "compare/lifts", what: `${pair}: only in green ${keys(lifts.onlyGreen) || "none"}; ${wantOnlyG || "none"} were` });
    if (keys(lifts.onlyBlue) !== wantOnlyB) out.push({ code: "compare/lifts", what: `${pair}: only in blue ${keys(lifts.onlyBlue) || "none"}; ${wantOnlyB || "none"} were` });
    for (const lift of lifts.both) {
      const key = liftKey(lift.name);
      const gs = lg.get(key) ?? [];
      const bs = lb.get(key) ?? [];
      const where = `${pair}, ${lift.name}`;
      if (lift.green.length !== gs.length || lift.blue.length !== bs.length) {
        out.push({ code: "compare/lift-sessions", what: `${where}: ${lift.green.length} and ${lift.blue.length} sessions charted; done ${gs.length} and ${bs.length}` });
        continue;
      }
      if (kindOf(lift.name) !== "weighted") continue;
      const tops = (pts: ExerciseDataPoint[], led: LedgerSession[]) => pts.findIndex((p, i) => !near(p.topWeight, ledgerLift(led[i], key).topKg, 0.01));
      const gBad = tops(lift.green, gs);
      const bBad = tops(lift.blue, bs);
      if (gBad >= 0 || bBad >= 0) {
        out.push({ code: "compare/lift-tops", what: `${where}: session ${(gBad >= 0 ? gBad : bBad) + 1} of ${gBad >= 0 ? "green" : "blue"} charts a top set that wasn't lifted` });
        continue;
      }
      // Each one's row: its sessions and the days it missed the lift on, never
      // a day the lifter lifted it in that run.
      const gMissed = missedDates(green, lift.name, lift.green, snap.today);
      const bMissed = missedDates(blue, lift.name, lift.blue, snap.today);
      const wrong = gMissed.find(d => gs.some(s => s.date === d)) ?? bMissed.find(d => bs.some(s => s.date === d));
      if (wrong) out.push({ code: "compare/missed", what: `${where}: ${wrong} drawn as missed; the lift was lifted that day` });
      // At the same point: the latest place in both rows both did, numbered
      // as the chart numbers it, missed places counted.
      const gRow = liftSlots(lift.green, gMissed);
      const bRow = liftSlots(lift.blue, bMissed);
      const ahead = aheadAtSamePoint(gRow, bRow);
      let k = Math.min(gRow.length, bRow.length) - 1;
      while (k >= 0 && !(gRow[k].point && bRow[k].point)) k--;
      if (k >= 0) {
        const gTop = ledgerLift(gs[lift.green.indexOf(gRow[k].point!)], key).topKg;
        const bTop = ledgerLift(bs[lift.blue.indexOf(bRow[k].point!)], key).topKg;
        if (gTop > 0 && bTop > 0 && (!ahead || ahead.session !== k + 1 || !near(ahead.diff, gTop - bTop, 0.01))) {
          out.push({ code: "compare/ahead", what: `${where}: ${ahead ? `${ahead.session}th session ${fmt(ahead.diff)} kg` : "nothing"} at the same point; the ${k + 1}th places lifted ${fmt(gTop)} and ${fmt(bTop)} kg` });
        }
      }
    }
  }
  return out;
}

export function checkSave(a: AfterSave): Problem[] {
  const out: Problem[] = [];
  const { saved, ledger, prior, lifter } = a;
  const isKg = ledger.unit === "kg";
  // Saved finishing when it finished, to the minute the wheels hold: a session
  // finished after midnight and counted as the day before was saved a day
  // early, stamped at its end time on the training day.
  if (ledger.timed && Math.abs(Date.parse(saved.completedAt) - ledger.finishedAt) >= 60_000) {
    out.push({ code: "save/finish", what: `${ledger.workoutName} for ${ledger.date} finished ${new Date(ledger.finishedAt).toString().slice(0, 21)}, saved as finishing ${new Date(saved.completedAt).toString().slice(0, 21)}` });
  }
  // Every weight reads back as typed.
  ledger.exercises.forEach((e, i) => e.sets.forEach((x, j) => {
    const typed = num(x.weight);
    if (typed === null) return;
    const back = formatWeightForDisplay(saved.exercises[i].sets[j].weight, isKg);
    if (back !== trimNumber(typed, isKg ? 2 : 1)) out.push({ code: "save/stored-weight", what: `${e.name}: typed ${x.weight} ${ledger.unit}, reads back ${back}` });
  }));

  // The PR card: every lift whose top set beat its best from before, and no
  // other (strictly heavier, and only on a lift logged with weight before).
  const topOf = (sessions: { exercises: { name: string; sets: { type: string; weight: string; reps: string; done: boolean }[] }[] }[], n: string) => {
    let top = 0;
    for (const s of sessions) for (const e of s.exercises) {
      if (liftKey(e.name) !== n) continue;
      for (const x of e.sets) {
        const kg = num(x.weight);
        const reps = num(x.reps);
        if (x.type === "working" && x.done && kg && kg > 0 && reps && reps > 0 && kg > top) top = kg;
      }
    }
    return top;
  };
  const names = [...new Set(saved.exercises.map(e => liftKey(e.name)))];
  const want = names.filter(n => {
    const before = topOf(prior, n);
    return before > 0 && topOf([saved], n) > before;
  });
  const earned = detectWorkoutAchievements(saved, prior, EMPTY_ACHIEVEMENTS, new Date());
  const pr = earned.find(x => x.category === "pr");
  const got = pr && "prs" in pr ? pr.prs.map(r => liftKey(r.exerciseName)) : [];
  if (got.sort().join(", ") !== want.sort().join(", ")) {
    out.push({ code: "save/pr", what: `${ledger.workoutName} ${ledger.date}: the PR card lists ${got.join(", ") || "nothing"}; beaten were ${want.join(", ") || "none"}` });
  }

  // The Journal's cues for it (workout-detail's lines and skipped rows, the
  // card's summary), read from the saved session against what was done.
  if (ledger.plan) {
    const where = `${ledger.workoutName} ${ledger.date}, the Journal's lines`;
    const changes = sessionChanges(saved);
    const done = ledgerChanges(ledger.plan, ledger.exercises);
    if (!changes) {
      out.push({ code: "journal/changes", what: `${where}: none drawn for a session with a plan` });
    } else {
      const kinds = changes.cues.map(c => c?.kind ?? "-");
      const swapped = kinds.flatMap((k, i) => (k === "swapped" ? [i] : []));
      const added = kinds.flatMap((k, i) => (k === "added" ? [i] : []));
      if (swapped.join(",") !== done.swapped.join(",")) out.push({ code: "journal/changes", what: `${where}: "Instead of" on ${swapped.join(", ") || "none"}; swapped were ${done.swapped.join(", ") || "none"}` });
      if (added.join(",") !== done.added.join(",")) out.push({ code: "journal/changes", what: `${where}: "Added" on ${added.join(", ") || "none"}; added were ${done.added.join(", ") || "none"}` });
      const skipped = changes.skipped.map(s => s.id);
      if (skipped.join(",") !== done.skipped.join(",")) out.push({ code: "journal/changes", what: `${where}: Skipped rows for ${skipped.join(", ") || "none"}; left out ${done.skipped.join(", ") || "none"}` });
      // "Planned Nth" names its place in the plan, and what's left unmarked is
      // in plan order with no more marked than had to move.
      const marked = new Set<string>();
      changes.cues.forEach((c, i) => {
        if (c?.kind !== "moved") return;
        const place = ledger.exercises[i].place;
        if (place) marked.add(place);
        const at = ledger.plan!.findIndex(p => p.id === place) + 1;
        if (c.plannedPosition !== at) out.push({ code: "journal/changes", what: `${where}: "Planned ${c.plannedPosition}" on ${ledger.exercises[i].name}, planned ${at}` });
      });
      if (!movesAccountFor(done, ledger.exercises, marked)) {
        out.push({ code: "journal/changes", what: `${where}: ${marked.size} marked moved; ${done.moves} had to move (${ledger.exercises.map(e => e.place ?? "+").join(" ")})` });
      }
      if ((changes.counts.moved > 0) !== (done.moves > 0)) out.push({ code: "journal/changes", what: `${where}: the card ${changes.counts.moved > 0 ? "says" : "doesn't say"} the order changed; ${done.moves} moved` });
    }
  }
  void lifter;
  return out;
}
