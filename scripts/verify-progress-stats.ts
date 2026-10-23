// Framework-free verification of the pure derivations in utils/progressStats.ts —
// the module that powers every NUMBER and GRAPH on the Progress page (tonnage,
// reps, duration, the muscle-group radar, the day/week/month bar charts, the
// per-exercise line chart, and PRs). Unlike utils/workout.ts it previously had
// no coverage, so this is the safety net for "after logging a bunch of workouts
// the numbers go wrong".
//
// Run:  npx tsx scripts/verify-progress-stats.ts
// Exits non-zero (throws) if any assertion fails.
//
// We pin the timezone to a DST-observing zone so the daylight-saving bucketing
// assertions are deterministic regardless of the machine's local TZ. This MUST
// be set before any Date is constructed.
process.env.TZ = "America/New_York";

import {
  computeWorkoutTonnage,
  computeWorkoutReps,
  computeWorkoutDurationMinutes,
  computeMuscleGroupStats,
  getRangeOption,
  rangeWindow,
  previousComparableWindow,
  filterByDateWindow,
  bucketMetricByDay,
  bucketVolumeByDay,
  bucketVolumeByMonth,
  yearBarCount,
  bucketMetricByRollingWeeks,
  bucketMetricByMonth,
  collectExerciseHistory,
  computePRs,
  programIncludes,
  workoutBelongsToProgram,
  filterByProgramScope,
  programsInScope,
  scopedProgramDays,
  groupDaysByProgram,
  workoutMatchesDay,
  collectLoggedExercisesForDay,
  sessionCountForDay,
} from "../utils/progressStats";
import { displayWorkoutName, historicalDays, markDayRefLabels, programDays, programDaysWithExtras } from "../utils/programDays";
import {
  BAR_WIDTH, BLOCK_GAP, CHART_HEIGHT, LABEL_H, LABEL_INK_DOWN, LABEL_INK_UP, LINE_STROKE, PLOT_TOP, SESSION_SPACING,
  axisLoadStep, barAxis, barGlintD, barsPathD, blockGlintD, blocksPathD, changeFromPrevious, chartChange, dotY, drawsOn,
  exerciseChartAxis, exerciseChartGeometry, fmtChange, isExerciseMetric, linePathD, loadStep, percentChange, setStacks,
  setsTotal, slotX, sparkleD, strengthDots, strengthLabel, strengthLabelInkWidth, visibleSlots, volumeBars, windowAxis,
  type StrengthDot,
} from "../utils/exerciseChartLayout";
import {
  exerciseHistoryOptions,
  exerciseHistoryRows,
  filterLabel,
  isPicked,
  pickLabel,
  togglePick,
  type HistoryFilterItem,
  type HistoryPick,
} from "../utils/exerciseHistory";
import type { ExerciseDataPoint } from "../constants/progress";
import type { CompletedWorkout, CompletedSet, ProgramDayRef, SavedProgram } from "../constants/programs";
import type { CustomExercise } from "../constants/exercises";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${msg}\n      expected ${e}\n      got      ${a}`);
}
function approx(actual: number, expected: number, msg: string, eps = 1e-9): void {
  check(Math.abs(actual - expected) < eps, `${msg}\n      expected ≈${expected}\n      got      ${actual}`);
}

// ── builders ────────────────────────────────────────────────────────────────
function set(weight: string, reps: string, opts: Partial<CompletedSet> = {}): CompletedSet {
  return { type: "working", weight, reps, done: true, ...opts };
}
function workout(partial: Partial<CompletedWorkout> & { exercises: CompletedWorkout["exercises"] }): CompletedWorkout {
  return {
    id: partial.id ?? "w",
    date: partial.date ?? "2026-05-01",
    completedAt: partial.completedAt ?? `${partial.date ?? "2026-05-01"}T10:00:00.000Z`,
    workoutName: partial.workoutName ?? "Push",
    durationSeconds: partial.durationSeconds ?? 0,
    exercises: partial.exercises,
    ...(partial.programId !== undefined ? { programId: partial.programId } : {}),
    ...(partial.dayId !== undefined ? { dayId: partial.dayId } : {}),
  };
}
function ex(name: string, sets: CompletedSet[], notes = "") {
  return { name, notes, sets };
}

// ── computeWorkoutTonnage ─────────────────────────────────────────────────────
// Only working+done sets with weight>0 AND reps>0 contribute.
eq(
  computeWorkoutTonnage(workout({
    exercises: [ex("Bench", [
      set("100", "5"),                                  // 500
      set("100", "5", { type: "warmup" }),              // skipped (warmup)
      set("100", "5", { done: false }),                 // skipped (not done)
      set("BW", "10"),                                  // skipped (weight NaN → 0)
      set("0", "10"),                                   // skipped (weight 0)
      set("80", "0"),                                   // skipped (reps 0)
      set("60.5", "2"),                                 // 121
    ])],
  })),
  621,
  "tonnage: only working+done with weight>0 & reps>0; decimals ok",
);
eq(computeWorkoutTonnage(workout({ exercises: [] })), 0, "tonnage: no exercises -> 0");

// ── computeWorkoutReps ────────────────────────────────────────────────────────
eq(
  computeWorkoutReps(workout({
    exercises: [ex("Bench", [
      set("100", "5"),
      set("BW", "12"),                                  // counts reps even with no weight
      set("100", "8", { done: false }),                 // skipped (not done)
      set("100", "8", { type: "warmup" }),              // skipped (warmup)
    ])],
  })),
  17,
  "reps: sum reps over working+done (BW counts, warmup/undone skipped)",
);

// ── computeWorkoutDurationMinutes ─────────────────────────────────────────────
eq(computeWorkoutDurationMinutes(workout({ exercises: [], durationSeconds: 3600 })), 60, "duration: 3600s -> 60m");
eq(computeWorkoutDurationMinutes(workout({ exercises: [], durationSeconds: 0 })), 0, "duration: 0s -> 0");
eq(computeWorkoutDurationMinutes(workout({ exercises: [], durationSeconds: -5 })), 0, "duration: negative -> 0");
eq(computeWorkoutDurationMinutes(workout({ exercises: [], durationSeconds: NaN })), 0, "duration: NaN -> 0");

// ── computeMuscleGroupStats ───────────────────────────────────────────────────
// "Barbell Bench Press" is a bundled exercise → Chest (single primary). A
// 2-muscle custom splits its volume/sets/frequency evenly. (Exercise names must
// match the catalogue exactly; an unknown name resolves to [] = uncategorized.)
const customExercises: CustomExercise[] = [
  { name: "ChestArm Combo", muscles: ["Chest", "Arms"], imageUri: "", videoUri: undefined, description: "" },
];
{
  const stats = computeMuscleGroupStats(
    [workout({
      exercises: [
        ex("Barbell Bench Press", [set("100", "5")]),   // Chest: vol 500, 1 set, freq credit 1
        ex("ChestArm Combo", [set("50", "10"), set("BW", "10")]), // vol 500, 2 sets → split 0.5 Chest / 0.5 Arms
        ex("Totally Unknown Lift", [set("40", "5")]),   // uncategorized → skipped
      ],
    })],
    customExercises,
  );
  // Chest: bundled 500 + half of combo 250 = 750; sets 1 + 1 = 2; sessions max(1,0.5)=1
  approx(stats.Chest.volume, 750, "muscle: Chest volume = bundled + half-combo");
  approx(stats.Chest.sets, 2, "muscle: Chest sets = 1 + 0.5*2");
  approx(stats.Chest.sessions, 1, "muscle: Chest frequency credit = max(1, 0.5)");
  // Arms: only half the combo. vol 250, sets 1, sessions 0.5
  approx(stats.Arms.volume, 250, "muscle: Arms volume = half-combo");
  approx(stats.Arms.sets, 1, "muscle: Arms sets = 0.5*2");
  approx(stats.Arms.sessions, 0.5, "muscle: Arms frequency credit = 0.5 (2-muscle custom)");
  // Legs untouched
  approx(stats.Legs.volume, 0, "muscle: untrained group stays 0");
}
{
  // An exercise with only BW sets contributes sets but zero volume (still "trained").
  const stats = computeMuscleGroupStats(
    [workout({ exercises: [ex("Barbell Bench Press", [set("BW", "10"), set("BW", "10")])] })],
    [],
  );
  approx(stats.Chest.volume, 0, "muscle: BW-only exercise -> 0 volume");
  approx(stats.Chest.sets, 2, "muscle: BW-only exercise -> sets still counted");
  approx(stats.Chest.sessions, 1, "muscle: BW-only exercise -> session credited");
}

// ── getRangeOption ────────────────────────────────────────────────────────────
eq(getRangeOption("lastWeek").key, "lastWeek", "getRangeOption: exact match");
eq(getRangeOption("nonsense" as any).key, "thisWeek", "getRangeOption: unknown -> first option");

// ── rangeWindow (today = Fri 15 May 2026) ─────────────────────────────────────
const today = new Date(2026, 4, 15); // local midnight Friday
eq(rangeWindow("thisWeek", today),    { startYMD: "2026-05-11", endYMD: "2026-05-15", chartEndYMD: "2026-05-17" }, "rangeWindow thisWeek: Mon..today");
eq(rangeWindow("lastWeek", today),    { startYMD: "2026-05-04", endYMD: "2026-05-10", chartEndYMD: "2026-05-10" }, "rangeWindow lastWeek: prev Mon..Sun");
eq(rangeWindow("thisMonth", today),   { startYMD: "2026-04-20", endYMD: "2026-05-15", chartEndYMD: "2026-05-15" }, "rangeWindow thisMonth: 3 weeks back..today");
eq(rangeWindow("last3Months", today), { startYMD: "2026-03-01", endYMD: "2026-05-15", chartEndYMD: "2026-05-15" }, "rangeWindow 3M: 1st of month-2..today");
eq(rangeWindow("year", today, "2024-01-01"), { startYMD: "2025-06-01", endYMD: "2026-05-15", chartEndYMD: "2026-05-15" }, "rangeWindow year: 1st of month-11..today");
// Sunday is treated as the END of the week (mondayOf maps Sun -> previous Mon).
eq(rangeWindow("thisWeek", new Date(2026, 4, 17)), { startYMD: "2026-05-11", endYMD: "2026-05-17", chartEndYMD: "2026-05-17" }, "rangeWindow thisWeek: Sunday -> full Mon..Sun");

// The chart end runs to Sunday on EVERY day of the week, so the volume graph
// always has seven labelled bars; only the aggregation end moves.
for (let dom = 11; dom <= 17; dom++) {
  const d = new Date(2026, 4, dom);
  const w = rangeWindow("thisWeek", d);
  eq(w.startYMD, "2026-05-11", `rangeWindow thisWeek (May ${dom}): starts Monday`);
  eq(w.chartEndYMD, "2026-05-17", `rangeWindow thisWeek (May ${dom}): chart ends Sunday`);
  check(w.endYMD <= w.chartEndYMD, `rangeWindow thisWeek (May ${dom}): stats end never past the chart end`);
}
// Every other range charts exactly what it aggregates.
for (const r of ["lastWeek", "thisMonth", "last3Months", "year"] as const) {
  const w = rangeWindow(r, today);
  eq(w.chartEndYMD, w.endYMD, `rangeWindow ${r}: chart end === stats end`);
}

// ── "Last Year" grows with the history ────────────────────────────────────────
// Twelve is the cap, not the shape: a new account must not open this view to
// eleven empty bars. Three months minimum, then one bar per month spanned.
{
  eq(yearBarCount(today, null), 3, "yearBars: no history at all -> the 3-month floor");
  eq(yearBarCount(today, undefined), 3, "yearBars: caller passed nothing -> floor, not cap");
  eq(yearBarCount(today, "2026-05-01"), 3, "yearBars: history inside this month -> floor");
  eq(yearBarCount(today, "2026-03-31"), 3, "yearBars: exactly 3 months spanned -> 3");
  eq(yearBarCount(today, "2026-02-14"), 4, "yearBars: 4 months spanned -> 4");
  eq(yearBarCount(today, "2025-12-31"), 6, "yearBars: spans a year boundary -> 6");
  eq(yearBarCount(today, "2025-06-01"), 12, "yearBars: exactly a year -> 12");
  eq(yearBarCount(today, "2019-01-01"), 12, "yearBars: years of history -> capped at 12");
  // The day of the month never matters, only the month it lands in.
  eq(yearBarCount(today, "2026-02-01"), yearBarCount(today, "2026-02-28"),
     "yearBars: counts months spanned, not days");

  // A gap in the middle still counts: months spanned, not months with data.
  // Counting only months that HAVE sessions would drop the older one entirely.
  eq(yearBarCount(today, "2025-11-20"), 7, "yearBars: a quiet stretch still spans its months");

  // The window follows the bar count, and the buckets follow the window.
  const w3 = rangeWindow("year", today, "2026-04-02");
  eq(w3.startYMD, "2026-03-01", "year window: floor starts 2 months back");
  eq(bucketVolumeByMonth([], w3.startYMD, w3.endYMD).map(b => b.label).join(","),
     "Mar,Apr,May", "year chart: 3 labelled month bars on a young account");

  const w5 = rangeWindow("year", today, "2026-01-09");
  eq(w5.startYMD, "2026-01-01", "year window: 5 months of history starts that month");
  eq(bucketVolumeByMonth([], w5.startYMD, w5.endYMD).length, 5, "year chart: 5 bars at 5 months");

  const wFull = rangeWindow("year", today, "2020-01-01");
  eq(bucketVolumeByMonth([], wFull.startYMD, wFull.endYMD).length, 12, "year chart: 12 bars once capped");

  // Every history length between the floor and the cap produces exactly the
  // bars its window spans — no off-by-one at either end.
  for (let back = 0; back <= 18; back++) {
    const first = new Date(2026, 4 - back, 15);
    const ymd = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-15`;
    const w = rangeWindow("year", today, ymd);
    const expected = Math.min(12, Math.max(3, back + 1));
    eq(bucketVolumeByMonth([], w.startYMD, w.endYMD).length, expected,
       `year chart: ${back} months back -> ${expected} bars`);
  }
}
// Seven labelled day buckets mid-week, with the days still to come at zero.
{
  const w = rangeWindow("thisWeek", today);
  const bars = bucketVolumeByDay([], w.startYMD, w.chartEndYMD);
  eq(bars.length, 7, "thisWeek chart: seven day buckets mid-week");
  eq(bars.map(b => b.label).join(","), "Mon,Tue,Wed,Thu,Fri,Sat,Sun", "thisWeek chart: Mon..Sun labels");
  check(bars.every(b => b.label !== ""), "thisWeek chart: no unlabelled padding slots");
}

