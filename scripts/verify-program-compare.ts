// scripts/verify-program-compare.ts
//
// Comparing two programs on the Progress page (utils/programCompare.ts) and the
// runs it reads (utils/programRuns.ts, kept by activateProgram): which runs can
// be compared, the program days and weeks things line up by, At a glance, the
// exercises both did, where a missed session sits among the ones done, and
// green against blue at the same point.
//
// Run: npx tsx scripts/verify-program-compare.ts

import type { CompletedExercise, CompletedWorkout, SavedProgram } from "../constants/programs";
import { activateProgram } from "../utils/programLifecycle";
import { endingRun, programRunViews, sameRun } from "../utils/programRuns";
import {
  aheadAtSamePoint, compareCandidates, compareLifts, compareReadiness, compareStartGreen, glanceStats, greenRunFor, liftChange, liftSlots, missedDates, type LiftSlot,
  muscleStatsPerWeek, programDayOf, runDates, runDays, runName, runStatus, runSummary, sessionsWithin, sharedStrength,
  spanCaption, spanDays, weekOfDay, weeklyTotals,
} from "../utils/programCompare";
import { compareOpenX, compareWindowAxis, missedBarValue, missedBars, missedRuns, strengthLine } from "../utils/compareChartLayout";
import { exerciseChartGeometry, slotX, visibleSlots } from "../utils/exerciseChartLayout";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}
const near = (a: number | null, b: number, what: string) => eq(a !== null && Math.abs(a - b) < 1e-6, true, `${what} (${a} ≈ ${b})`);

// ─── fixtures ────────────────────────────────────────────────────────────────
// Green: Push Pull Legs, a 7-day cycle, started Mon 14 Sep 2026, today Wed 14
// Oct (week 5). Push on Mondays, Legs on Wednesdays (missed 30 Sep), Pull on
// Fridays. Blue: Upper Lower, finished, 1 Jun to 26 Jul: Upper on Mondays,
// Lower on Tuesdays (missed 7 and 14 Jul, two in a row).

const TODAY = "2026-10-14";

const ex = (name: string, sets: [number, number][], over: Partial<CompletedExercise> = {}): CompletedExercise => ({
  name,
  notes: "",
  sets: sets.map(([w, r]) => ({ type: "working" as const, weight: w ? String(w) : "", reps: String(r), done: true })),
  ...over,
});

let seq = 0;
function session(programId: string, date: string, dayId: string, exercises: CompletedExercise[], over: Partial<CompletedWorkout> = {}): CompletedWorkout {
  seq += 1;
  return {
    id: `${programId}-${date}-${seq}`,
    date,
    completedAt: `${date}T08:00:00.000Z`,
    workoutName: dayId,
    durationSeconds: 3600,
    exercises,
    programId,
    dayId,
    ...over,
  };
}

