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
//   chart-layout/  the exercise chart on every phone width: every dot inside
//                  the plot, the line never cut short, dates that don't collide
//   program-page/  the program page the Journal opens: weeks and totals
//   home/          this week's ring and totals, Recent Activity
//   hints/         the Workout tab's "Previous" sets and notes
//   save/          a saved session: weights read back as typed, PR cards

import {
  bucketMetricByDay, bucketMetricByMonth, bucketMetricByRollingWeeks, collectExerciseHistory,
  collectLoggedExercisesForDay, computePRs, computeWorkoutDurationMinutes, computeWorkoutReps,
  computeWorkoutTonnage, filterByProgramScope, getRangeOption, rangeWindow, scopedProgramDays,
  sessionCountForDay, yearBarCount,
} from "../../../utils/progressStats";
import { programFinishDate, type CompletedWorkout, type ProgramDayRef, type SavedProgram } from "../../../constants/programs";
import type { ExerciseDataPoint, MetricKey, ProgramScope, RangeKey } from "../../../constants/progress";
import { EXERCISE_METRIC_OPTIONS } from "../../../constants/progress";
import { exerciseHistoryRows } from "../../../utils/exerciseHistory";
import {
  CHART_HEIGHT, GIFTED_TOP_PAD, Y_AXIS_LABEL_WIDTH,
  chartChange, dotX, dotY, exerciseChartAxis, exerciseChartKey, exerciseChartLabels, exerciseChartLayout, metricValue, plottedPoints,
} from "../../../utils/exerciseChartLayout";
import { buildProgramHistory } from "../../../utils/programHistory";
import { buildWeekSchedule, weekStartFor, weekTotals } from "../../../utils/weekSchedule";
import { addDaysYMD, toYMD } from "../../../utils/dates";
import {
  buildPrevNoteLookup, buildPrevSetsLookup, getEffectiveToday, prevDayScopeFor, resolveWorkoutForDate, type DayOverride,
} from "../../../utils/workout";
import { formatPrevHint, formatWeightForDisplay, trimNumber } from "../../../utils/units";
import { detectWorkoutAchievements } from "../../../utils/achievements";
import { EMPTY_ACHIEVEMENTS } from "../../../constants/achievements";
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
        for (const n of new Set(s.exercises.map(e => norm(e.name)))) {
          const e = s.exercises.find(x => norm(x.name) === n)!;
          names.set(n, { name: e.name, sessions: (names.get(n)?.sessions ?? 0) + 1 });
        }
      }
      // (Only the names show: a row's sessionCount and last set aren't drawn.)
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
  const kind = LIFTS[name]?.kind ?? "weighted";
  // Sessions that did it: a working set done with reps. (A timed hold's chart
  // isn't held to this: its "reps" are seconds, see hold-seconds-as-reps.)
  const did = logged
    .filter(s => s.exercises.some(e => norm(e.name) === norm(name) && workingDone(s, e).some(x => x.reps && x.reps > 0)))
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const plotted = points.map(p => p.workoutId);
  if (kind !== "hold") {
    const missing = did.filter(s => !plotted.includes(s.id));
    if (missing.length > 0) {
      const bodyweight = missing.every(s => s.exercises.filter(e => norm(e.name) === norm(name))
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
    const sets = s.exercises.filter(e => norm(e.name) === norm(name)).flatMap(e => workingDone(s, e))
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

  // Each metric's dots: Reps every session it was done in, the weight metrics
  // the sessions with weight on the bar.
  const weighted = did.filter(s => s.exercises.some(e => norm(e.name) === norm(name)
    && workingDone(s, e).some(x => x.kg && x.kg > 0 && x.reps && x.reps > 0)));
  for (const metric of ["topWeight", "totalReps"] as const) {
    const want = (metric === "totalReps" ? did : weighted).map(s => s.id).join(",");
    const got = plottedPoints(points, metric).map(p => p.workoutId).filter(id => did.some(s => s.id === id)).join(",");
    if (kind !== "hold" && want !== got) {
      out.push({ code: "progress/chart-metric", what: `${at}: ${metric === "totalReps" ? "Reps" : "Heaviest"} plots ${got.split(",").filter(Boolean).length} sessions; ${(metric === "totalReps" ? did : weighted).length} should show there` });
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

  // What the two tiles and the header say, from what was lifted (a timed
  // hold moves no volume and has no 1RM): Best Set is a set that was done,
  // the heaviest by weight × reps ("90 kg × 8"); Most Volume, the sets and
  // reps of the session that moved the most ("4 sets · 38 reps"); and the
  // header's % change, each line's last session against its first.
  if (kind !== "hold") {
    const rows = did.map(s => ({
      s,
      sets: s.exercises.filter(e => norm(e.name) === norm(name)).flatMap(e => workingDone(s, e))
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
        ["topWeight", rows.map(r => Math.max(...r.sets.map(x => x.kg)))],
        ["e1rm", rows.map(r => Math.max(...r.sets.map(x => x.kg * (1 + x.reps / 30))))],
        ["sessionVolume", sessions.map(v => v.vol)],
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
  const shouldList = logged.filter(s => s.date >= cutoff && s.exercises.some(e => norm(e.name) === norm(name) && e.sets.some(x => x.done)));
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
const DOT_R = 3;

/** What the chart keeps between draws. The Progress tab stays mounted, and so
 *  does its chart, through every pick and every session logged (gifted-charts'
 *  line width is opened once per mount: exerciseChartKey); and the page
 *  remembers the exercise picked, so a visit opens on the one the last visit
 *  ended on, with whatever's been logged since. */
export type ChartMemory = { selected: string | null; mounted: Map<number, { key: string; lineWidth: number }> };

export const newChartMemory = (): ChartMemory => ({ selected: null, mounted: new Map() });

export function checkChartLayout(drawn: DrawnChart[], memory: ChartMemory): Problem[] {
  const out: Problem[] = [];
  // This visit: the remembered pick first, then every other chart in turn,
  // and the page left on the last one.
  const idOf = (c: DrawnChart) => `${c.scopeLabel}|${c.day.key}|${norm(c.name)}`;
  const charts = [...drawn.filter(c => idOf(c) === memory.selected), ...drawn.filter(c => idOf(c) !== memory.selected)];
  if (charts.length > 0) memory.selected = idOf(charts[charts.length - 1]);
  for (const c of charts) for (const metric of EXERCISE_METRIC_OPTIONS.map(o => o.key)) {
    // The metric's own dots, as the chart plots them (plottedPoints).
    const points = plottedPoints(c.points, metric);
    const n = points.length;
    if (n === 0) continue;
    const at = `${c.day.programName} ${c.day.label} › ${c.name} (${n} sessions, ${metric})`;
    const dates = points.map(p => p.date);

    // Every dot inside the plot vertically, and an axis that reads cleanly.
    const values = points.map(p => metricValue(p, metric));
    const axis = exerciseChartAxis(values);
    for (const v of values) {
      const y = dotY(v, axis);
      if (y < GIFTED_TOP_PAD - 0.01 || y > GIFTED_TOP_PAD + CHART_HEIGHT + 0.01) {
        out.push({ code: "chart-layout/dot-outside", what: `${at}: a dot at ${fmt(v)} sits outside the ${fmt(axis.min)}–${fmt(axis.max)} axis` });
        break;
      }
    }
    if (new Set(axis.labels).size !== axis.labels.length) {
      out.push({ code: "chart-layout/axis-repeat", what: `${at}: the y-axis reads ${axis.labels.join(", ")}` });
    }
    if (axis.min < 0) out.push({ code: "chart-layout/axis-below-zero", what: `${at}: the y-axis starts at ${fmt(axis.min)}` });
    // Zoomed to the dots: a change worth seeing fills the plot, and a wobble
    // stays a wobble. From zero with the first session on the middle line, a
    // 10% gain moved a dot 5% of the plot, and Heaviest and Best Set drew the
    // same dots.
    const hi = Math.max(...values);
    const lo = Math.min(...values);
    const share = (dotY(lo, axis) - dotY(hi, axis)) / CHART_HEIGHT;
    if (hi - lo >= 0.2 * hi && share < 0.3) {
      out.push({ code: "chart-layout/axis-squash", what: `${at}: sessions from ${fmt(lo)} to ${fmt(hi)} fill ${Math.round(share * 100)}% of the plot (axis ${axis.labels.join(" ")})` });
    }
    if (hi - lo <= 0.05 * hi && share > 0.25) {
      out.push({ code: "chart-layout/axis-stretch", what: `${at}: a ${fmt(hi - lo)} wobble on ${fmt(hi)} spans ${Math.round(share * 100)}% of the plot (axis ${axis.labels.join(" ")})` });
    }

    for (const width of WIDTHS) {
      const layout = exerciseChartLayout(n, width);
      const labels = exerciseChartLabels(dates, layout.spacing);
      // The line's box, as gifted-charts-core sizes it at mount.
      const lineWidth = layout.initialSpacing + n * layout.spacing + layout.endSpacing;
      const key = exerciseChartKey(c.name, c.day.dayId, n, layout);
      const mounted = memory.mounted.get(width);
      const open = mounted && mounted.key === key ? mounted.lineWidth : lineWidth;
      memory.mounted.set(width, { key, lineWidth: open });
      const lastX = layout.initialSpacing + (n - 1) * layout.spacing;
      if (open < lastX + DOT_R) {
        out.push({ code: "chart-layout/line-cut", what: `${at} on a ${width}pt phone: the line stops at ${fmt(open)}, the last dot is at ${fmt(lastX)}` });
      }
      for (let i = 0; i < n; i++) {
        const x = dotX(layout, i);
        if (x < Y_AXIS_LABEL_WIDTH || x > Y_AXIS_LABEL_WIDTH + layout.chartWidth) {
          out.push({ code: "chart-layout/dot-outside", what: `${at} on ${width}pt: dot ${i + 1} at x ${fmt(x)}, the plot is ${Y_AXIS_LABEL_WIDTH}..${Y_AXIS_LABEL_WIDTH + layout.chartWidth}` });
          break;
        }
      }
      // The dates under the dots.
      let prev: { x: number; w: number; text: string } | null = null;
      for (let i = 0; i < n; i++) {
        if (!labels[i]) continue;
        const x = dotX(layout, i);
        const w = labelWidth(labels[i]);
        if (x - w / 2 < 0 || x + w / 2 > layout.wrapperWidth) {
          out.push({ code: "chart-layout/label-overlap", what: `${at} on ${width}pt: the date "${labels[i]}" runs off the card` });
        }
        if (prev && x - prev.x < (w + prev.w) / 2 + 2) {
          out.push({ code: "chart-layout/label-overlap", what: `${at} on ${width}pt: "${prev.text}" and "${labels[i]}" overlap` });
        }
        if (prev && prev.text === labels[i] && width === WIDTHS[0]) {
          out.push({ code: "chart-layout/label-repeat", what: `${at}: two dates in a row read "${labels[i]}" (labels ${labels.filter(Boolean).join(" ")})` });
        }
        prev = { x, w, text: labels[i] };
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
        const e = s.exercises.find(x => norm(x.name) === norm(card.name));
        if (e) return e.sets.map(x => hintToken(x, s.unit, isKg));
      }
      return undefined;
    };
    if (card.programExerciseId && !card.swappedFrom) {
      for (const s of day) {
        const e = s.exercises.find(x => x.place === card.programExerciseId && norm(x.name) === norm(card.name));
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
          && (norm(x.name) === norm(card.name) || (x.swappedFrom && norm(x.swappedFrom) === norm(card.name))));
        if (e) { note = e.note.trim() || undefined; break; }
      }
      const shownNote = noteOf({ name: card.name, programExerciseId: card.programExerciseId });
      if (shownNote !== note) out.push({ code: "hints/prev-note", what: `${where}: the note hint reads "${shownNote ?? ""}"; last time's note was "${note ?? ""}"` });
    }
  }
  return out;
}

// ─── A save ──────────────────────────────────────────────────────────────────

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
      if (norm(e.name) !== n) continue;
      for (const x of e.sets) {
        const kg = num(x.weight);
        const reps = num(x.reps);
        if (x.type === "working" && x.done && kg && kg > 0 && reps && reps > 0 && kg > top) top = kg;
      }
    }
    return top;
  };
  const names = [...new Set(saved.exercises.map(e => norm(e.name)))];
  const want = names.filter(n => {
    const before = topOf(prior, n);
    return before > 0 && topOf([saved], n) > before;
  });
  const earned = detectWorkoutAchievements(saved, prior, EMPTY_ACHIEVEMENTS, new Date());
  const pr = earned.find(x => x.category === "pr");
  const got = pr && "prs" in pr ? pr.prs.map(r => norm(r.exerciseName)) : [];
  if (got.sort().join(", ") !== want.sort().join(", ")) {
    out.push({ code: "save/pr", what: `${ledger.workoutName} ${ledger.date}: the PR card lists ${got.join(", ") || "nothing"}; beaten were ${want.join(", ") || "none"}` });
  }
  void lifter;
  return out;
}