// ── previousComparableWindow ──────────────────────────────────────────────────
// Same length, shifted back a whole number of weeks (weekday-aligned), never
// overlapping the current window. Feeds the Strength radar's trend arrows.
{
  // Partial thisWeek (Mon..Fri, 5 days) -> last Mon..Fri, NOT last Wed..Sun.
  eq(previousComparableWindow("2026-05-11", "2026-05-15"),
     { startYMD: "2026-05-04", endYMD: "2026-05-08" },
     "prevWindow: partial week shifts 7 days (weekday-aligned)");
  // Full lastWeek -> the week before it.
  eq(previousComparableWindow("2026-05-04", "2026-05-10"),
     { startYMD: "2026-04-27", endYMD: "2026-05-03" },
     "prevWindow: full week -> prior full week");
  // thisMonth (26 days) -> shift 28 (next multiple of 7), still Monday-aligned.
  eq(previousComparableWindow("2026-04-20", "2026-05-15"),
     { startYMD: "2026-03-23", endYMD: "2026-04-17" },
     "prevWindow: rolling month shifts 4 whole weeks");
  // last3Months (76 days) -> shift 77; equal length, no overlap.
  eq(previousComparableWindow("2026-03-01", "2026-05-15"),
     { startYMD: "2025-12-14", endYMD: "2026-02-27" },
     "prevWindow: 3M shifts 11 whole weeks across year boundary");
  {
    const cur = rangeWindow("year", today);
    const prev = previousComparableWindow(cur.startYMD, cur.endYMD);
    check(prev.endYMD < cur.startYMD, "prevWindow: year window never overlaps the current one");
  }
}

// ── filterByDateWindow ────────────────────────────────────────────────────────
{
  const ws = [
    workout({ id: "a", date: "2026-05-03", exercises: [] }),
    workout({ id: "b", date: "2026-05-10", exercises: [] }),
    workout({ id: "c", date: "2026-05-11", exercises: [] }),
  ];
  eq(filterByDateWindow(ws, "2026-05-03", "2026-05-10").map(w => w.id), ["a", "b"], "filterByDateWindow: inclusive bounds");
}

// ── bucketMetricByDay ─────────────────────────────────────────────────────────
{
  const ws = [
    workout({ id: "m", date: "2026-05-11", exercises: [ex("Bench", [set("100", "5")])] }), // Mon, 500
    workout({ id: "m2", date: "2026-05-11", exercises: [ex("Bench", [set("100", "5")])] }), // Mon again, +500
    workout({ id: "w", date: "2026-05-13", exercises: [ex("Bench", [set("100", "10")])] }), // Wed, 1000
  ];
  const buckets = bucketMetricByDay(ws, "2026-05-11", "2026-05-13", computeWorkoutTonnage);
  eq(buckets.map(b => b.label), ["Mon", "Tue", "Wed"], "bucketByDay: one bucket per day, weekday labels");
  eq(buckets.map(b => b.total), [1000, 0, 1000], "bucketByDay: same-day workouts sum; empty day -> 0");
  eq(buckets[0].workoutIds, ["m", "m2"], "bucketByDay: workoutIds collected per day");
}

// ── bucketMetricByRollingWeeks: always 4 buckets, partial current week ─────────
{
  // start = Mon Apr 20, today = Fri May 15 -> weeks: Apr20, Apr27, May4, May11
  const ws = [
    workout({ id: "x", date: "2026-04-22", exercises: [ex("B", [set("100", "5")])] }),  // week0
    workout({ id: "y", date: "2026-05-12", exercises: [ex("B", [set("100", "5")])] }),  // week3
    workout({ id: "z", date: "2026-05-18", exercises: [ex("B", [set("100", "5")])] }),  // beyond today -> dropped
  ];
  const buckets = bucketMetricByRollingWeeks(ws, "2026-04-20", "2026-05-15", computeWorkoutTonnage);
  eq(buckets.length, 4, "rollingWeeks: exactly 4 buckets");
  eq(buckets.map(b => b.label), ["Apr 20", "Apr 27", "May 4", "May 11"], "rollingWeeks: Monday labels");
  eq(buckets.map(b => b.total), [500, 0, 0, 500], "rollingWeeks: workouts land in correct week; out-of-range dropped");
  eq(buckets[3].endYMD, "2026-05-15", "rollingWeeks: current (partial) week endYMD capped at today");
}

// ── bucketMetricByMonth: one bucket per spanned calendar month ─────────────────
{
  const ws = [
    workout({ id: "mar", date: "2026-03-15", exercises: [ex("B", [set("100", "5")])] }),  // Mar 500
    workout({ id: "apr", date: "2026-04-02", exercises: [ex("B", [set("100", "10")])] }), // Apr 1000
    workout({ id: "may", date: "2026-05-14", exercises: [ex("B", [set("100", "1")])] }),  // May 100
  ];
  const buckets = bucketMetricByMonth(ws, "2026-03-01", "2026-05-15", computeWorkoutTonnage);
  eq(buckets.map(b => b.label), ["Mar", "Apr", "May"], "bucketByMonth: one bucket per month");
  eq(buckets.map(b => b.total), [500, 1000, 100], "bucketByMonth: per-month totals");
  eq(buckets[2].endYMD, "2026-05-15", "bucketByMonth: last partial month clamped to today");
}
{
  // Year-spanning window: Dec 2025 -> Feb 2026
  const ws = [
    workout({ id: "dec", date: "2025-12-20", exercises: [ex("B", [set("100", "5")])] }),
    workout({ id: "feb", date: "2026-02-10", exercises: [ex("B", [set("100", "3")])] }),
  ];
  const buckets = bucketMetricByMonth(ws, "2025-12-01", "2026-02-28", computeWorkoutTonnage);
  eq(buckets.map(b => b.label), ["Dec", "Jan", "Feb"], "bucketByMonth: wraps across year boundary");
  eq(buckets.map(b => b.total), [500, 0, 300], "bucketByMonth: year-cross totals + empty middle month");
}

// ── DST boundary (the suspected off-by-one) ───────────────────────────────────
// US spring-forward 2026 is Sun Mar 8 @ 02:00. A local-midnight day across that
// boundary spans only 23h, but the bucketers divide elapsed ms by a hardcoded
// 86_400_000. A workout on Mon Mar 9 (the Monday that STARTS week 2 relative to a
// Feb 23 start) should land in bucket index 2, not 1.
const janOff = new Date(2026, 0, 1).getTimezoneOffset();
const julOff = new Date(2026, 6, 1).getTimezoneOffset();
const observesDST = janOff !== julOff;
if (observesDST) {
  const ws = [workout({ id: "dst", date: "2026-03-09", exercises: [ex("B", [set("100", "5")])] })];
  // rolling weeks: start Feb 23, 4 weeks -> Feb23, Mar2, Mar9, Mar16
  const wk = bucketMetricByRollingWeeks(ws, "2026-02-23", "2026-03-22", computeWorkoutTonnage);
  const landedWeek = wk.findIndex(b => b.workoutIds.includes("dst"));
  eq(landedWeek, 2, "DST rolling-weeks: Mar 9 workout lands in week index 2 (not bumped a week early)");

  // month buckets: a workout on the 1st-after-DST mustn't fall into the prior month.
  const ws2 = [workout({ id: "dstm", date: "2026-03-09", exercises: [ex("B", [set("100", "5")])] })];
  const mo = bucketMetricByMonth(ws2, "2026-02-01", "2026-03-31", computeWorkoutTonnage);
  const landedMonth = mo.findIndex(b => b.workoutIds.includes("dstm"));
  eq(landedMonth, 1, "DST month: Mar 9 workout lands in March bucket (index 1)");
} else {
  console.log("  (skipped DST assertions — host TZ does not observe DST)");
}

