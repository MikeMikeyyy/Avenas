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
  workoutMatchesDay,
  collectLoggedExercisesForDay,
  sessionCountForDay,
} from "../utils/progressStats";
import { historicalDays, markDayRefLabels, programDays, programDaysWithExtras } from "../utils/programDays";
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
}
{
  // A session with only BW (zero-volume) sets is excluded (sessionVolume === 0).
  const hist = [workout({ id: "bw", exercises: [ex("Pullups", [set("BW", "10")])] })];
  eq(collectExerciseHistory(hist, "Pullups"), [], "exHistory: zero-volume session excluded");
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
  // best session volume = 1020 in p1
  eq(prs.bestSessionVolume?.value, 1020, "PR bestSessionVolume: max session tonnage");
  // 1RM walks raw sets: epley(100,5)=116.67 beats epley(90,8)=114 and epley(100,3)=110
  approx(prs.oneRepMax!.value, 100 * (1 + 5 / 30), "PR 1RM: Epley picks the best single set across sessions");
  eq(prs.oneRepMax?.weight, 100, "PR 1RM: source set weight");
  eq(prs.oneRepMax?.reps, 5, "PR 1RM: source set reps");
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

  // Sessions whose program is gone don't conjure a row.
  eq(scopedProgramDays({ kind: "all" }, [], history).length, 0, "edit: a deleted program's sessions produce no historical row");
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

// ── report ────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error("  ✗ " + f);
  throw new Error(`${failures.length} progress-stats assertion(s) failed`);
}
console.log("✓ progress-stats invariants hold");