const PPL: SavedProgram = {
  id: "PPL", name: "Push Pull Legs", totalWeeks: 8, currentWeek: 5, status: "active",
  startDate: "14 Sep 2026", trainingDays: 3, cycleDays: 7,
  cyclePattern: ["Push", "Rest", "Legs", "Rest", "Pull", "Rest", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  workouts: {
    "0:Push": [{ id: "e1", name: "Barbell Bench Press", sets: [] }],
    "2:Legs": [{ id: "e2", name: "Barbell Back Squat", sets: [] }],
    "4:Pull": [{ id: "e3", name: "Barbell Row", sets: [] }],
  },
} as unknown as SavedProgram;

const UL: SavedProgram = {
  id: "UL", name: "Upper Lower", totalWeeks: 8, currentWeek: 8, status: "completed",
  startDate: "01 Jun 2026", completedDate: "26 Jul 2026", trainingDays: 2, cycleDays: 7,
  cyclePattern: ["Upper", "Lower", "Rest", "Rest", "Rest", "Rest", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  workouts: {
    "0:Upper": [{ id: "u1", name: "Barbell Bench Press", sets: [] }],
    "1:Lower": [{ id: "l1", name: "Barbell Back Squat", sets: [] }],
  },
} as unknown as SavedProgram;

const pplBench = [80, 82.5, 82.5, 85, 87.5];
const pplPushDates = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
const pplSquat = [100, 102.5, 105, 107.5];
const pplLegsDates = ["2026-09-16", "2026-09-23", "2026-10-07", "2026-10-14"]; // 30 Sep missed
const pplRow = [70, 72.5, 72.5, 75];
const pplPullDates = ["2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09"];

const ulBench = [77.5, 80, 80, 82.5, 82.5, 85, 85, 87.5];
const ulUpperDates = ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20"];
const ulSquat = [97.5, 100, 102.5, 105, 105, 110];
const ulLowerDates = ["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23", "2026-06-30", "2026-07-21"]; // 7 and 14 Jul missed

const history: CompletedWorkout[] = [
  ...pplPushDates.map((d, i) => session("PPL", d, "d0", [ex("Barbell Bench Press", [[pplBench[i], 8], [pplBench[i], 8], [pplBench[i], 7]])])),
  ...pplLegsDates.map((d, i) => session("PPL", d, "d2", [ex("Barbell Back Squat", [[pplSquat[i], 5], [pplSquat[i], 5]])])),
  ...pplPullDates.map((d, i) => session("PPL", d, "d4", [ex("Barbell Row", [[pplRow[i], 8], [pplRow[i], 8]])])),
  ...ulUpperDates.map((d, i) => session("UL", d, "d0", [ex("Barbell Bench Press", [[ulBench[i], 8], [ulBench[i], 8], [ulBench[i], 8]])])),
  ...ulLowerDates.map((d, i) => session("UL", d, "d1", [ex("Barbell Back Squat", [[ulSquat[i], 5], [ulSquat[i], 5]])])),
];
const programs = [PPL, UL];

// ─── the two sides ───────────────────────────────────────────────────────────
const green = greenRunFor({ kind: "current" }, programs, history)!;
eq(green?.ref, { programId: "PPL", run: "latest" }, "green: the active program's latest run");
eq(greenRunFor({ kind: "all" }, programs, history)?.ref, { programId: "PPL", run: "latest" }, "All programs: the active program's");
{
  // Nothing on the go: the run that finished last is green, so two finished
  // programs can be compared.
  const shelvedPPL = { ...PPL, status: "paused" as const };
  eq(greenRunFor({ kind: "current" }, [shelvedPPL, UL], history)?.ref, { programId: "UL", run: "latest" },
    "nothing active: the run that finished last");
  const donePPL = { ...PPL, status: "completed" as const, completedDate: "14 Oct 2026" };
  const g = greenRunFor({ kind: "all" }, [donePPL, UL], history)!;
  eq(g.ref, { programId: "PPL", run: "latest" }, "two finished: the one that finished last is green");
  eq(compareCandidates([donePPL, UL], history, g.ref).map(c => c.ref.programId), ["UL"], "and the other is offered as blue");
}
{
  // The button is always there; what it needs before it compares
  // (compareReadiness), and green whenever both steps are done.
  const donePPL = { ...PPL, status: "completed" as const, completedDate: "14 Oct 2026" };
  const shelvedPPL = { ...PPL, status: "paused" as const };
  eq(compareReadiness([PPL], history), { finished: false, another: false }, "only a program on the go: nothing finished yet");
  eq(compareReadiness([], history), { finished: false, another: false }, "no programs: nothing finished");
  eq(compareReadiness([donePPL], history), { finished: true, another: false }, "one finished, nothing after it: start another");
  eq(compareReadiness([shelvedPPL, UL], history), { finished: true, another: false }, "a shelved program isn't another");
  eq(compareReadiness(programs, history), { finished: true, another: true }, "a finished one and one on the go: ready");
  eq(compareReadiness([donePPL, UL], history), { finished: true, another: true }, "two finished: ready");
  eq(compareReadiness([PPL, { ...UL, id: "empty" }], []), { finished: false, another: false },
    "a finished program with no sessions doesn't count");
  {
    // Run again: its earlier run is the finished one, the run on the go another.
    const run = endingRun({ ...PPL, status: "completed", completedDate: "11 Oct 2026" }, "12 Oct 2026")!;
    const again: SavedProgram = { ...PPL, startDate: "12 Oct 2026", runs: [run] };
    const r = compareReadiness([again], history);
    const g = compareStartGreen({ kind: "current" }, [again], history);
    eq(r.finished && r.another ? compareCandidates([again], history, g!.ref).length > 0 : "not ready", true,
      "the same program run again: ready, and its earlier run is offered");
  }
  // The picked program is the one finished: the current one takes green, so it
  // can go in blue.
  eq(greenRunFor({ kind: "program", programId: "UL" }, programs, history)?.ref, { programId: "UL", run: "latest" }, "picked: green as picked");
  const sg = compareStartGreen({ kind: "program", programId: "UL" }, programs, history)!;
  eq(sg.ref, { programId: "PPL", run: "latest" }, "picked the one finished program: the current one takes green");
  eq(compareCandidates(programs, history, sg.ref).map(c => c.ref.programId), ["UL"], "and the picked one is offered in blue");
  eq(compareStartGreen({ kind: "current" }, programs, history)?.ref, green.ref, "otherwise green is greenRunFor's");
}
const candidates = compareCandidates(programs, history, green.ref);
eq(candidates.map(c => c.ref), [{ programId: "UL", run: "latest" }], "blue: finished runs only, never green itself");
const blue = candidates[0];
eq([runName(green), runName(blue)], ["Push Pull Legs", "Upper Lower"], "names: a program with one run by its name alone");
eq(runStatus(green, TODAY), "Week 5 of 8", "green's status: its week");
eq(runStatus(blue, TODAY), "Finished 26 Jul", "blue's status: when it finished");
eq(runSummary(blue, TODAY), "Finished 26 Jul · 8 weeks · 14 workouts", "the picker's line for a finished run");
eq([
  runDates(blue, TODAY),
  runDates({ ...blue, startYMD: "2025-03-03", endYMD: "2025-05-25" }, TODAY),
  runDates({ ...blue, startYMD: "2025-11-03", endYMD: "2026-01-26" }, TODAY),
  runDates({ ...blue, startYMD: "2026-07-26", endYMD: "2026-07-26" }, TODAY),
], ["1 Jun – 26 Jul", "3 Mar – 25 May 2025", "3 Nov 2025 – 26 Jan 2026", "26 Jul"],
"when a finished run ran: the year once when it isn't this one, on each date across two");
eq(blue.sessions.length, 14, "blue's sessions are its own");

// ─── program days and weeks ──────────────────────────────────────────────────
eq([programDayOf(PPL, "2026-09-14"), programDayOf(PPL, "2026-09-20"), programDayOf(PPL, "2026-09-21"), programDayOf(PPL, "2026-09-13")],
  [1, 7, 8, null], "program days count from 1 on the day the run began");
eq([weekOfDay(1), weekOfDay(7), weekOfDay(8), weekOfDay(31)], [1, 1, 2, 5], "seven days a week");
{
  const pushed = { ...PPL, startDate: "07 Sep 2026", skippedDates: ["2026-09-09"], pushedDates: ["2026-09-09"] };
  eq([programDayOf(pushed, "2026-09-09"), programDayOf(pushed, "2026-09-10")], [3, 3], "a pushed day holds the program still");
  const held = {
    ...PPL, startDate: "10 Sep 2026",
    holds: [{ from: "2026-09-10", to: "2026-09-13", shift: 3, offsetShift: 0 }],
  };
  eq([programDayOf(held, "2026-09-08"), programDayOf(held, "2026-09-13"), programDayOf(held, "2026-09-14")], [2, 4, 5],
    "days held don't count: a date before the hold reads as it stood then");
}
eq([runDays(green, TODAY), runDays(blue, TODAY)], [31, 56], "how far each has run");
eq(spanDays(green, blue, "same", TODAY), { green: 31, blue: 31 }, "same point: the first days of each, as many as the shorter has run");
eq(spanDays(green, blue, "whole", TODAY), { green: 31, blue: 56 }, "whole program: each as far as it went");
eq(sessionsWithin(blue, 31).length, 10, "blue's first 31 days hold ten sessions");

// ─── what At a glance says it reads ──────────────────────────────────────────
eq(spanCaption(green, blue, "same", TODAY),
  "First 5 weeks of the current Push Pull Legs program, against the first 5 weeks of Upper Lower",
  "same point: both programs named, the current one as current");
eq(spanCaption(green, blue, "whole", TODAY),
  "All 5 weeks of the current Push Pull Legs program so far, against all 8 weeks of Upper Lower",
  "whole program: each to its end, the current one so far");
{
  const named = greenRunFor({ kind: "current" }, [{ ...PPL, name: "Strength Program" }, UL], history)!;
  eq(spanCaption(named, blue, "same", TODAY).startsWith("First 5 weeks of the current Strength Program,"), true,
    "a name already ending in \"program\" isn't given a second");
  // Green finished too, and the shorter of the two: read to its end.
  const done = { ...PPL, status: "completed" as const, completedDate: "14 Oct 2026" };
  const pplDone = programRunViews(done, history).find(v => v.ref.run === "latest")!;
  const ulRun = programRunViews(UL, history).find(v => v.ref.run === "latest")!;
  eq(spanCaption(pplDone, ulRun, "same", TODAY),
    "All 5 weeks of Push Pull Legs, against the first 5 weeks of Upper Lower", "a finished green read to its end says all");
  eq(spanCaption(ulRun, pplDone, "same", TODAY),
    "First 5 weeks of Upper Lower, against all 5 weeks of Push Pull Legs", "a shorter blue read to its end says all");
}

// ─── At a glance, volume, the radar ──────────────────────────────────────────
{
  const g = glanceStats(green, 31, history, TODAY);
  eq([g.workoutsDone, g.workoutsPlanned], [13, 14], "green: 13 of 14, the missed Wednesday counted");
  const b = glanceStats(blue, 31, history, TODAY);
  eq([b.workoutsDone, b.workoutsPlanned], [10, 10], "blue's first 31 days: 10 of 10");
  const bw = glanceStats(blue, 56, history, TODAY);
  eq([bw.workoutsDone, bw.workoutsPlanned], [14, 16], "blue whole: 14 of 16, the two missed Tuesdays counted");
  eq(g.avgSessionSeconds, 3600, "average session length");
  eq(b.prs, 5, "blue's PRs in its first 31 days: each new heaviest (bench 80 and 82.5, squat 100, 102.5 and 105)");
  near(b.setsPerWeek, (10 * 3 - 5 * 1) / (31 / 7), "sets per week over the span");
}
{
  const weeks = weeklyTotals(green, 31, "volume");
  eq(weeks.length, 5, "a total for each of green's five weeks");
  near(weeks[0], 80 * 23 + 100 * 10 + 70 * 16, "week 1's volume: that week's three sessions");
  eq(weeklyTotals(blue, 56, "volume").length, 8, "blue whole: eight weeks");
  const radar = muscleStatsPerWeek(blue, 56, []);
  near(radar.Chest.sets, 24 / 8, "the radar per program week: blue's 24 chest sets over 8 weeks");
}

// ─── exercises ───────────────────────────────────────────────────────────────
const lifts = compareLifts(green, blue);
eq(lifts.both.map(l => l.name), ["Barbell Bench Press", "Barbell Back Squat"], "in both, in the order green first did them");
eq(lifts.onlyGreen.map(l => l.name), ["Bent-Over Row"], "only in green, by the name the library calls it now");
eq(lifts.onlyBlue.map(l => l.name), [], "only in blue: none");
const bench = lifts.both[0];
const squat = lifts.both[1];
eq([bench.green.length, bench.blue.length, squat.green.length, squat.blue.length], [5, 8, 4, 6], "sessions done of each");
{
  // A lift by a name the library has since renamed still matches.
  const renamedGreen = { ...green, sessions: [session("PPL", "2026-09-15", "d0", [ex("Dumbbell Lateral Raise", [[8, 12]])])] };
  const renamedBlue = { ...blue, sessions: [session("UL", "2026-06-03", "d0", [ex("Lateral Raise", [[7, 12]])])] };
  eq(compareLifts(renamedGreen, renamedBlue).both.length, 1, "a renamed exercise matches its new name");
}

// ─── a missed session keeps its place ────────────────────────────────────────
eq(missedDates(green, "Barbell Back Squat", squat.green, TODAY), ["2026-09-30"],
  "green missed one squat session, the Legs day of 30 Sep; today's is done");
eq(missedDates(blue, "Barbell Back Squat", squat.blue, TODAY), ["2026-07-07", "2026-07-14"], "blue missed two in a row");
eq(missedDates(green, "Barbell Bench Press", bench.green, TODAY), [], "nothing missed");
const sqG = liftSlots(squat.green, missedDates(green, "Barbell Back Squat", squat.green, TODAY));
const sqB = liftSlots(squat.blue, missedDates(blue, "Barbell Back Squat", squat.blue, TODAY));
eq(sqG.map(s => (s.point ? s.point.date : `missed ${s.missed}`)), ["2026-09-16", "2026-09-23", "missed 2026-09-30", "2026-10-07", "2026-10-14"],
  "green's row: every time it came round, the one missed in its own place, the 3rd");
eq(sqB.map(s => (s.point ? "done" : "missed")), ["done", "done", "done", "done", "done", "missed", "missed", "done"],
  "blue's row: two missed in a row are its 6th and 7th, and the session after is its 8th");
{
  // Today's Legs not done yet: not missed.
  const noToday = history.filter(w => !(w.programId === "PPL" && w.date === TODAY));
  const g2 = greenRunFor({ kind: "current" }, programs, noToday)!;
  const sq = compareLifts(g2, blue).both[1];
  eq(missedDates(g2, "Barbell Back Squat", sq.green, TODAY), ["2026-09-30"], "today's session not done yet isn't missed");
  // A Legs session done without the squat while it was planned: missed. Done
  // without it when the day's plan didn't have it: not missed.
  const without = (plan: boolean) => [
    ...noToday.filter(w => !(w.programId === "PPL" && w.date === "2026-10-07")),
    session("PPL", "2026-10-07", "d2", [ex("Leg Press", [[150, 10]])], plan
      ? { plan: [{ id: "e2", name: "Barbell Back Squat" }] }
      : { plan: [{ id: "e9", name: "Leg Press" }] }),
  ];
  const g3 = greenRunFor({ kind: "current" }, programs, without(true))!;
  const sq3 = compareLifts(g3, blue).both[1];
  eq(missedDates(g3, "Barbell Back Squat", sq3.green, TODAY), ["2026-09-30", "2026-10-07"], "trained without it while it was planned: missed");
  const g4 = greenRunFor({ kind: "current" }, programs, without(false))!;
  const sq4 = compareLifts(g4, blue).both[1];
  eq(missedDates(g4, "Barbell Back Squat", sq4.green, TODAY), ["2026-09-30"], "trained without it when the day didn't plan it: not missed");
  // Swapped out, before plans were saved: still missed.
  const swapped = [
    ...noToday.filter(w => !(w.programId === "PPL" && w.date === "2026-10-07")),
    session("PPL", "2026-10-07", "d2", [ex("Hack Squat", [[120, 8]], { swappedFrom: "Barbell Back Squat" })]),
  ];
  const g5 = greenRunFor({ kind: "current" }, programs, swapped)!;
  const sq5 = compareLifts(g5, blue).both[1];
  eq(missedDates(g5, "Barbell Back Squat", sq5.green, TODAY), ["2026-09-30", "2026-10-07"], "swapped for something else: missed");
  // Done that day anyway, in another session: not missed, the session stands
  // in its place instead.
  const instead = [...history, session("PPL", "2026-09-30", "d0", [ex("Barbell Back Squat", [[102.5, 5]])])];
  const g6 = greenRunFor({ kind: "current" }, programs, instead)!;
  const sq6 = compareLifts(g6, blue).both[1];
  eq(missedDates(g6, "Barbell Back Squat", sq6.green, TODAY), [], "done on its day in another session: not missed");
}

// ─── green against blue ──────────────────────────────────────────────────────
{
  const benchG = liftSlots(bench.green, missedDates(green, "Barbell Bench Press", bench.green, TODAY));
  const benchB = liftSlots(bench.blue, missedDates(blue, "Barbell Bench Press", bench.blue, TODAY));
  eq(aheadAtSamePoint(benchG, benchB), { session: 5, diff: 5, by: "weight" }, "5th session: 5 kg ahead");
  eq(aheadAtSamePoint(sqG, sqB), { session: 5, diff: 2.5, by: "weight" }, "5th session, the missed one counted: 107.5 against 105");
  eq(aheadAtSamePoint(sqG.slice(0, 3), sqB), { session: 2, diff: 2.5, by: "weight" }, "green missed its latest: the latest place both did");
  const bw = (reps: number) => ({ point: { ...bench.green[0], topWeight: 0, sets: [{ weight: 0, reps }] } });
  eq(aheadAtSamePoint([bw(10)], [bw(12)]), { session: 1, diff: -2, by: "reps" }, "at bodyweight: by reps, behind");
}
near(liftChange(bench.green), (87.5 / 80 - 1) * 100, "green's bench, first to last");
{
  const same = sharedStrength(lifts.both, "same");
  near(same.green, ((87.5 / 80 - 1) * 100 + (107.5 / 100 - 1) * 100) / 2, "shared lifts, same point: green");
  near(same.blue, ((82.5 / 77.5 - 1) * 100 + (105 / 97.5 - 1) * 100) / 2, "shared lifts, same point: blue at as many sessions");
  const whole = sharedStrength(lifts.both, "whole");
  near(whole.blue, ((87.5 / 77.5 - 1) * 100 + (110 / 97.5 - 1) * 100) / 2, "shared lifts, whole program: blue over all of its own");
}

// ─── runs ────────────────────────────────────────────────────────────────────
{
  // Upper Lower run again: its finished run is kept, and the program starts over.
  const { programs: next } = activateProgram([{ ...PPL, status: "paused", currentWeek: 5 }, UL], "UL", "15 Oct 2026");
  const ul = next.find(p => p.id === "UL")!;
  eq(ul.runs?.length, 1, "making a finished program active again keeps its run");
  eq(ul.runs?.[0] && { start: ul.runs[0].startDate, status: ul.runs[0].status, end: ul.runs[0].endDate, week: ul.runs[0].currentWeek },
    { start: "01 Jun 2026", status: "completed", end: "2026-07-26", week: 8 }, "the run as it ended");
  eq([ul.status, ul.startDate, ul.completedDate, ul.currentWeek], ["active", "15 Oct 2026", undefined, 1], "the program starts over");
  const views = programRunViews(ul, history);
  eq(views.map(v => [v.ref.run, v.number, v.sessions.length, v.finished]), [[0, 1, 14, true], ["latest", 2, 0, false]],
    "two runs, numbered, each with its own sessions");
  eq(runName(views[0]), "Upper Lower, 1st run", "an earlier run by its number");
  eq(compareCandidates(next, history, views[1].ref).map(c => runName(c)), ["Upper Lower, 1st run"],
    "a program's own earlier run can be compared with");
  eq(sameRun(views[0].ref, { programId: "UL", run: 0 }), true, "runs are told apart by their place");
  eq(spanCaption(views[1], views[0], "same", TODAY),
    "First week of the current Upper Lower program, against the first week of its 1st run",
    "a program against its own earlier run: \"its\", and one week said as one");

  // Run a third time: runs accumulate, oldest first.
  const { programs: third } = activateProgram(
    next.map(p => (p.id === "UL" ? { ...p, status: "completed" as const, completedDate: "10 Dec 2026", currentWeek: 8 } : p)),
    "UL",
    "11 Dec 2026",
  );
  eq(third.find(p => p.id === "UL")!.runs?.map(r => r.endDate), ["2026-07-26", "2026-12-10"], "every earlier run, oldest first");

  // A shelved run is kept too, ending the day before it starts again; it
  // isn't offered to compare with (only finished ones are).
  const shelved = activateProgram([{ ...PPL, status: "paused", currentWeek: 3, holds: [{ from: "2026-09-25", to: "2026-09-27", shift: 2, offsetShift: 0 }] }], "PPL", "20 Oct 2026").programs[0];
  eq(shelved.runs?.[0] && [shelved.runs[0].status, shelved.runs[0].endDate, shelved.runs[0].holds?.length], ["paused", "2026-10-19", 1],
    "a shelved run ends the day before the new one, its holds with it");
  eq(compareCandidates([shelved], history, null).length, 0, "a shelved run isn't offered");

  // A run that came back from a hold: its startDate moved on by the days
  // held, but its sessions from before the hold are still that run's.
  const held: SavedProgram = { ...UL, startDate: "04 Jun 2026", holds: [{ from: "2026-06-10", to: "2026-06-13", shift: 3, offsetShift: 0 }] };
  const reheld = programRunViews(activateProgram([held], "UL", "15 Oct 2026").programs[0], history);
  eq(reheld.map(v => v.ref.run), [0, "latest"], "a held run's days before its hold aren't read as an earlier run");
  eq([reheld[0].startYMD, reheld[0].sessions.length], ["2026-06-01", 14], "the run began on its first day, with all its sessions");

  // Never started: nothing to keep.
  const fresh = activateProgram([{ ...UL, status: "created", completedDate: undefined }], "UL", "15 Oct 2026").programs[0];
  eq(fresh.runs, undefined, "a program never run keeps no run");
}
{
  // Run again before runs were kept: its older sessions are one earlier run.
  const rerun: SavedProgram = { ...UL, status: "active", startDate: "05 Oct 2026", completedDate: "26 Jul 2026", currentWeek: 2 };
  const views = programRunViews(rerun, history);
  eq(views.map(v => v.ref.run), ["earlier", "latest"], "the sessions from before its run read as an earlier run");
  eq([runName(views[0]), views[0].sessions.length, views[0].finished], ["Upper Lower, earlier run", 14, true], "named, with its sessions");
  eq(missedDates(views[0], "Barbell Back Squat", compareLifts(views[0], views[0]).both[1].blue, TODAY), [],
    "an earlier run has no schedule to miss sessions on");
}

// ─── the chart's layout ──────────────────────────────────────────────────────
{
  const n = Math.max(sqG.length, sqB.length);
  const g = exerciseChartGeometry(n, 390);
  const axis = compareWindowAxis(sqG, sqB, "strength", 0, n - 1)!;
  const values = [...squat.green, ...squat.blue].map(p => p.topWeight);
  eq(values.every(v => v >= axis.min && v <= axis.max), true, "the axis holds both programs' sessions on screen");
  const line = strengthLine(sqG, g);
  eq([line.solid.length / 4, line.dotted.length / 4], [2, 1], "green's squat: solid between sessions, dotted through the one it missed");
  eq(line.dotted[0] === slotX(g, 1) && line.dotted[2] === slotX(g, 3), true,
    "the dotted stretch runs from its 2nd session, through its missed 3rd, to its 4th");
  eq([line.missedXs, line.missedVs], [[slotX(g, 2)], [103.75]],
    "the missed 3rd is an empty circle on the dotted line, where it passes between 102.5 and 105");
  {
    // Missed the 1st and the 4th: an empty circle at each, level with the
    // session beside it, the line dotted out to it, never to nothing.
    const p80 = { point: { ...squat.green[0], topWeight: 80 } };
    const edges = strengthLine([{ missed: "2026-09-02" }, p80, p80, { missed: "2026-09-23" }], exerciseChartGeometry(4, 390));
    const g4 = exerciseChartGeometry(4, 390);
    eq([edges.solid.length / 4, edges.dotted.length / 4], [1, 2], "solid between the two sessions, dotted out to each miss");
    eq([edges.missedXs, edges.missedVs], [[slotX(g4, 0), slotX(g4, 3)], [80, 80]], "an empty circle at the 1st and 4th, level with the sessions beside them");
    eq(edges.dotted.slice(0, 4), [slotX(g4, 0), 80, slotX(g4, 1), 80], "the 1st's dotted line runs from its circle to the 2nd session");
    const lone = strengthLine([{ missed: "2026-09-02" }, p80], exerciseChartGeometry(2, 390));
    eq([lone.solid.length, lone.dotted.length / 4, lone.missedXs.length], [0, 1, 1], "missed the 1st, did the 2nd: a circle, a dotted line, the dot");
  }
  const runs = missedRuns(sqG, sqB, g);
  eq(runs.map(r => [r.side, r.slots, r.label]), [["green", [2], "Missed"], ["blue", [5, 6], "2 missed"]],
    "one word over each run of misses, over its own numbered places");
  eq(runs[1].x, (slotX(g, 5) + slotX(g, 6)) / 2, "a run's word sits over the middle of its places");
  // Sets and Volume: an empty bar in each missed place, as tall as the session before.
  const bars = missedBars(sqB, "volume", 0, g);
  eq(bars.xs, [slotX(g, 5), slotX(g, 6)], "blue's empty bars stand in its 6th and 7th places");
  eq(bars.vs, [squat.blue[4].sessionVolume, squat.blue[4].sessionVolume], "each as tall as its session before");
  eq(missedBarValue(liftSlots(squat.green, ["2026-09-01"]), 0, "volume"), squat.green[0].sessionVolume,
    "one missed before the first stands as tall as the session after it");
  const onlyEmpty = compareWindowAxis(sqG, sqB, "volume", 5, 6);
  eq(onlyEmpty !== null && onlyEmpty.max >= squat.blue[4].sessionVolume, true, "a screen of only empty bars still has an axis to stand them on");
  {
    // The canvas's Hack Squat: green missed its 2nd and 3rd, blue its 3rd, so
    // the 3rd is missed by both and both halves of it are empty.
    const pt = (v: number) => ({ point: { ...squat.green[0], topWeight: v, sessionVolume: v * 24 } });
    const gh: LiftSlot[] = [pt(100), { missed: "2026-09-21" }, { missed: "2026-09-28" }, pt(105), pt(107.5)];
    const bh: LiftSlot[] = [pt(95), pt(100), { missed: "2026-06-15" }, pt(100), pt(102.5)];
    const g5 = exerciseChartGeometry(5, 390);
    eq(missedRuns(gh, bh, g5).map(r => [r.side, r.slots, r.label]), [["green", [1, 2], "2 missed"], ["blue", [2], "Missed"]],
      "both programs' runs, the 3rd in both");
    eq([missedBars(gh, "volume", 0, g5).xs, missedBars(bh, "volume", 0, g5).xs], [[slotX(g5, 1), slotX(g5, 2)], [slotX(g5, 2)]],
      "missed by both: an empty bar in each half of the 3rd");
    eq(missedBars(gh, "volume", 0, g5).vs, [2400, 2400], "green's two, each as tall as its 1st, the session before them");
    eq(aheadAtSamePoint(gh, bh), { session: 5, diff: 5, by: "weight" }, "5th session: 5 kg ahead, the latest place both did");
  }
  const long = exerciseChartGeometry(12, 390);
  const open = compareOpenX(long, 5, 12);
  const win = visibleSlots(long, 12, open);
  eq(win.first <= 4 && win.last >= 5, true, "it opens on green's latest session, with the next slot beside it");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ program comparison invariants hold");