// ── collectExerciseHistory ────────────────────────────────────────────────────
{
  const hist = [
    workout({ id: "s2", date: "2026-05-10", completedAt: "2026-05-10T10:00:00.000Z", exercises: [
      ex("Bench Press", [set("100", "3"), set("90", "8"), set("100", "5")]),
    ]}),
    workout({ id: "s1", date: "2026-05-03", completedAt: "2026-05-03T10:00:00.000Z", exercises: [
      ex("bench press", [set("80", "5")]), // case-insensitive match
    ]}),
    workout({ id: "other", date: "2026-05-05", completedAt: "2026-05-05T10:00:00.000Z", exercises: [
      ex("Squat", [set("100", "5")]),       // different exercise, ignored
    ]}),
  ];
  const pts = collectExerciseHistory(hist, "Bench Press");
  eq(pts.map(p => p.workoutId), ["s1", "s2"], "exHistory: sorted ascending by completedAt, only matching exercise");
  const p2 = pts[1]; // the 2026-05-10 session
  // sets: 100x3=300, 90x8=720, 100x5=500. topWeight=100 (tie 100x3 vs 100x5 -> higher reps = 5)
  eq(p2.topWeight, 100, "exHistory: topWeight = heaviest set");
  eq(p2.topReps, 5, "exHistory: tie on weight -> higher reps wins for top set");
  eq(p2.bestSetVolume, 720, "exHistory: bestSetVolume = max single-set volume (90x8)");
  eq(p2.bestSetWeight, 90, "exHistory: bestSetWeight tracks the best-volume set");
  eq(p2.bestSetReps, 8, "exHistory: bestSetReps tracks the best-volume set");
  eq(p2.sessionVolume, 1520, "exHistory: sessionVolume = sum of working set volumes");
  eq(p2.totalReps, 16, "exHistory: totalReps = sum of reps (3+8+5)");
  // Est. 1RM, the chart line that took Best Set's place: the best set by
  // weight × (1 + reps / 30). 100×5 = 116.7 beats 90×8 = 114 and 100×3 = 110,
  // where Best Set (by weight × reps) picked the lighter 90×8.
  approx(p2.e1rm, 100 * (1 + 5 / 30), "exHistory: e1rm = the session's best Epley estimate");
  eq([p2.e1rmWeight, p2.e1rmReps], [100, 5], "exHistory: e1rm remembers the set it came from");
  eq(pts[0].e1rm, 80 * (1 + 5 / 30), "exHistory: one set, its own estimate");
  // The Sets tab's blocks: every working set in the order done.
  eq(p2.sets, [{ weight: 100, reps: 3 }, { weight: 90, reps: 8 }, { weight: 100, reps: 5 }], "exHistory: a session's sets, in order");
  eq(setsTotal(p2), p2.totalReps, "exHistory: the sets add up to the session's reps");
}
{
  // Warm-ups and sets not done stay out of the blocks; a bodyweight set is in,
  // with no weight; the same exercise twice in a day is one session's sets.
  const pts = collectExerciseHistory([workout({ id: "x", exercises: [
    ex("Dips", [set("20", "5", { type: "warmup" }), set("", "12"), set("10", "8", { done: false })]),
    ex("Dips", [set("10", "9")]),
  ] })], "Dips");
  eq(pts[0].sets, [{ weight: 0, reps: 12 }, { weight: 10, reps: 9 }], "exHistory: sets skip warm-ups and unticked, keep bodyweight, join both entries");
}
{
  // Est. 1RM and Heaviest part ways when the reps change: the same 100 kg for
  // 10 reps instead of 8 is no heavier, but it's stronger.
  const reps = collectExerciseHistory([
    workout({ id: "r8", date: "2026-05-01", completedAt: "2026-05-01T10:00:00.000Z", exercises: [ex("Row", [set("100", "8")])] }),
    workout({ id: "r10", date: "2026-05-08", completedAt: "2026-05-08T10:00:00.000Z", exercises: [ex("Row", [set("100", "10")])] }),
  ], "Row");
  eq(reps.map(p => p.topWeight), [100, 100], "e1rm: more reps at the same weight leave Heaviest flat");
  check(reps[1].e1rm > reps[0].e1rm, "e1rm: ...and show on Est. 1RM as progress");
}
{
  // A session done at bodyweight is on the chart: its reps, and no weight. It
  // used to be dropped, so a pull-up done every week said "No sessions yet"
  // (found by verify-training-months). Records stay weights only.
  const hist = [workout({ id: "bw", exercises: [ex("Pullups", [set("BW", "10"), set("", "8")])] })];
  const pts = collectExerciseHistory(hist, "Pullups");
  eq(pts.map(p => [p.workoutId, p.totalReps, p.topWeight, p.sessionVolume]), [["bw", 18, 0, 0]], "exHistory: a bodyweight session is a point with its reps and no weight");
  const prs = computePRs(pts, hist, "Pullups");
  eq([prs.heaviest, prs.bestSetVolume, prs.bestSessionVolume, prs.oneRepMax], [null, null, null, null], "PR: a bodyweight session holds no weight record");
  // ...but its reps are a record: a pull-up's is the most done in a set.
  eq([prs.mostReps?.value, prs.mostReps?.weight, prs.mostReps?.setIndex], [10, 0, 0], "PR most reps: a bodyweight set counts");
  // A timed hold: its "reps" are seconds, so they're not reps or volume, and
  // its chart point says it's a hold (found by verify-training-months).
  const plank = workout({ id: "pl", exercises: [
    { ...ex("Plank", [set("", "60"), set("10", "45")]), isIsometric: true },
    ex("Crunch", [set("", "15")]),
  ] });
  eq(computeWorkoutReps(plank), 15, "holds: a plank's seconds aren't reps");
  eq(computeWorkoutTonnage(plank), 0, "holds: a weighted plank moves no volume");
  const plankPts = collectExerciseHistory([plank], "Plank");
  eq(plankPts.map(p => [p.isHold, p.totalReps, p.topWeight, p.sessionVolume, p.e1rm]), [[true, 105, 10, 0, 0]], "holds: the chart's point is seconds held, its load, and no volume or 1RM");
  eq(computePRs(plankPts, [plank], "Plank").oneRepMax, null, "holds: no rep max from seconds");
  {
    const longest = computePRs(plankPts, [plank], "Plank").mostReps;
    eq([longest?.value, longest?.hold, longest?.setIndex], [60, true, 0], "holds: the reps record is the longest hold, in seconds");
  }
  // Mixed: a weighted session and a bodyweight one. Heaviest is the weighted.
  const mixed = [...hist, workout({ id: "w10", date: "2026-05-08", completedAt: "2026-05-08T10:00:00.000Z", exercises: [ex("Pullups", [set("10", "6")])] })];
  eq(computePRs(collectExerciseHistory(mixed, "Pullups"), mixed, "Pullups").heaviest?.workoutId, "w10", "PR: heaviest skips the bodyweight session");
}

// ── computePRs ────────────────────────────────────────────────────────────────
{
  const hist = [
    workout({ id: "p1", date: "2026-05-01", completedAt: "2026-05-01T10:00:00.000Z", exercises: [
      ex("Bench", [set("100", "3"), set("90", "8")]),  // top 100, bestSet 720, session 1020; 1RM: max(110, 114)=114
    ]}),
    workout({ id: "p2", date: "2026-05-08", completedAt: "2026-05-08T10:00:00.000Z", exercises: [
      ex("Bench", [set("100", "5")]),                  // top 100 (tie), bestSet 500, session 500; 1RM 116.67
    ]}),
  ];
  const points = collectExerciseHistory(hist, "Bench");
  const prs = computePRs(points, hist, "Bench");
  // heaviest weight tie (100 vs 100) -> earliest session wins (p1)
  eq(prs.heaviest?.value, 100, "PR heaviest: value");
  eq(prs.heaviest?.workoutId, "p1", "PR heaviest: tie keeps earliest session");
  // best single-set volume = 90x8 = 720 in p1
  eq(prs.bestSetVolume?.value, 720, "PR bestSetVolume: max single-set volume");
  eq(prs.bestSetVolume?.workoutId, "p1", "PR bestSetVolume: correct session");
  // The tile shows the set itself, "90 kg × 8", not just 720 (user request,
  // 2026-10-08).
  eq([prs.bestSetVolume?.weight, prs.bestSetVolume?.reps], [90, 8], "PR bestSetVolume: the set it was, for '90 kg × 8'");
  // best session volume = 1020 in p1
  eq(prs.bestSessionVolume?.value, 1020, "PR bestSessionVolume: max session tonnage");
  // Most Volume shows what added up to it: 2 sets, 11 reps (100×3 + 90×8).
  eq([prs.bestSessionVolume?.sets, prs.bestSessionVolume?.reps], [2, 11], "PR Most Volume: the sets and reps that made it");
  eq([points[0].weightedSets, points[0].weightedReps], [2, 11], "exHistory: a session's weighted sets and reps");
  // 1RM walks raw sets: epley(100,5)=116.67 beats epley(90,8)=114 and epley(100,3)=110
  approx(prs.oneRepMax!.value, 100 * (1 + 5 / 30), "PR 1RM: Epley picks the best single set across sessions");
  eq(prs.oneRepMax?.weight, 100, "PR 1RM: source set weight");
  eq(prs.oneRepMax?.reps, 5, "PR 1RM: source set reps");
  // Most reps: 90×8 in p1, the set itself (its index for the gold block).
  eq([prs.mostReps?.value, prs.mostReps?.weight, prs.mostReps?.workoutId, prs.mostReps?.setIndex], [8, 90, "p1", 1], "PR most reps: the set with the most reps");
}
{
  // Most reps on a tie: the heaviest set that did them, never the first light
  // one; then the earliest.
  const hist = [
    workout({ id: "a", date: "2026-05-01", completedAt: "2026-05-01T10:00:00.000Z", exercises: [ex("Ext", [set("50", "12"), set("50", "12")])] }),
    workout({ id: "b", date: "2026-05-08", completedAt: "2026-05-08T10:00:00.000Z", exercises: [ex("Ext", [set("77", "10"), set("77", "12")])] }),
    workout({ id: "c", date: "2026-05-15", completedAt: "2026-05-15T10:00:00.000Z", exercises: [ex("Ext", [set("77", "12")])] }),
  ];
  const prs = computePRs(collectExerciseHistory(hist, "Ext"), hist, "Ext");
  eq([prs.mostReps?.workoutId, prs.mostReps?.weight, prs.mostReps?.setIndex], ["b", 77, 1], "PR most reps: a tie goes to the heaviest, then the earliest");
}
{
  // Lighter-but-higher-rep set can take the 1RM crown.
  const hist = [workout({ id: "r", exercises: [ex("DL", [set("200", "1"), set("150", "10")])] })];
  const pts = collectExerciseHistory(hist, "DL");
  const prs = computePRs(pts, hist, "DL");
  // epley(200,1)=206.67 vs epley(150,10)=200 -> heavy single wins here
  approx(prs.oneRepMax!.value, 200 * (1 + 1 / 30), "PR 1RM: heavy single beats high-rep when Epley says so");
}
{
  // No qualifying sets -> all PRs null (no crash).
  const hist = [workout({ id: "e", exercises: [ex("Plank", [set("BW", "0", { done: true })])] })];
  const pts = collectExerciseHistory(hist, "Plank");
  const prs = computePRs(pts, hist, "Plank");
  eq([prs.heaviest, prs.bestSetVolume, prs.bestSessionVolume, prs.oneRepMax], [null, null, null, null], "PR: empty history -> all null");
}
// Minimal day ref for the scoping tests below.
function dayRef(partial: Partial<ProgramDayRef> & { label: string }): ProgramDayRef {
  return {
    key: `${partial.programId ?? "pA"}::${partial.dayId ?? "d0"}`,
    dayId: "d0", index: 0, programId: "pA", programName: "PPL",
    programExercises: [], isHistorical: false,
    absorbsUnidentified: true, duplicateLabel: false,
    ...partial,
  };
}
{
  // Day scoping: the same exercise on two different workout days keeps
  // separate histories/PRs when a day is passed, and merges all days when it is
  // omitted. Legacy records (no dayId) still match on the name, trimmed +
  // case-insensitive.
  const hist = [
    workout({ id: "push1", date: "2026-05-04", completedAt: "2026-05-04T10:00:00.000Z", workoutName: "Push", exercises: [
      ex("Lateral Raise", [set("10", "12")]),
    ]}),
    workout({ id: "arms1", date: "2026-05-07", completedAt: "2026-05-07T10:00:00.000Z", workoutName: "Arms", exercises: [
      ex("Lateral Raise", [set("14", "8")]), // heavier than any Push set
    ]}),
  ];
  const push = dayRef({ label: " push ", dayId: "d0" });
  const arms = dayRef({ label: "Arms", dayId: "d1", index: 1 });
  const pushPts = collectExerciseHistory(hist, "Lateral Raise", push);
  eq(pushPts.map(p => p.workoutId), ["push1"], "exHistory day-scope: only the matching day's sessions (case-insensitive trim)");
  const armsPts = collectExerciseHistory(hist, "Lateral Raise", arms);
  eq(armsPts.map(p => p.workoutId), ["arms1"], "exHistory day-scope: the other day sees only its own sessions");
  eq(collectExerciseHistory(hist, "Lateral Raise").length, 2, "exHistory day-scope: omitted day merges all days");
  const pushPrs = computePRs(pushPts, hist, "Lateral Raise", push);
  eq(pushPrs.heaviest?.value, 10, "PR day-scope: heaviest ignores the other day's heavier set");
  approx(pushPrs.oneRepMax!.value, 10 * (1 + 12 / 30), "PR day-scope: the 1RM raw-set walk is day-filtered too");
}
{
  // Two days sharing a NAME: the id decides, and a rename doesn't change it.
  const upperA = dayRef({ label: "Upper A", dayId: "d0", index: 0 });
  const upperB = dayRef({ label: "Upper B", dayId: "d3", index: 3, absorbsUnidentified: false });
  const a = workout({ id: "a", programId: "pA", dayId: "d0", workoutName: "Upper", exercises: [ex("Bench", [set("80", "8")])] });
  const b = workout({ id: "b", programId: "pA", dayId: "d3", workoutName: "Upper", exercises: [ex("Bench", [set("100", "8")])] });
  check(workoutMatchesDay(a, upperA) && !workoutMatchesDay(a, upperB), "matchesDay: dayId wins over a stale name");
  check(workoutMatchesDay(b, upperB) && !workoutMatchesDay(b, upperA), "matchesDay: the second same-named day keeps its own sessions");
  eq(collectExerciseHistory([a, b], "Bench", upperA).map(p => p.topWeight), [80], "exHistory: same-named days don't pool");
  eq(collectExerciseHistory([a, b], "Bench", upperB).map(p => p.topWeight), [100], "exHistory: second day sees only its own");

  // Legacy record with no dayId lands on exactly one row, never both.
  const legacy = workout({ id: "l", programId: "pA", workoutName: "Upper", exercises: [ex("Bench", [set("60", "8")])] });
  const dupA = dayRef({ label: "Upper", dayId: "d0", index: 0, absorbsUnidentified: true, duplicateLabel: true });
  const dupB = dayRef({ label: "Upper", dayId: "d3", index: 3, absorbsUnidentified: false, duplicateLabel: true });
  check(workoutMatchesDay(legacy, dupA), "matchesDay: unidentified record attaches to the absorbing day");
  check(!workoutMatchesDay(legacy, dupB), "matchesDay: unidentified record is not double counted");

  // Positional ids are only unique within a program, so the guard matters.
  const otherProgram = dayRef({ label: "Upper A", dayId: "d0", programId: "pB" });
  check(!workoutMatchesDay(a, otherProgram), "matchesDay: same positional id in another program does not match");
}
{
  // Custom workouts under "All programs" (found by verify-training-months):
  // two programs each with an "Arms" workout added, and a free one never added.
  const pA = { id: "pA", name: "Upper Lower", totalWeeks: 6, currentWeek: 1, status: "completed" as const, startDate: "01 Jan 2026", trainingDays: 1, cycleDays: 2, cyclePattern: ["Upper", "Rest"], dayIds: ["d0", "d1"], workouts: {}, extraWorkouts: ["Arms"] };
  const pB = { ...pA, id: "pB", name: "Push Pull Legs", status: "active" as const, cyclePattern: ["Push", "Rest"] };
  const armsA = workout({ id: "aA", programId: "pA", workoutName: "Arms", exercises: [ex("Barbell Curl", [set("30", "10")])] });
  const armsB = workout({ id: "aB", programId: "pB", workoutName: "Arms", exercises: [ex("Barbell Curl", [set("32", "10")])] });
  const free = workout({ id: "f", programId: "", workoutName: "Arms", exercises: [ex("Barbell Curl", [set("34", "10")])] });
  const days = scopedProgramDays({ kind: "all" }, [pA, pB], [armsA, armsB, free]);
  const rowA = days.find(d => d.programId === "pA" && d.label === "Arms")!;
  const rowB = days.find(d => d.programId === "pB" && d.label === "Arms")!;
  eq(collectExerciseHistory([armsA, armsB, free], "Barbell Curl", rowA).map(p => p.workoutId), ["aA"],
    "matchesDay: a program's custom workout counts on its own program's row, not a free one of the same name");
  eq(collectExerciseHistory([armsA, armsB, free], "Barbell Curl", rowB).map(p => p.workoutId), ["aB"],
    "matchesDay: under All programs, the second program's own custom workouts still count on its row");
  check(!workoutMatchesDay(free, rowA) && !workoutMatchesDay(free, rowB), "matchesDay: a free workout belongs to no program's day");
}

