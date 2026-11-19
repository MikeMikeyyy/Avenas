// When a program made active starts (utils/programStart.ts; user request,
// 2026-11-16: "I want to be able to plan it to start on a specific date,
// whether that be the coming monday or week after monday etc. the days in
// between wont be missed days, but rest days so they can show up light grey on
// the home calendar page", and "it should not replace the previous program's
// workout day if we have completed a workout day").
//
//   1. The starts offered, every day of the week: never today once a workout
//      is logged today.
//   2. The user's Friday: an old program finished that day, a new one made
//      active from Monday. The days between schedule nothing, are rest on
//      Home's calendar and the Journal's before and after they go by (a
//      workout done in one anyway shows as one), can't cost the streak, don't
//      hold the program for being idle, and its week is 0 till Monday, day 1
//      then. Progress keeps the finished one as current until then.
//   3. Let go before it began (replaced, made inactive): back to "created",
//      never finished (a one-week one earned the achievement), its start kept,
//      its marks gone. Made active again after a workout today, the run it ends
//      keeps that workout.
//   4. Change Start Date, and the words ("Starts Mon 23 Nov", the replace
//      prompt, Compare's run status).
//
// Run:  npx tsx scripts/verify-program-start.ts
// Exits non-zero if any assertion fails.

import { getCurrentWeek, programFinishDate, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import {
  earliestStart, latestStart, replaceMessage, restBeforeStart, startDay, startOptions, startsLabel, startsLater, storedStart, withStartDate,
} from "../utils/programStart";
import { activateProgram, deactivateProgram, minTotalWeeks } from "../utils/programLifecycle";
import { getWorkoutForDate } from "../utils/workout";
import { calendarWeeks, homeMonthCells, pastPlanFrom } from "../utils/journalCalendar";
import { isStreakRiskDay } from "../utils/streak";
import { idleDays } from "../utils/programHolds";
import { buildWeekSchedule } from "../utils/weekSchedule";
import { currentScopeProgram } from "../utils/progressStats";
import { programRunViews } from "../utils/programRuns";
import { runStatus } from "../utils/programCompare";
import { addDaysYMD, toYMD } from "../utils/dates";

declare const process: { exit(code: number): never };

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const at = (ymd: string) => new Date(`${ymd}T12:00:00`);

const FRI = "2026-11-20", SAT = "2026-11-21", SUN = "2026-11-22", MON = "2026-11-23", NEXT_MON = "2026-11-30";

// ─── 1. The starts offered ─────────────────────────────────────────────────
{
  const keys = (today: string, trained: boolean) =>
    startOptions(today, trained ? [{ date: today }] : []).map(o => `${o.key} ${o.ymd}`);
  eq(keys(FRI, false), [`today ${FRI}`, `tomorrow ${SAT}`, `monday ${MON}`, `mondayAfter ${NEXT_MON}`], "options: a Friday, nothing logged");
  eq(keys(FRI, true), [`tomorrow ${SAT}`, `monday ${MON}`, `mondayAfter ${NEXT_MON}`], "options: a Friday already trained: never today");
  eq(keys(SUN, false), [`today ${SUN}`, `tomorrow ${MON}`, `mondayAfter ${NEXT_MON}`], "options: a Sunday, the coming Monday is tomorrow, so once");
  eq(keys(MON, false), [`today ${MON}`, `tomorrow 2026-11-24`, `monday ${NEXT_MON}`, `mondayAfter 2026-12-07`], "options: a Monday, the coming Monday is next week's");
  eq(startOptions(FRI, []).map(o => o.label), ["Today", "Tomorrow", "The Coming Monday", "The Monday After"], "options: their words");
  eq([earliestStart(FRI, []), earliestStart(FRI, [{ date: FRI }]), earliestStart(FRI, [{ date: "2026-11-19" }])], [FRI, SAT, FRI],
    "earliest: today, or tomorrow once today's trained (a workout yesterday doesn't count)");
  eq(latestStart(FRI), addDaysYMD(FRI, 91), "latest: about three months ahead");
  eq([startsLabel(MON), startDay(MON, FRI), storedStart(MON)], ["Starts Mon 23 Nov", "Monday 23 November", "23 Nov 2026"], "words: the start");
}

// ─── 2. The user's Friday ───────────────────────────────────────────────────
const OLD: SavedProgram = {
  id: "old", name: "Old Program", totalWeeks: 2, currentWeek: 2, status: "completed", completedDate: "20 Nov 2026",
  startDate: "07 Nov 2026", trainingDays: 2, cycleDays: 3, cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["o0", "o1", "o2"], workouts: {},
};
const NEW: SavedProgram = {
  id: "new", name: "New Program", totalWeeks: 4, currentWeek: 0, status: "created",
  startDate: "15 Nov 2026", trainingDays: 2, cycleDays: 3, cyclePattern: ["Push", "Pull", "Rest"], dayIds: ["n0", "n1", "n2"], workouts: {},
};
const FRIDAY_SESSION: CompletedWorkout = {
  id: "workout_1", date: FRI, completedAt: `${FRI}T08:00:00.000Z`, workoutName: "Lower", programId: "old", dayId: "o1", durationSeconds: 3600, exercises: [],
};
{
  const history = [FRIDAY_SESSION];
  eq(startOptions(FRI, history).some(o => o.key === "today"), false, "friday: trained, so it can't start today");
  const { programs, finished } = activateProgram([OLD, NEW], "new", "20 Nov 2026", history, storedStart(MON));
  const p = programs.find(x => x.id === "new")!;
  eq([p.status, p.startDate, finished], ["active", "23 Nov 2026", null], "friday: made active from Monday");
  eq(programs.find(x => x.id === "old"), OLD, "friday: the finished one as it was");
  eq([startsLater(p, FRI), startsLater(p, MON), startsLater(OLD, FRI)], [MON, null, null], "friday: it starts later until Monday");
  eq([getCurrentWeek(p, at(FRI)), getCurrentWeek(p, at(SUN)), getCurrentWeek(p, at(MON)), minTotalWeeks(p, at(FRI))], [0, 0, 1, 1], "friday: week 0 till Monday");
  eq([FRI, SAT, SUN, MON, "2026-11-24", "2026-11-25"].map(d => getWorkoutForDate(p, d)?.name ?? "rest"),
    ["rest", "rest", "rest", "Push", "Pull", "rest"], "friday: nothing before Monday, day 1 on Monday");
  eq(toYMD(programFinishDate(p)!), "2026-12-20", "friday: its four weeks run from Monday");
  eq([SAT, SUN, MON].map(d => isStreakRiskDay(p, d)), [false, false, true], "friday: no streak to lose before it starts");
  eq([idleDays(p, [FRI], SUN), idleDays(p, [FRI], "2026-11-30")], [0, 7], "friday: not idle before it starts; counted from its start after");
  // Progress keeps the finished one as Current program past the new one's
  // first day, until a workout's logged in it (user request, 2026-11-19).
  eq([currentScopeProgram(programs, history, SUN)?.id, currentScopeProgram(programs, history, MON)?.id], ["old", "old"],
    "friday: Progress keeps the finished one as current while nothing's logged in the new one");
  const mondaySession: CompletedWorkout = { ...FRIDAY_SESSION, id: "workout_2", date: MON, completedAt: `${MON}T08:00:00.000Z`, workoutName: "Push", programId: "new", dayId: undefined };
  eq(currentScopeProgram(programs, [...history, mondaySession], MON)?.id, "new", "friday: the new one's first workout makes it current");
  eq(currentScopeProgram([NEW, { ...p, id: "solo" }].filter(x => x.status === "active"), history, SUN)?.id, "solo", "friday: with none finished, the new one");

  // Home's calendar and the Journal's: the days between are rest, before and after.
  const dates = new Set([FRI]);
  const plan = pastPlanFrom(programs, history);
  const homeOn = (today: string, ymd: string, done = dates) => {
    const cells = homeMonthCells(2026, 10, today, done, p, plan);
    return cells[(new Date(2026, 10, 1).getDay() + 6) % 7 + Number(ymd.slice(8)) - 1];
  };
  const journalOn = (today: string, ymd: string, done = dates) =>
    calendarWeeks(2026, 10, today, done, p, plan).flatMap(w => w.days).find(d => d?.date === ymd)?.state;
  eq([homeOn(FRI, FRI), homeOn(FRI, SAT), homeOn(FRI, SUN), homeOn(FRI, MON), homeOn(FRI, "2026-11-24")],
    ["todayWorkout", "rest", "rest", "future", "future"], "home: Friday trained, the weekend rest, Monday on still to come");
  eq([journalOn(FRI, SAT), journalOn(FRI, SUN), journalOn(FRI, MON)], ["rest", "rest", "future"], "journal: the same");
  eq([homeOn("2026-11-24", SAT), homeOn("2026-11-24", SUN), homeOn("2026-11-24", MON)], ["rest", "rest", "missed"],
    "home: gone by, the weekend still rest; Monday's Push not done is missed");
  eq([journalOn("2026-11-24", SAT), journalOn("2026-11-24", SUN)], ["rest", "rest"], "journal: the weekend gone by, rest");
  const withSaturday = new Set([FRI, SAT]);
  eq([homeOn("2026-11-24", SAT, withSaturday), journalOn("2026-11-24", SAT, withSaturday)], ["workout", "workout"],
    "a workout done in between anyway shows as one");
  eq([restBeforeStart(p, SAT, FRI), restBeforeStart(p, MON, FRI), restBeforeStart(p, FRI, FRI), restBeforeStart(OLD, SAT, FRI)],
    [true, false, false, false], "rest before start: only the days still to come before it");

  // Home's week: Saturday and Sunday rest.
  const week = buildWeekSchedule({
    program: p, history, weekStartYMD: "2026-11-16", effectiveToday: FRI, resolvedTodayName: null, override: null, allPrograms: programs,
  });
  eq(week.days.map(d => `${d.dateYMD.slice(8)} ${d.workoutName}${d.completed ? " done" : ""}`),
    ["16 Rest", "17 Rest", "18 Rest", "19 Rest", "20 Lower done", "21 Rest", "22 Rest"], "home's week: Friday's workout stays Friday's, the weekend rest");
  eq(runStatus(programRunViews(p, history).at(-1)!, FRI), "Starts Mon 23 Nov", "compare: a run that hasn't begun says when it starts");
}

// ─── 3. Let go before it began ──────────────────────────────────────────────
{
  const oneWeek: SavedProgram = { ...NEW, totalWeeks: 1 };
  const [scheduled] = activateProgram([oneWeek], "new", "20 Nov 2026", [], storedStart(MON)).programs;
  const marked: SavedProgram = { ...scheduled, skippedDates: [MON], pushedDates: [MON], pulledDates: ["2026-11-25"] };
  const other: SavedProgram = { ...NEW, id: "other", name: "Other" };
  const { programs, finished } = activateProgram([marked, other], "other", "20 Nov 2026", []);
  const was = programs.find(x => x.id === "new")!;
  eq([was.status, was.currentWeek, finished, was.startDate], ["created", 0, null, "23 Nov 2026"],
    "replaced before it began: back to created, not finished (no achievement), its start kept (a workout today stays in the run before)");
  eq([was.skippedDates, was.pushedDates, was.pulledDates], [undefined, undefined, undefined], "replaced before it began: its marks gone");
  const off = deactivateProgram([marked], "new", [], "20 Nov 2026")[0];
  eq([off.status, off.currentWeek, off.startDate, off.pushedDates], ["created", 0, "23 Nov 2026", undefined], "made inactive before it began: the same");
  const running = activateProgram([oneWeek], "new", "13 Nov 2026", []).programs[0];
  eq(deactivateProgram([running], "new", [], "20 Nov 2026")[0].startDate, "13 Nov 2026", "made inactive once begun: its start kept");
}

// The run a program re-activated after training today is ending keeps today's
// workout: it ends the day before the new run, not the day before today (a
// workout today fell in neither run once the new one started later).
{
  const ran: SavedProgram = { ...NEW, status: "paused", startDate: "02 Nov 2026", currentWeek: 3 };
  const today: CompletedWorkout = { ...FRIDAY_SESSION, id: "w_today", programId: "new", dayId: "n0", workoutName: "Push" };
  const { programs } = activateProgram([ran], "new", "20 Nov 2026", [today], storedStart(SAT));
  const views = programRunViews(programs[0], [today]);
  eq(views.map(v => [v.ref.run, v.sessions.map(w => w.id)]), [[0, ["w_today"]], ["latest", []]], "re-activated from tomorrow: today's workout stays in the run it was done in");
  eq(programs[0].runs?.[0]?.endDate, FRI, "re-activated from tomorrow: the run ends today");
}

// ─── 4. Change Start Date, and the words ────────────────────────────────────
{
  const [p] = activateProgram([NEW], "new", "20 Nov 2026", [], storedStart(MON)).programs;
  const moved = withStartDate({ ...p, skippedDates: [MON], pushedDates: [MON], pulledDates: ["2026-11-25"] }, NEXT_MON);
  eq([moved.startDate, startsLater(moved, FRI), getWorkoutForDate(moved, MON)?.name ?? "rest", getWorkoutForDate(moved, NEXT_MON)?.name],
    ["30 Nov 2026", NEXT_MON, "rest", "Push"], "change start date: day 1 on the new day, the old one rest");
  eq([moved.skippedDates, moved.pushedDates, moved.pulledDates], [undefined, undefined, undefined], "change start date: marks on the old timeline gone");
  eq(withStartDate(p, "not a date"), p, "change start date: a date that can't be read changes nothing");

  const running: SavedProgram = { ...NEW, status: "active", startDate: "09 Nov 2026", currentWeek: 1 };
  eq(replaceMessage(running, "New Program", MON, FRI),
    `"New Program" is your active program, in week 2 of 4. "New Program" will start on Monday 23 November in its place, and making "New Program" active again later starts it over from week 1. Your logged workouts stay in your Journal. The days until then are rest days.`,
    "replace: a running program, the new one from Monday");
  eq(replaceMessage({ ...running, name: "Running" }, "Next", FRI, FRI).includes(`"Next" will start today in its place`), true, "replace: from today");
  eq(replaceMessage({ ...running, name: "Running", startDate: "23 Oct 2026" }, "Next", SAT, FRI),
    `"Running" has reached its last week, so it will be marked complete and "Next" will start on Saturday 21 November. The days until then are rest days.`,
    "replace: one in its last week");
  eq(replaceMessage(p, "Next", SAT, FRI), `"New Program" is set to start on Monday 23 November. "Next" will start on Saturday 21 November in its place. The days until then are rest days.`,
    "replace: one that hasn't begun");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ a program starts when it's set to, the days before it rest");