// ── program scope helpers ─────────────────────────────────────────────────────
function makeProgram(partial: Partial<SavedProgram> = {}): SavedProgram {
  return {
    id: "pA", name: "PPL", totalWeeks: 8, currentWeek: 1, status: "active",
    startDate: "01 Jan 2026", trainingDays: 3, cycleDays: 7,
    cyclePattern: ["Push", "Pull", "Legs", "Rest", "Push", "Pull", "Rest"],
    workouts: {}, ...partial,
  };
}
{
  const p = makeProgram({ extraWorkouts: ["Conditioning"] });
  check(programIncludes(p, "push"), "programIncludes: cyclePattern day (case-insensitive)");
  check(programIncludes(p, "Conditioning"), "programIncludes: extraWorkouts");
  check(!programIncludes(p, "Rest"), "programIncludes: Rest never counts");
  check(!programIncludes(p, "Yoga"), "programIncludes: unknown name -> false");
}
{
  const p = makeProgram({ id: "pA", completedDate: "31 Jan 2026" });
  // New-style record: match strictly by programId.
  eq(workoutBelongsToProgram(workout({ id: "n", programId: "pA", exercises: [] }), p), true, "belongs: new-style id match");
  eq(workoutBelongsToProgram(workout({ id: "n2", programId: "pB", exercises: [] }), p), false, "belongs: new-style id mismatch");
  eq(workoutBelongsToProgram(workout({ id: "f", programId: "", exercises: [] }), p), false, "belongs: free workout ('') belongs to no program");
  // Legacy record (programId undefined): match by name within [start, completed].
  eq(workoutBelongsToProgram(workout({ id: "lg", date: "2026-01-15", workoutName: "Push", exercises: [] }), p), true, "belongs: legacy name match in window");
  eq(workoutBelongsToProgram(workout({ id: "lg2", date: "2025-12-15", workoutName: "Push", exercises: [] }), p), false, "belongs: legacy before startDate -> no");
  eq(workoutBelongsToProgram(workout({ id: "lg3", date: "2026-02-15", workoutName: "Push", exercises: [] }), p), false, "belongs: legacy after completedDate -> no");
}
{
  const active = makeProgram({ id: "act", status: "active" });
  const old = makeProgram({ id: "old", status: "completed", name: "Old" });
  const programs = [active, old];
  const ws = [
    workout({ id: "a", programId: "act", exercises: [] }),
    workout({ id: "o", programId: "old", exercises: [] }),
  ];
  eq(filterByProgramScope(ws, { kind: "all" }, programs).map(w => w.id), ["a", "o"], "scope all: identity");
  eq(filterByProgramScope(ws, { kind: "current" }, programs).map(w => w.id), ["a"], "scope current: active program only");
  eq(filterByProgramScope(ws, { kind: "program", programId: "old" }, programs).map(w => w.id), ["o"], "scope program: named program");
  eq(filterByProgramScope(ws, { kind: "program", programId: "ghost" }, programs), [], "scope program: missing -> []");
  eq(programsInScope({ kind: "current" }, programs).map(p => p.id), ["act"], "programsInScope current");
}
{
  const p = makeProgram({ extraWorkouts: ["Conditioning", "conditioning"] }); // dupe case
  const days = scopedProgramDays({ kind: "all" }, [p]);
  // Every SLOT, not every distinct name: the cycle runs Push and Pull twice, so
  // those are four separate days. extraWorkouts still dedupe by name (they have
  // no slot to tell them apart).
  eq(days.map(d => d.label), ["Push", "Pull", "Legs", "Push", "Pull", "Conditioning"], "scopedProgramDays: one row per slot, Rest dropped, extras name-deduped");
  eq(days.map(d => d.index), [0, 1, 2, 4, 5, -1], "scopedProgramDays: slot index carried, -1 for extras");
  eq(days.filter(d => d.label === "Push").map(d => d.absorbsUnidentified), [true, false], "scopedProgramDays: only the first same-named day absorbs unidentified sessions");
  check(days.every(d => d.label !== "Push" || d.duplicateLabel), "scopedProgramDays: repeated labels flagged for the UI");
  check(new Set(days.map(d => d.key)).size === days.length, "scopedProgramDays: keys are unique");
}
{
  // Renaming a day must not renumber the ids its sessions point at.
  const before = makeProgram({ dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"] });
  const after = { ...before, cyclePattern: ["Upper A", "Pull", "Legs", "Rest", "Upper B", "Pull", "Rest"] };
  eq(programDays(before).map(d => d.dayId), programDays(after).map(d => d.dayId), "programDays: ids survive a rename");
  // And a program with no dayIds falls back to the deterministic positional ids.
  eq(programDays(makeProgram()).map(d => d.dayId), ["d0", "d1", "d2", "d4", "d5"], "programDays: positional fallback for a pre-dayIds program");
  eq(markDayRefLabels([]).length, 0, "markDayRefLabels: empty list is fine");
  // Day PICKERS offer the cycle only; free workouts have no slot to schedule.
  const withExtras = makeProgram({ extraWorkouts: ["Conditioning"] });
  eq(programDays(withExtras).map(d => d.label), ["Push", "Pull", "Legs", "Push", "Pull"], "programDays: extraWorkouts excluded (pickers offer the cycle)");
  eq(programDaysWithExtras(withExtras).map(d => d.label).slice(-1), ["Conditioning"], "programDaysWithExtras: extras appended for the Progress list");
  eq(
    ["Custom WorkoutLegs", "Custom WorkoutArms Day", "Custom Workout", "Custom Workouts", "Custom Workout 2", "Legs"].map(displayWorkoutName),
    ["Legs", "Arms Day", "Custom Workout", "Custom Workouts", "Custom Workout 2", "Legs"],
    "displayWorkoutName: a name typed onto \"Custom Workout\" reads as the name alone; anything else is left as it is",
  );
  // A single program's own duplicates are flagged without a scope pass.
  check(programDays(before).filter(d => d.label === "Pull").every(d => d.duplicateLabel), "programDays: same-named slots flagged within one program");
}

// ── collectLoggedExercisesForDay / sessionCountForDay ─────────────────────────
{
  const ws = [
    workout({ id: "d1", date: "2026-05-01", completedAt: "2026-05-01T10:00:00.000Z", workoutName: "Push", exercises: [
      ex("Bench", [set("80", "8"), set("85", "6")]),
    ]}),
    workout({ id: "d2", date: "2026-05-08", completedAt: "2026-05-08T10:00:00.000Z", workoutName: "push", exercises: [
      ex("Bench", [set("90", "5")]),    // newer session -> drives "last" preview
      ex("Fly", [set("20", "12")]),
    ]}),
    workout({ id: "d3", date: "2026-05-02", completedAt: "2026-05-02T10:00:00.000Z", workoutName: "Pull", exercises: [
      ex("Row", [set("70", "10")]),     // different day, ignored
    ]}),
  ];
  const pushDay = dayRef({ label: "Push" });
  const rows = collectLoggedExercisesForDay(ws, pushDay);
  const bench = rows.find(r => r.name === "Bench")!;
  eq(bench.lastWeight, "90", "loggedForDay: last preview from most recent session");
  eq(bench.lastReps, "5", "loggedForDay: last reps from most recent session");
  eq(bench.sessionCount, 2, "loggedForDay: session count across matching days");
  eq(rows.map(r => r.name).sort(), ["Bench", "Fly"], "loggedForDay: deduped exercises across sessions");
  eq(sessionCountForDay(ws, dayRef({ label: "push" })), 2, "sessionCountForDay: case-insensitive match");
  eq(sessionCountForDay(ws, dayRef({ label: "Legs", dayId: "d2", index: 2 })), 0, "sessionCountForDay: no sessions -> 0");

  // The same exercise on two same-named days reports separately (different
  // prescriptions on each), rather than merging into one row.
  const twin = [
    workout({ id: "ua", programId: "pA", dayId: "d0", workoutName: "Upper", exercises: [ex("Chest Press", [set("60", "12")])] }),
    workout({ id: "ub", programId: "pA", dayId: "d3", workoutName: "Upper", exercises: [ex("Chest Press", [set("90", "5")])] }),
  ];
  const rowsA = collectLoggedExercisesForDay(twin, dayRef({ label: "Upper A", dayId: "d0" }));
  const rowsB = collectLoggedExercisesForDay(twin, dayRef({ label: "Upper B", dayId: "d3", index: 3, absorbsUnidentified: false }));
  eq([rowsA.length, rowsA[0].lastWeight, rowsA[0].lastReps], [1, "60", "12"], "loggedForDay: same-named day A keeps its own numbers");
  eq([rowsB.length, rowsB[0].lastWeight, rowsB[0].lastReps], [1, "90", "5"], "loggedForDay: same-named day B keeps its own numbers");
}

// ── editing a running program: what the Progress page shows afterwards ────────
// End-to-end for the mid-program edit cases. A forked day must appear BESIDE
// the day that replaced it (its sessions are still real), and an exercise
// dropped from a day must still be listed, flagged.
{
  const bench = [{ id: "e1", name: "Bench", sets: [{ type: "working" as const }] }];
  const incline = [{ id: "e2", name: "Incline Press", sets: [{ type: "working" as const }] }];
  const program = makeProgram({
    id: "pA",
    cyclePattern: ["Upper A", "Rest"],
    cycleDays: 2,
    // "d0" forked away when the day was renamed + re-stocked; the slot now holds
    // a fresh id and prescribes Incline Press.
    dayIds: ["fresh", "d1"],
    workouts: { "0:Upper A": incline },
    extraWorkouts: undefined,
  });
  const history = [
    // Logged before the edit, against the day as it was then.
    workout({ id: "old1", date: "2026-04-06", completedAt: "2026-04-06T10:00:00.000Z", programId: "pA", dayId: "d0", workoutName: "Upper", exercises: [ex("Bench", [set("80", "8")])] }),
    // Logged after the edit, against the new day.
    workout({ id: "new1", date: "2026-05-04", completedAt: "2026-05-04T10:00:00.000Z", programId: "pA", dayId: "fresh", workoutName: "Upper A", exercises: [ex("Incline Press", [set("60", "10")])] }),
  ];
  const days = scopedProgramDays({ kind: "all" }, [program], history);
  eq(days.map(d => d.label), ["Upper A", "Upper"], "edit: the forked-away day appears beside its replacement");
  eq(days.map(d => d.isHistorical), [false, true], "edit: only the day that left the program is marked historical");
  eq(days[1].programName, program.name, "edit: a historical day still names its program");
  eq(sessionCountForDay(history, days[0]), 1, "edit: the new day counts only sessions logged since");
  eq(sessionCountForDay(history, days[1]), 1, "edit: the old day keeps its own sessions");
  eq(collectLoggedExercisesForDay(history, days[1]).map(r => r.name), ["Bench"], "edit: the historical day still lists what was logged on it");
  check(collectLoggedExercisesForDay(history, days[1]).every(r => r.inProgram), "edit: nothing on a historical day is flagged swapped-out (no prescription to compare)");

  // Same program, but the day was only re-stocked (not renamed) — one row, with
  // the dropped exercise still listed and flagged.
  const tuned = makeProgram({ id: "pB", cyclePattern: ["Upper", "Rest"], cycleDays: 2, dayIds: ["d0", "d1"], workouts: { "0:Upper": incline } });
  const tunedHistory = [
    workout({ id: "b1", date: "2026-04-06", completedAt: "2026-04-06T10:00:00.000Z", programId: "pB", dayId: "d0", workoutName: "Upper", exercises: [ex("Bench", [set("80", "8")])] }),
    workout({ id: "b2", date: "2026-05-04", completedAt: "2026-05-04T10:00:00.000Z", programId: "pB", dayId: "d0", workoutName: "Upper", exercises: [ex("Incline Press", [set("60", "10")])] }),
  ];
  const tunedDays = scopedProgramDays({ kind: "all" }, [tuned], tunedHistory);
  eq(tunedDays.length, 1, "swap: swapping an exercise does not add a day row");
  const rows = collectLoggedExercisesForDay(tunedHistory, tunedDays[0]);
  eq(rows.map(r => [r.name, r.inProgram]), [["Incline Press", true], ["Bench", false]], "swap: the dropped exercise is still listed, flagged as swapped out");
  eq(collectExerciseHistory(tunedHistory, "Bench", tunedDays[0]).map(p => p.topWeight), [80], "swap: a swapped-out exercise keeps its progression data");

  // A free workout attached to a program has no prescription, so nothing on it
  // may be flagged.
  const withExtra = makeProgram({ id: "pC", cyclePattern: ["Rest"], cycleDays: 1, dayIds: ["d0"], workouts: {}, extraWorkouts: ["Conditioning"] });
  const extraDay = scopedProgramDays({ kind: "all" }, [withExtra], [])[0];
  const extraHistory = [workout({ id: "c1", programId: "pC", workoutName: "Conditioning", exercises: [ex("Sled Push", [set("100", "10")])] })];
  check(collectLoggedExercisesForDay(extraHistory, extraDay).every(r => r.inProgram), "extras: a free workout's exercises are never flagged swapped-out");

  // Renamed only: ONE row, relabelled, with the pre-rename sessions still on it.
  const renamed = makeProgram({ id: "pD", cyclePattern: ["Upper A", "Rest"], cycleDays: 2, dayIds: ["d0", "d1"], workouts: { "0:Upper A": bench } });
  const renamedHistory = [
    workout({ id: "r1", date: "2026-04-06", completedAt: "2026-04-06T10:00:00.000Z", programId: "pD", dayId: "d0", workoutName: "Upper", exercises: [ex("Bench", [set("80", "8")])] }),
    workout({ id: "r2", date: "2026-05-04", completedAt: "2026-05-04T10:00:00.000Z", programId: "pD", dayId: "d0", workoutName: "Upper A", exercises: [ex("Bench", [set("85", "8")])] }),
  ];
  const renamedDays = scopedProgramDays({ kind: "all" }, [renamed], renamedHistory);
  eq(renamedDays.map(d => d.label), ["Upper A"], "rename: one row, showing the new name");
  eq(sessionCountForDay(renamedHistory, renamedDays[0]), 2, "rename: sessions logged under the OLD name stay on the day");
  eq(collectExerciseHistory(renamedHistory, "Bench", renamedDays[0]).map(p => p.topWeight), [80, 85], "rename: one continuous trend across the rename");

  // Moved to another cycle slot: nothing about the page changes.
  const moved = makeProgram({ id: "pE", cyclePattern: ["Rest", "Upper"], cycleDays: 2, dayIds: ["d1", "d0"], workouts: { "1:Upper": bench } });
  const movedHistory = [workout({ id: "m1", programId: "pE", dayId: "d0", workoutName: "Upper", exercises: [ex("Bench", [set("80", "8")])] })];
  const movedDays = scopedProgramDays({ kind: "all" }, [moved], movedHistory);
  eq(movedDays.map(d => [d.label, d.isHistorical]), [["Upper", false]], "move: shifting a day to another slot leaves one live row");
  eq(sessionCountForDay(movedHistory, movedDays[0]), 1, "move: the day keeps its sessions across the move");

  // Sessions whose program is gone don't conjure a program's row: they're
  // Custom workouts (user decision, 2026-10-23), each day of them saying it
  // was a deleted program's.
  const goneDays = scopedProgramDays({ kind: "all" }, [], history);
  eq(goneDays.filter(d => !d.custom).length, 0, "edit: a deleted program's sessions produce no historical row");
  eq(goneDays.map(d => [d.label, d.custom?.deletedProgram]), [["Upper A", true], ["Upper", true]],
    "edit: ...they're Custom workouts' days, newest first, from a deleted program");
  // A day deleted from the cycle keeps its history the same way a forked one does.
  const shrunk = makeProgram({ id: "pF", cyclePattern: ["Rest"], cycleDays: 1, dayIds: ["d9"], workouts: {} });
  const shrunkHistory = [workout({ id: "s1", programId: "pF", dayId: "d0", workoutName: "Arms", exercises: [ex("Curl", [set("20", "12")])] })];
  eq(
    scopedProgramDays({ kind: "all" }, [shrunk], shrunkHistory).map(d => [d.label, d.isHistorical]),
    [["Arms", true]],
    "delete: a day removed from the cycle survives as a historical row",
  );
  // A live day is never duplicated as a historical one.
  eq(historicalDays(history, [program], programDays(program)).map(d => d.dayId), ["d0"], "historicalDays: skips ids the cycle still has");
}

// ── groupDaysByProgram ("All programs" in Exercise Progress) ──────────────────
{
  const done = makeProgram({ id: "pDone", name: "Upper Lower", status: "completed", cyclePattern: ["Upper", "Lower", "Rest"], cycleDays: 3, dayIds: ["d0", "d1", "d2"] });
  const later = makeProgram({ id: "pNew", name: "5x5", status: "created", cyclePattern: ["Push", "Rest"], cycleDays: 2, dayIds: ["d0", "d1"] });
  const running = makeProgram({ id: "pRun", name: "PPL", status: "active", dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"] });
  const history = [
    // A day that has left the completed program, so it's appended after every
    // live day in the scope, not beside its own program's days.
    workout({ id: "h1", programId: "pDone", dayId: "gone", workoutName: "Arms", exercises: [ex("Curl", [set("20", "12")])] }),
  ];
  const days = scopedProgramDays({ kind: "all" }, [done, later, running], history);
  const groups = groupDaysByProgram(days, [done, later, running]);
  eq(groups.map(g => g.programName), ["PPL", "5x5", "Upper Lower"], "groups: active, then not started, then completed");
  eq(groups.map(g => g.status), ["active", "created", "completed"], "groups: each carries its program's status");
  eq(groups[2].days.map(d => [d.label, d.isHistorical]), [["Upper", false], ["Lower", false], ["Arms", true]], "groups: a day that left a program is listed under it, after its live days");
  eq(groups.reduce((n, g) => n + g.days.length, 0), days.length, "groups: every day in scope lands in exactly one group");
  // "Push" is in PPL (twice) and in 5x5: within 5x5 it's unique, within PPL it isn't.
  check(days.filter(d => d.label === "Push").every(d => d.duplicateLabel), "groups: across the whole scope every Push reads as duplicated");
  eq(groups[1].days.map(d => d.duplicateLabel), [false], "groups: a name repeated only in ANOTHER program needs no qualifier under its heading");
  check(groups[0].days.filter(d => d.label === "Push").every(d => d.duplicateLabel), "groups: a name repeated within one program is still qualified");
  eq(
    groups.flatMap(g => g.days).filter(d => d.absorbsUnidentified).map(d => d.key).sort(),
    days.filter(d => d.absorbsUnidentified).map(d => d.key).sort(),
    "groups: which row absorbs a session with no dayId is still decided across the whole scope",
  );
  eq(groupDaysByProgram([], [running]), [], "groups: no days, no groups");
}

// ── the exercise chart ────────────────────────────────────────────────────────
// One kind of chart per tab (user decision, 2026-10-12): Strength, Sets,
// Volume. Sessions as the chart gets them, from logged workouts.
const sessionsOf = (rows: [string, [number, number][]][]) =>
  collectExerciseHistory(
    rows.map(([date, sets], i) => workout({
      id: `s${i}`, date, completedAt: `${date}T10:00:00.000Z`,
      exercises: [ex("Row", sets.map(([w, r]) => set(w > 0 ? String(w) : "", String(r))))],
    })),
    "Row",
  );
const dayOf = (i: number) => `2026-07-${String(i + 1).padStart(2, "0")}`;
eq([isExerciseMetric("strength"), isExerciseMetric("topWeight")], [true, false], "tabs: Strength, Sets and Volume only");

// ── its slots ────────────────────────────────────────────────────────────────
// Every session a numbered slot of the same width. What fits sits in the
// middle, as option A showed five sessions; past that the row scrolls and
// opens on the newest (user decision, 2026-10-12).
{
  const few = exerciseChartGeometry(5, 390);
  eq([few.viewportWidth, few.contentWidth, few.maxScrollX], [286, 286, 0], "slots: five sessions fit a 390pt phone without scrolling");
  approx(slotX(few, 1) - slotX(few, 0), SESSION_SPACING, "slots: the same width each");
  approx((slotX(few, 0) + slotX(few, 4)) / 2, few.viewportWidth / 2, "slots: a short row sits in the middle");
  eq(visibleSlots(few, 5, 0), { first: 0, last: 4 }, "slots: all five on screen");
  const many = exerciseChartGeometry(23, 390);
  eq(many.contentWidth, 23 * SESSION_SPACING, "slots: a long row keeps its slots' width and scrolls");
  approx(slotX(many, 22) - many.maxScrollX, many.viewportWidth - SESSION_SPACING / 2, "slots: opened at the end, the newest is half a slot in from the right");
  const end = visibleSlots(many, 23, many.maxScrollX);
  eq(end.last, 22, "slots: the newest on screen when it opens");
  check(end.last - end.first + 1 >= 6, "slots: about six sessions on screen at once");
  eq(visibleSlots(many, 23, 0).first, 0, "slots: scrolled back, the first session");
  check(slotX(many, 0) >= SESSION_SPACING / 2 - 1e-9, "slots: the first session clear of the axis");
}

// ── the exercise chart's y-axis ───────────────────────────────────────────────
// Zoomed to the sessions, never squeezed below a fifth of the top value. From
// zero with the first session on the middle line, every metric drew as its
// ratio to the first session: a 10% gain moved a dot 5% of the plot, and
// Heaviest and Best Set landed on the same dots (user report, 2026-10-08).
{
  // Where a value sits, as a share of the plot's height from the bottom.
  const at = (v: number, values: number[]) => {
    const a = exerciseChartAxis(values);
    return (CHART_HEIGHT + PLOT_TOP - dotY(v, a)) / CHART_HEIGHT;
  };
  const climb = [60, 62.5, 65, 66];
  check(at(66, climb) - at(60, climb) >= 0.25, "axis: 60 → 66 kg climbs a quarter of the plot or more");
  eq(at(60, [60]), 0.5, "axis: a lone session sits in the middle");
  eq([60, 60, 60].map(v => at(v, [60, 60, 60])), [0.5, 0.5, 0.5], "axis: so does a flat run");
  check(at(61, [60, 61, 60]) - at(60, [60, 61, 60]) <= 0.1, "axis: a 1 kg wobble on 60 stays small");
  const wide = [5, 100];
  check(at(5, wide) >= 0 && at(100, wide) <= 1, "axis: every session inside the plot");
  check(exerciseChartAxis(wide).min === 0, "axis: never below zero");
  eq(exerciseChartAxis([60, 62.5, 65, 66]).labels, ["55", "60", "65", "70", "75"], "axis: round steps from a round bottom");
  check(exerciseChartAxis([24, 30]).labels.every(l => !l.includes(".")), "axis: reps step in whole numbers");
  eq(exerciseChartAxis([2000, 2300, 2600]).labels, ["1.75k", "2k", "2.25k", "2.5k", "2.75k"], "axis: thousands read as k");
  eq(exerciseChartAxis([]).min, 0, "axis: nothing to plot, a clean grid from zero");

  // Heaviest reads in the jumps the weights were loaded in: loaded 5 kg at a
  // time, a T-bar row read against 44, 48, 52, 56 (user report, 2026-10-12).
  eq(loadStep([30, 40, 55, 55]), 5, "load: weights in 5 kg jumps");
  eq(loadStep([57.5, 60, 62.5, 65]), 2.5, "load: in 2.5 kg jumps");
  eq(loadStep([40, 45, 50, 52.5]), 5, "load: mainly 5 kg jumps, one odd weight aside");
  eq(loadStep([135.0006, 145.0003, 155.0009]), 5, "load: lbs read back from kg still find their 5 lb jumps");
  eq(loadStep([50.3, 63.7, 77.1]), null, "load: weights too uneven for any jump");
  eq(exerciseChartAxis([30, 40, 55, 55], true).labels, ["20", "30", "40", "50", "60"], "axis: 5 kg jumps read in tens, never 44, 48, 52");
  check(exerciseChartAxis([135.0006, 145.0003, 155.0009], true).labels.every(l => Number(l) % 5 === 0), "axis: 5 lb jumps read in fives");
  check(exerciseChartAxis([57.5, 60, 62.5, 65], true).labels.every(l => Number(l) % 2.5 === 0), "axis: 2.5 kg jumps read in 2.5s or more");
  eq(exerciseChartAxis([50, 63, 77, 84], true).labels, ["40", "50", "60", "70", "80", "90"], "axis: a machine's uneven pins take round steps (five of them fit closer than four)");
  check(!exerciseChartAxis([48, 55, 55], true).labels.includes("44"), "axis: steps are 1, 2, 2.5 or 5 times ten, never 4");
  eq(axisLoadStep([10, 10, 10, 8]), null, "load: weights all within one jump don't step by it");
  {
    // Light dumbbells mostly on 5s, all within a jump: round steps that show
    // the change rather than 0, 5, 10, 15 with the line at the foot.
    const a = exerciseChartAxis([10, 10, 10, 8], true);
    check((dotY(8, a) - dotY(10, a)) / CHART_HEIGHT >= 0.3, "axis: a change within one jump still fills the plot");
  }
  check(exerciseChartAxis([14, 16, 18, 20, 22], true).labels.every(l => Number(l) % 2 === 0), "axis: 2 kg dumbbell jumps read in even steps");
  {
    const a = exerciseChartAxis([50, 63, 77, 84], true);
    eq([a.labels.length, a.max], [a.sections + 1, a.min + a.sections * a.stepValue], "axis: one label per line, the top at its last step");
  }
  {
    // Bars stand on zero, with room over the tallest for its label.
    const a = barAxis([30, 28, 22]);
    eq(a.min, 0, "bar axis: from zero");
    check(a.max >= 33 && a.labels.every(l => !l.includes(".")), "bar axis: a tenth over the tallest, whole steps for reps");
  }
  {
    // The axis fits the sessions on screen: scrolled to the newest of ten
    // weeks climbing 40 → 85 kg, it fits the newest few, not the light first
    // weeks too.
    const pts = sessionsOf([40, 45, 50, 55, 60, 65, 70, 75, 80, 85].map((w, i): [string, [number, number][]] => [dayOf(i), [[w, 8]]]));
    const g = exerciseChartGeometry(pts.length, 390);
    const { first, last } = visibleSlots(g, pts.length, g.maxScrollX);
    const a = windowAxis(pts, "strength", first, last)!;
    check(a.min > 40 && a.max >= 85, "window axis: fits the sessions on screen, not the first light weeks");
    check(pts.slice(first, last + 1).every(p => dotY(p.topWeight, a) >= PLOT_TOP && dotY(p.topWeight, a) <= PLOT_TOP + CHART_HEIGHT),
      "window axis: every dot on screen inside the plot");
    check(a.labels.every(l => Number(l) % 5 === 0), "window axis: Strength still steps by the load jump");
  }
  {
    // A screen of bodyweight sessions has nothing for Strength: no axis, and
    // the plot keeps the whole row's.
    const pts = sessionsOf([["2026-07-01", [[0, 10]]], ["2026-07-08", [[0, 12]]]]);
    eq(windowAxis(pts, "strength", 0, 1), null, "window axis: nothing drawn, no axis");
    eq(drawsOn(pts[0], "sets"), true, "draws: Sets draws a bodyweight session");
    eq(drawsOn(pts[0], "strength") || drawsOn(pts[0], "volume"), false, "draws: Strength and Volume leave its slot empty");
  }
}

// ── the Sets tab's stacks ─────────────────────────────────────────────────────
// A block per set, set 1 on the baseline, as tall as its reps, a lighter
// back-off set marked (drawn paler, so the weight over the stack can't pass
// for it).
{
  const pts = sessionsOf([["2026-10-12", [[60, 8], [60, 8], [55, 9]]]]);
  const g = exerciseChartGeometry(1, 390);
  const a = windowAxis(pts, "sets", 0, 0)!;
  const [st] = setStacks(pts, g, a);
  approx(st.blocks[0].y + st.blocks[0].h, PLOT_TOP + CHART_HEIGHT, "stack: set 1 stands on the baseline", 1e-6);
  approx(st.top, dotY(25, a), "stack: as tall as the session's 25 reps", 1e-6);
  approx(st.blocks[2].h + BLOCK_GAP, dotY(16, a) - dotY(25, a), "stack: a block as tall as its 9 reps, less the gap over it", 1e-6);
  eq(st.blocks.map(b => b.lighter), [false, false, true], "stack: the lighter back-off set is marked");
  eq(st.heaviest, 60, "stack: the weight over it is the heaviest set");
  check(st.blocks.every((b, i) => i === 0 || b.y + b.h <= st.blocks[i - 1].y + 1e-6), "stack: each block above the one before");
  check(st.labelY - 7 >= 0, "stack: its weight inside the chart");
}

// ── the paths ─────────────────────────────────────────────────────────────────
// What's drawn, on whatever axis the plot is easing through.
{
  eq(linePathD([10, 54], [60, 80], 50, 100), `M10,${PLOT_TOP + CHART_HEIGHT * 0.8}L54,${PLOT_TOP + CHART_HEIGHT * 0.4}`, "path: the line straight through each session");
  check(blocksPathD([22, 0, 10], 0, 40).startsWith("M"), "path: a block");
  eq(blocksPathD([], 0, 40), "", "path: no blocks, nothing drawn");
  check(barsPathD([22], [100], 0, 200).includes(`V${PLOT_TOP + CHART_HEIGHT}`), "path: a bar stands on the baseline");
}

// ── the record's shine ────────────────────────────────────────────────────────
// Every few seconds a glint of light runs up the gold bar or block, and a
// sparkle twinkles on the gold dot (user request, 2026-10-13): on its shape and
// only on it, rising, and nothing at either end of its run.
{
  const pointsOf = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const meanY = (d: string) => { const p = pointsOf(d); return p.reduce((s, [, y]) => s + y, 0) / p.length; };
  const base = PLOT_TOP + CHART_HEIGHT;
  const axis = { min: 0, max: 1000 };
  const top = dotY(800, axis);
  const L = 100 - BAR_WIDTH / 2;
  const R = 100 + BAR_WIDTH / 2;
  const k = 5; // the bar's rounded top corners (barsPathD)
  const onBar = (d: string) => pointsOf(d).every(([x, y]) => {
    if (x < L - 0.05 || x > R + 0.05 || y < top - 0.05 || y > base + 0.05) return false;
    // In a top corner, inside its curve (a quadratic bulges ~7% past the circle).
    const cx = x < L + k ? L + k : x > R - k ? R - k : null;
    return cx === null || y >= top + k || Math.hypot(x - cx, y - (top + k)) <= k * 1.07 + 0.1;
  });
  eq(barGlintD(100, 800, 0, 1000, 0, 14), "", "shine: nothing on the bar before the glint starts");
  eq(barGlintD(100, 800, 0, 1000, 1, 14), "", "shine: nothing once it's run past the top");
  const along = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map(p => barGlintD(100, 800, 0, 1000, p, 14));
  check(along.every(d => d.startsWith("M") && onBar(d)), "shine: the glint is on the bar all the way up, and only on it");
  check(along.every((d, i) => i === 0 || meanY(d) < meanY(along[i - 1])), "shine: it runs up the bar");
  // The bands share one centre, so the narrow bright one sits inside the wide one.
  const wide = pointsOf(barGlintD(100, 800, 0, 1000, 0.5, 14));
  const narrow = pointsOf(barGlintD(100, 800, 0, 1000, 0.5, 4));
  check(Math.abs(meanY(barGlintD(100, 800, 0, 1000, 0.5, 14)) - meanY(barGlintD(100, 800, 0, 1000, 0.5, 4))) < 3
    && Math.min(...narrow.map(([, y]) => y)) >= Math.min(...wide.map(([, y]) => y)) - 0.05
    && Math.max(...narrow.map(([, y]) => y)) <= Math.max(...wide.map(([, y]) => y)) + 0.05,
  "shine: the glint's bands are one glint, the narrow inside the wide");
  // The thin streak trails the glint up the bar, on it, and off it at both ends.
  const trail = [0.2, 0.5, 0.8].map(p => barGlintD(100, 800, 0, 1000, p, 3, -12));
  check(trail.every((d, i) => d.startsWith("M") && onBar(d) && meanY(d) > meanY(barGlintD(100, 800, 0, 1000, [0.2, 0.5, 0.8][i], 5))),
    "shine: the trailing streak is on the bar, behind the glint");
  eq(barGlintD(100, 800, 0, 1000, 0.999, 3, -12), "", "shine: the trailing streak is past the top by the end");
  // A short bar takes the glint as well as a tall one.
  check(barGlintD(100, 30, 0, 1000, 0.5, 14).startsWith("M"), "shine: a short bar glints too");

  eq(blockGlintD([], 0, 40, 0.5, 9), "", "shine: no record block, no glint");
  const bAxis = { min: 0, max: 40 };
  const bTop = dotY(20, bAxis) + BLOCK_GAP;
  const bBottom = dotY(10, bAxis);
  const block = [0.2, 0.5, 0.8].map(p => blockGlintD([100, 10, 20], 0, 40, p, 14));
  check(block.every(d => d.startsWith("M") && pointsOf(d).every(([x, y]) =>
    x >= L - 0.05 && x <= R + 0.05 && y >= bTop - 0.05 && y <= bBottom + 0.05)), "shine: on a Sets block, the glint stays on the block");
  check(meanY(block[0]) > meanY(block[2]), "shine: and runs up it");

  eq(sparkleD(50, 50, 0, 0), "", "shine: a sparkle of no size draws nothing");
  const star = pointsOf(sparkleD(50, 50, 7, 0));
  check(star.length === 9 && star.every(([x, y]) => Math.hypot(x - 50, y - 50) <= 7.1)
    && star.filter(([x, y]) => Math.hypot(x - 50, y - 50) > 6.9).length === 5,
  "shine: a four-pointed sparkle, its points 7 out, drawn in to its middle between them");
}

// ── the exercise chart's % change ─────────────────────────────────────────────
// The header: the last dot against the first ("▲ 18% since 12 Sep"). A tapped
// dot: that session against the one before (user request, 2026-10-08).
{
  eq(fmtChange(18.2), { text: "18%", dir: "up" }, "change: whole from 10%");
  eq(fmtChange(2.54), { text: "2.5%", dir: "up" }, "change: one decimal under 10%");
  eq(fmtChange(2.0), { text: "2%", dir: "up" }, "change: no trailing .0");
  eq(fmtChange(-3.21), { text: "3.2%", dir: "down" }, "change: down, unsigned (the arrow says which way)");
  eq(fmtChange(0.04), { text: "0%", dir: "flat" }, "change: rounds to nothing, flat");
  eq(fmtChange(9.96), { text: "10%", dir: "up" }, "change: 9.96 reads as 10");
  eq(percentChange(0, 5), null, "change: nothing to measure from");

  const pt = (id: string, date: string, top: number, reps: number): ExerciseDataPoint => ({
    workoutId: id, date, completedAt: `${date}T10:00:00.000Z`, topWeight: top, topReps: reps,
    bestSetVolume: top * reps, bestSetWeight: top, bestSetReps: reps, e1rm: top * (1 + reps / 30), e1rmWeight: top, e1rmReps: reps,
    sessionVolume: top * reps, weightedSets: top > 0 ? 1 : 0, weightedReps: top > 0 ? reps : 0, totalReps: reps,
    sets: [{ weight: top, reps }],
  });
  const pts = [pt("a", "2026-09-12", 60, 8), pt("bw", "2026-09-15", 0, 10), pt("b", "2026-09-19", 62.5, 8), pt("c", "2026-09-26", 66, 8)];
  const change = chartChange(pts, "strength");
  approx(change?.pct ?? NaN, 10, "change: the last dot against the first (60 → 66 kg)");
  eq(change?.sinceYMD, "2026-09-12", "change: since the first dot's date");
  approx(chartChange(pts, "volume")?.pct ?? NaN, 10, "change: Volume, its last bar against its first");
  eq(chartChange(pts, "sets"), null, "change: Sets is how the sets went, no trend to put a number on");
  eq(chartChange([pts[0]], "strength"), null, "change: one dot, nothing to compare");
  eq(changeFromPrevious(pts, 0, "strength"), null, "change: the first session has none before it");
  eq(changeFromPrevious(pts, 1, "strength"), null, "change: a bodyweight session has nothing on Strength");
  approx(changeFromPrevious(pts, 2, "strength") ?? NaN, (62.5 - 60) / 60 * 100, "change: a session against the one before it, skipping the bodyweight one");

  // Each in its own slot: the bodyweight session keeps its number, empty.
  const g = exerciseChartGeometry(pts.length, 390);
  eq(strengthDots(pts, g, windowAxis(pts, "strength", 0, 3)!).map(d => d.slot), [0, 2, 3], "dots: one per session with weight, in its own slot");
  eq(volumeBars(pts, g, windowAxis(pts, "volume", 0, 3)!).map(b => b.slot), [0, 2, 3], "bars: likewise");
  eq(setStacks(pts, g, windowAxis(pts, "sets", 0, 3)!).map(s => s.slot), [0, 1, 2, 3], "stacks: every session, bodyweight included");
}

// ── the reps by each Strength dot ─────────────────────────────────────────────
// Over the dot as ever, but never on the line: a steep climb or drop ran the
// line through them (user report, 2026-10-13).
{
  type Ink = { l: number; t: number; r: number; b: number };
  const inkOf = (d: StrengthDot, p: ExerciseDataPoint): Ink => {
    const half = strengthLabelInkWidth(strengthLabel(p)) / 2;
    return { l: d.labelX - half, r: d.labelX + half, t: d.labelY - LABEL_INK_UP, b: d.labelY + LABEL_INK_DOWN };
  };
  // How near the line, edge to edge, comes to dot i's reps: walked along the
  // segments either side a quarter of a point at a time.
  const lineGap = (dots: StrengthDot[], i: number, ink: Ink): number => {
    let gap = Infinity;
    for (const n of [dots[i - 1], dots[i + 1]]) {
      if (!n) continue;
      const d = dots[i];
      const steps = Math.ceil(Math.hypot(n.x - d.x, n.y - d.y) * 4);
      for (let s = 0; s <= steps; s++) {
        const x = d.x + ((n.x - d.x) * s) / steps;
        const y = d.y + ((n.y - d.y) * s) / steps;
        gap = Math.min(gap, Math.hypot(Math.max(ink.l - x, 0, x - ink.r), Math.max(ink.t - y, 0, y - ink.b)) - LINE_STROKE / 2);
      }
    }
    return gap;
  };
  const chart = (weights: number[], reps: number[] = [], width = 390) => {
    const pts = sessionsOf(weights.map((w, i): [string, [number, number][]] => [dayOf(i), [[w, reps[i] ?? 8]]]));
    const g = exerciseChartGeometry(pts.length, width);
    const { first, last } = visibleSlots(g, pts.length, g.maxScrollX);
    return { pts, g, first, last, dots: strengthDots(pts, g, windowAxis(pts, "strength", first, last)!) };
  };
  const base = PLOT_TOP + CHART_HEIGHT;

  {
    const { dots } = chart([60, 60, 60, 60]);
    check(dots.every(d => d.labelX === d.x && d.labelY === d.y - 13), "reps: a flat run keeps every label right over its dot");
  }
  {
    const { pts, dots } = chart([60, 62.5, 65, 67.5, 70]);
    check(dots.every(d => d.labelX === d.x && d.labelY < d.y), "reps: a gentle climb keeps them over their dots");
    check(dots.every((d, i) => lineGap(dots, i, inkOf(d, pts[d.slot])) >= 1), "reps: and off the line");
  }
  {
    // A jump of 40 kg in a week: the line runs up steeply out of the third dot.
    const { pts, dots } = chart([60, 60, 60, 100, 100]);
    check(dots.every((d, i) => lineGap(dots, i, inkOf(d, pts[d.slot])) >= 1), "reps: a steep climb runs past every label, never through one");
    check(dots[2].labelY < dots[2].y, "reps: the one at the foot of the climb still sits over its dot's level");
    check(Math.abs(dots[2].labelX - dots[2].x) < 14 && Math.abs(dots[2].labelY - dots[2].y) < 18, "reps: and close by it");
  }
  {
    const { pts, dots } = chart([100, 100, 60, 60, 60]);
    check(dots.every((d, i) => lineGap(dots, i, inkOf(d, pts[d.slot])) >= 1), "reps: so does a steep drop");
  }
  {
    // A deload: down and straight back up. Over the low dot, both sides of
    // the V cross where its reps were; under it, nothing does.
    const { pts, dots } = chart([80, 80, 60, 80, 80]);
    check(dots[2].labelY > dots[2].y && dots[2].labelX === dots[2].x, "reps: in a dip, under the dot");
    check(lineGap(dots, 2, inkOf(dots[2], pts[2])) >= 1, "reps: clear of both sides of the dip");
  }
  {
    const { dots } = chart([60, 60, 80, 60, 60]);
    check(dots[2].labelX === dots[2].x && dots[2].labelY === dots[2].y - 13, "reps: a peak keeps its reps right over it");
  }
  {
    // A wider number needs more room: three figures on a steady climb.
    const { pts, dots } = chart([60, 65, 70, 75, 80], [12, 12, 12, 12, 12]);
    check(dots.every((d, i) => lineGap(dots, i, inkOf(d, pts[d.slot])) >= 1), "reps: ×12 on a climb, off the line too");
  }

  // Thousands of runs of sessions, every shape a lifter could log: every label
  // on screen clear of the line, of its dot and of the next label, inside the
  // chart, and beside its own dot.
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const problems: string[] = [];
  for (let run = 0; run < 4000 && problems.length < 5; run++) {
    const n = 2 + Math.floor(rand() * 14);
    let w = 40 + Math.round(rand() * 40) * 2.5;
    const weights: number[] = [];
    const reps: number[] = [];
    for (let i = 0; i < n; i++) {
      // Mostly small steps, now and then a jump or a deload.
      const r = rand();
      const step = r < 0.15 ? -Math.round(rand() * 12) * 2.5 : r < 0.3 ? Math.round(rand() * 12) * 2.5 : Math.round(rand() * 4 - 1.5) * 2.5;
      w = Math.max(5, w + (i === 0 ? 0 : step));
      weights.push(w);
      reps.push(1 + Math.floor(rand() * (rand() < 0.2 ? 30 : 12)));
    }
    const width = [320, 360, 375, 390, 414, 430][Math.floor(rand() * 6)];
    const { pts, g, first, last, dots } = chart(weights, reps, width);
    dots.forEach((d, i) => {
      if (d.slot < first || d.slot > last) return;
      const ink = inkOf(d, pts[d.slot]);
      const at = `${weights.join(",")} ×${reps.join(",")} on ${width}pt, session ${d.slot + 1}`;
      const gap = lineGap(dots, i, ink);
      const next = dots[i + 1] ? inkOf(dots[i + 1], pts[dots[i + 1].slot]) : null;
      if (gap < 1) problems.push(`${at}: its reps ${gap.toFixed(2)}pt from the line`);
      else if (Math.hypot(Math.max(ink.l - d.x, 0, d.x - ink.r), Math.max(ink.t - d.y, 0, d.y - ink.b)) < 4.5) problems.push(`${at}: its reps on its dot`);
      else if (next && ink.l < next.r && next.l < ink.r && ink.t < next.b && next.t < ink.b) problems.push(`${at}: its reps on the next session's`);
      else if (d.labelY - LABEL_H / 2 < 0 || d.labelY + LABEL_H / 2 > base || ink.l < 0 || ink.r > g.contentWidth) problems.push(`${at}: its reps outside the chart`);
      else if (Math.hypot(d.labelX - d.x, d.labelY - d.y) > 36) problems.push(`${at}: its reps ${Math.round(Math.hypot(d.labelX - d.x, d.labelY - d.y))}pt from its dot`);
    });
  }
  check(problems.length === 0, `reps: every shape of run keeps its labels clear\n      ${problems.join("\n      ")}`);
}

// ── The Exercise History page (utils/exerciseHistory.ts) ─────────────────────
// Each session's sets, its top set against the session before it (the oldest
// one listed against one outside the range), its trophies and its note.
{
  const on = (id: string, date: string, exercises: CompletedWorkout["exercises"]) => workout({ id, date, exercises });
  const warm = (weight: string, reps: string) => set(weight, reps, { type: "warmup" });
  const hist = [
    on("a", "2026-08-01", [ex("Bench", [set("90", "8")])]),
    on("b", "2026-10-02", [ex("Bench", [warm("60", "10"), set("95", "8"), set("92.5", "8")], "  Felt good ")]),
    on("c", "2026-10-06", [ex("Bench", [set("95", "8"), set("95", "7")])]),
    on("d", "2026-10-09", [ex("Bench", [set("95", "8"), set("97.5", "7")]), ex("Squat", [set("140", "5")]), ex("Bench", [set("100", "3")], "Back-off")]),
    on("e", "2026-10-13", [ex("Bench", [set("97.5", "6"), set("95", "")])]),
    on("f", "2026-10-16", [ex("Bench", [set("97.5", "8"), set("90", "4", { done: false })])]),
  ];
  const rows = exerciseHistoryRows(hist, [], { exerciseName: "Bench", days: 30, today: new Date(2026, 9, 20) });
  eq(rows.map(r => r.workoutId), ["f", "e", "d", "c", "b"], "history page: the range's sessions, newest first");
  eq(rows.map(r => r.sets.length), [1, 2, 3, 2, 3], "history page: done sets only, both times it was done in a day");
  eq(rows.map(r => r.top), [0, 0, 2, 0, 1], "history page: the top set is the heaviest with its reps in (a warm-up never)");
  eq(rows.map(r => r.change), [
    { kind: "reps", reps: 2 },
    { kind: "weight", kg: -2.5 },
    { kind: "weight", kg: 5 },
    { kind: "same" },
    { kind: "weight", kg: 5 },
  ], "history page: each top set against the session before it, the oldest listed against one out of range");
  eq(rows.map(r => r.prs), [[false], [false, false], [false, true, true], [false, false], [false, true, true]],
    "history page: a trophy on every set heavier than the best before it");
  eq(rows.map(r => r.notes), ["", "", "Back-off", "", "Felt good"], "history page: the note written on it, trimmed");
  eq(exerciseHistoryRows(hist, [], { exerciseName: "Bench", days: 365, today: new Date(2026, 9, 20) }).at(-1)?.change, null,
    "history page: the first session has nothing to compare with");

  const plank = (id: string, date: string, secs: string) => on(id, date, [{ ...ex("Plank", [set("", secs)]), isIsometric: true as const }]);
  const holds = exerciseHistoryRows([plank("p1", "2026-10-01", "60"), plank("p2", "2026-10-08", "75"), on("p0", "2026-09-20", [ex("Plank", [set("", "12")])])], [],
    { exerciseName: "Plank", days: 365, today: new Date(2026, 9, 20) });
  eq(holds.map(r => [r.isHold, r.change]), [[true, { kind: "reps", reps: 15 }], [true, null], [false, null]],
    "history page: a hold's seconds compare, but never with reps");

  const pullups = exerciseHistoryRows([
    on("u1", "2026-10-01", [ex("Pull-up", [set("", "8"), set("", "10")])]),
    on("u2", "2026-10-08", [ex("Pull-up", [set("", "11")])]),
    on("u3", "2026-10-15", [ex("Pull-up", [set("10", "5"), set("", "9")])]),
  ], [], { exerciseName: "Pull-up", days: 365, today: new Date(2026, 9, 20) });
  eq(pullups.map(r => [r.top, r.change]), [[0, { kind: "weight", kg: 10 }], [0, { kind: "reps", reps: 1 }], [1, null]],
    "history page: at bodyweight the most reps is the top set, and weight on it is a change of weight");

  // Typed in pounds, stored in kilos: the same typed weight is the same weight.
  const lb = (n: number) => String(n * 0.45359237);
  const pounds = exerciseHistoryRows([
    on("l1", "2026-10-01", [ex("Bench", [set(lb(225), "5")])]),
    on("l2", "2026-10-08", [ex("Bench", [set(lb(225), "5")])]),
  ], [], { exerciseName: "Bench", days: 365, today: new Date(2026, 9, 20) });
  eq(pounds[0].change, { kind: "same" }, "history page: the same weight typed in pounds is the same");
  const switched = exerciseHistoryRows([
    on("k1", "2026-10-01", [ex("Bench", [set("100", "5")])]),
    on("k2", "2026-10-08", [ex("Bench", [set(lb(220.5), "6")])]),
  ], [], { exerciseName: "Bench", days: 365, today: new Date(2026, 9, 20) });
  eq(switched[0].change, { kind: "reps", reps: 1 }, "history page: across a switch of unit, 220.5 lbs is 100 kg (never \"▲ 0 lbs\")");
}

// ── The Exercise History page's filter ───────────────────────────────────────
// What it offers, what each pick lists, how taps combine, and what it's called.
{
  const ppl = makeProgram({ id: "ppl", name: "Push Pull Legs", status: "active", cyclePattern: ["Push", "Pull", "Legs", "Rest"], dayIds: ["d0", "d1", "d2", "d3"] });
  const ul = makeProgram({ id: "ul", name: "Upper Lower", status: "completed", cyclePattern: ["Upper A", "Lower", "Upper B", "Rest"], dayIds: ["d0", "d1", "d2", "d3"] });
  const sb = makeProgram({ id: "sb", name: "Strength Block", status: "completed", cyclePattern: ["Heavy", "Rest"], dayIds: ["d0", "d1"] });
  const progs = [ul, ppl, sb];
  const on = (id: string, date: string, programId: string, dayId: string | undefined, workoutName: string, name = "Bench") =>
    workout({ id, date, programId, ...(dayId ? { dayId } : {}), workoutName, exercises: [ex(name, [set("100", "5")])] });
  const hist = [
    on("s1", "2026-06-01", "sb", "d0", "Heavy"),
    on("p0", "2026-07-01", "ppl", undefined, "Push"),
    on("u1", "2026-08-04", "ul", "d0", "Upper A"),
    on("u2", "2026-08-07", "ul", "d2", "Upper B"),
    on("u3", "2026-08-11", "ul", "d0", "Upper A"),
    on("g1", "2026-09-01", "gone", "d0", "Push"),
    on("p1", "2026-10-06", "ppl", "d0", "Push"),
    on("p2", "2026-10-09", "ppl", "d0", "Push"),
    on("p3", "2026-10-10", "ppl", "d1", "Pull", "Row"),
    on("f1", "2026-10-12", "", undefined, "Chest Day"),
  ];
  const options = exerciseHistoryOptions(hist, progs, { name: "Bench" });
  eq(options.programs.map(o => [o.name, o.active, o.days.map(d => d.name)]), [
    ["Push Pull Legs", true, []],
    ["Upper Lower", false, ["Upper A", "Upper B"]],
    ["Strength Block", false, []],
  ], "filter: programs that did it, the running one first, then the latest; days only for one done on more than one (a slotless \"Push\" is Push)");
  eq(options.free, true, "filter: free workouts (and a deleted program's) offered");

  const listed = (picks: HistoryPick[]) =>
    exerciseHistoryRows(hist, progs, { exerciseName: "Bench", picks, days: 365, today: new Date(2026, 9, 20) }).map(r => r.workoutId);
  const chart: HistoryPick = { kind: "day", programId: "ppl", dayId: "d0", dayName: "Push" };
  const upperB = options.programs[1].days[1].pick;
  eq(listed([]), ["f1", "p2", "p1", "g1", "u3", "u2", "u1", "p0", "s1"], "filter: nothing picked lists every session");
  eq(listed([chart]), ["p2", "p1", "p0"], "filter: the chart's day, as before");
  eq(listed([{ kind: "program", programId: "ul" }]), ["u3", "u2", "u1"], "filter: a program, every day of it");
  eq(listed([upperB]), ["u2"], "filter: one day of a program");
  eq(listed([{ kind: "free" }]), ["f1", "g1"], "filter: free workouts, and a gone program's");
  eq(listed([{ kind: "program", programId: "ppl" }, { kind: "free" }]), ["f1", "p2", "p1", "g1", "p0"], "filter: two picks list both");

  // Taps.
  const day = (programId: string, key: string): HistoryFilterItem => ({ kind: "day", programId, key });
  let picks: HistoryPick[] = [chart];
  check(isPicked(picks, { kind: "program", programId: "ppl" }, options), "filter: the chart's day of a one-day program shows as the program");
  eq(togglePick(picks, { kind: "program", programId: "ppl" }, options), [], "filter: ...and tapping it takes it off");
  picks = togglePick([], { kind: "program", programId: "ppl" }, options);
  picks = togglePick(picks, { kind: "free" }, options);
  picks = togglePick(picks, day("ul", "id:d0"), options);
  check(!isPicked(picks, { kind: "all" }, options) && !isPicked(picks, { kind: "program", programId: "ul" }, options),
    "filter: one day of two isn't the program");
  picks = togglePick(picks, day("ul", "id:d2"), options);
  eq(picks.filter(p => p.kind === "program"), [{ kind: "program", programId: "ppl" }, { kind: "program", programId: "ul" }],
    "filter: both days picked is the program");
  check(isPicked(picks, day("ul", "id:d0"), options), "filter: a whole program's days show picked");
  picks = togglePick(picks, day("ul", "id:d0"), options);
  eq(picks.filter(p => p.kind !== "free" && p.programId === "ul"), [upperB], "filter: a day off a whole program leaves its other");
  eq(togglePick(picks, { kind: "all" }, options), [], "filter: All programs clears the rest");

  eq([
    filterLabel([], options, progs),
    filterLabel([chart], options, progs),
    filterLabel([upperB], options, progs),
    filterLabel([{ kind: "program", programId: "ppl" }, { kind: "free" }], options, progs),
    pickLabel({ kind: "free" }, options, progs),
  // The sessions in no program go by the Progress page's name for them
  // (2026-10-23).
  ], ["All programs", "Push Pull Legs", "Upper Lower · Upper B", "Push Pull Legs + 1 more", "Custom workouts"], "filter: what it's called");

  // A cycle naming two days alike, and a custom workout added to a program.
  const twice = makeProgram({ id: "tw", name: "Twice", status: "active", cyclePattern: ["Upper", "Lower", "Upper", "Rest"], dayIds: ["d0", "d1", "d2", "d3"] });
  const twiceOptions = exerciseHistoryOptions([
    on("t1", "2026-10-01", "tw", "d0", "Upper"),
    on("t2", "2026-10-03", "tw", "d2", "Upper"),
    on("t3", "2026-10-04", "tw", undefined, "Arms"),
  ], [twice], { name: "Bench" });
  eq(twiceOptions.programs[0].days.map(d => d.name), ["Upper, day 1", "Upper, day 3", "Arms"],
    "filter: two days named alike say which, and a custom workout added to it is a day of its own");
}

// ── report ────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error("  ✗ " + f);
  throw new Error(`${failures.length} progress-stats assertion(s) failed`);
}
console.log("✓ progress-stats invariants hold");
