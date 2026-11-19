// scripts/verify-training-totals.ts
//
// The Journal's Your Training card (utils/trainingTotals.ts): the workouts,
// the time, the PRs (the trophies and medals the sessions wear), programs
// finished, the weekly bars and their sentence, and then and now.
//
// Run: npx tsx scripts/verify-training-totals.ts

import type { CompletedExercise, CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import {
  STRIP_WEEKS, groupDigits, memoryWhen, monthsBeforeYMD, plannedThisWeek, programsFinished, sinceText,
  stripMonths, stripSentence, thenAndNow, topSetText, trainingFacts, trainingTotals,
} from "../utils/trainingTotals";
import { countTrophies, prSetsOfWorkout } from "../utils/achievements";
import { countMedals, repPrSetsOfWorkout } from "../utils/repPrs";
import { buildWeekSchedule, weekStartFor } from "../utils/weekSchedule";
import { resolveWorkoutForDate } from "../utils/workout";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const set = (weight: string, reps: string, type: CompletedSet["type"] = "working", done = true): CompletedSet =>
  ({ type, weight, reps, done });
const ex = (name: string, sets: CompletedSet[], extra: Partial<CompletedExercise> = {}): CompletedExercise =>
  ({ name, sets, notes: "", ...extra });
let seq = 0;
function session(date: string, exercises: CompletedExercise[], opts: { completedAt?: string; seconds?: number; id?: string } = {}): CompletedWorkout {
  seq += 1;
  return {
    id: opts.id ?? `w${seq}-${date}`,
    date,
    completedAt: opts.completedAt ?? `${date}T08:00:00.000Z`,
    workoutName: "Workout",
    durationSeconds: opts.seconds ?? 3600,
    exercises,
    programId: "",
  };
}
const program = (o: Partial<SavedProgram>): SavedProgram => ({
  id: "P", name: "P", totalWeeks: 8, currentWeek: 1, status: "created", startDate: "14 Sep 2026",
  trainingDays: 3, cycleDays: 7, cyclePattern: ["Rest", "Rest", "Rest", "Rest", "Rest", "Rest", "Rest"], workouts: {},
  ...o,
} as SavedProgram);

const TODAY = "2026-11-19"; // a Thursday

// ─── PRs: the trophies and medals the sessions wear ──────────────────────────
{
  const history = [
    session("2026-01-05", [ex("Bench Press", [set("60", "8")]), ex("Squat", [set("80", "5")])]),
    // Heavier bench: a trophy. The same squat for more reps: a medal.
    session("2026-01-08", [ex("Bench Press", [set("62.5", "8")]), ex("Squat", [set("80", "6")])]),
    // A weight done before for more reps: a medal. Heavier than ever: a trophy.
    session("2026-01-12", [ex("Bench Press", [set("62.5", "9")]), ex("Squat", [set("85", "5")])]),
    session("2026-01-15", [ex("Assisted Pull-Up", [set("30", "8")])]),
    // Less help on an assisted lift: a trophy.
    session("2026-01-19", [ex("Assisted Pull-Up", [set("25", "8")])]),
    // Two sessions finished at the same moment don't count each other: both
    // beat 62.5, both wear one.
    session("2026-01-22", [ex("Bench Press", [set("65", "8")])], { completedAt: "2026-01-22T08:00:00.000Z" }),
    session("2026-01-22", [ex("Bench Press", [set("65", "8")])], { completedAt: "2026-01-22T08:00:00.000Z" }),
    // An unreadable finish wears nothing and raises no one's best.
    session("2026-01-25", [ex("Bench Press", [set("100", "1")])], { completedAt: "not a date" }),
    session("2026-01-29", [ex("Bench Press", [set("66", "8"), set("66", "8")])]),
    // Warm-ups and sets not ticked count for nothing.
    session("2026-02-02", [ex("Bench Press", [set("90", "5", "warmup"), set("90", "5", "working", false)])]),
  ];
  eq(countTrophies(history), 6, "trophies: heavier, less help, same-moment sessions each, one per exercise");
  eq(countMedals(history), 2, "medals: more reps at a weight done before");
  const marks = history.reduce((n, w) =>
    n + prSetsOfWorkout(w, history).flat().filter(Boolean).length + repPrSetsOfWorkout(w, history).flat().filter(Boolean).length, 0);
  eq(countTrophies(history) + countMedals(history), marks, "the PR count is the marks every session wears");
  eq(trainingTotals({ history, programs: [], today: TODAY }).prs, marks, "the card's PRs are trophies plus medals");
  eq(countTrophies([]) + countMedals([]), 0, "no history, no PRs");
}

// ─── Workouts, since, time ───────────────────────────────────────────────────
{
  const history = [
    session("2026-01-12", [], { seconds: 3600 }),
    session("2026-03-02", [], { seconds: 1800 }),
    session("2026-03-02", [], { seconds: 1800 }), // two in a day are two
    session("not-a-date", [], { seconds: Number.NaN }),
    session("2026-05-01", [], { seconds: -50 }),
  ];
  const t = trainingTotals({ history, programs: [], today: TODAY });
  eq(t.workouts, 5, "every session is a workout, as the milestone cards count");
  eq(t.firstDate, "2026-01-12", "since the first training day (an unreadable date skipped)");
  eq(t.seconds, 7200, "time adds every session's length, nothing for a bad or negative one");
  eq(sinceText("2026-01-12", TODAY), "since 12 January", "since: this year's date without its year");
  eq(sinceText("2025-03-03", TODAY), "since 3 March 2025", "since: an earlier year's with it");
  eq(trainingTotals({ history: [], programs: [], today: TODAY }).workouts, 0, "nothing logged, nothing shown");
}

// ─── The facts ───────────────────────────────────────────────────────────────
eq(
  trainingFacts({ seconds: 147 * 3600 + 59 * 60, prs: 38, programsFinished: 3 }),
  [{ key: "time", num: "147", word: "hours" }, { key: "prs", num: "38", word: "PRs" }, { key: "programs", num: "3", word: "programs finished" }],
  "facts: whole hours, PRs, programs finished",
);
eq(
  trainingFacts({ seconds: 3600, prs: 1, programsFinished: 1 }),
  [{ key: "time", num: "1", word: "hour" }, { key: "prs", num: "1", word: "PR" }, { key: "programs", num: "1", word: "program finished" }],
  "facts: singular at one",
);
eq(trainingFacts({ seconds: 45 * 60, prs: 0, programsFinished: 0 }), [{ key: "time", num: "45", word: "minutes" }], "facts: minutes under an hour, nothing at 0");
eq(trainingFacts({ seconds: 30, prs: 0, programsFinished: 0 }), [], "facts: none with nothing to count");
eq(trainingFacts({ seconds: 1204 * 3600, prs: 0, programsFinished: 0 })[0].num, "1,204", "facts: thousands grouped");
eq([groupDigits(999), groupDigits(1234567)], ["999", "1,234,567"], "groupDigits");

// ─── Programs finished ───────────────────────────────────────────────────────
{
  const run = (status: "completed" | "paused") => ({
    startDate: "01 Jan 2026", totalWeeks: 8, cycleDays: 7, cyclePattern: [], currentWeek: 8, status, endDate: "2026-02-26",
  });
  eq(programsFinished([program({ status: "completed" })]), 1, "a program finished, by itself or Mark Complete");
  eq(programsFinished([program({ status: "active", runs: [run("completed"), run("paused"), run("completed")] })]), 2, "each finished run counts, a shelved one doesn't");
  eq(programsFinished([program({ status: "completed", runs: [run("completed")] })]), 2, "a program finished twice is two");
  eq(programsFinished([program({ status: "paused" }), program({ status: "created" })]), 0, "shelved or never started: none");
}

// ─── The weekly bars ─────────────────────────────────────────────────────────
{
  const history = [
    session("2026-10-26", []), session("2026-10-27", []), session("2026-10-29", []), session("2026-10-30", []),
    session("2026-11-02", []), session("2026-11-03", []), session("2026-11-05", []), session("2026-11-06", []),
    session("2026-11-09", []), session("2026-11-10", []), session("2026-11-12", []),
    session("2026-11-16", []), session("2026-11-17", []),
  ];
  const t = trainingTotals({ history, programs: [], today: TODAY });
  eq(t.weeks.length, STRIP_WEEKS, "26 weeks");
  eq([t.weeks[0].start, t.weeks[25].start], ["2026-05-25", "2026-11-16"], "Monday weeks, ending this week");
  eq(t.weeks.slice(20).map(w => w.workouts), [null, null, 4, 4, 3, 2], "a week's workouts; before the first, nothing");
  eq([t.weeksTrained, t.weeksCounted, t.sinceStart], [4, 4, true], "every week since the start");
  eq(stripSentence(t), { lead: "You've trained ", strong: "every week", tail: " since you started." }, "the sentence since the start");

  // This week with nothing yet isn't a week missed; last week with nothing is.
  const quiet = trainingTotals({ history: history.filter(w => w.date < "2026-11-09"), programs: [], today: TODAY });
  eq([quiet.weeksTrained, quiet.weeksCounted], [2, 3], "this week under way isn't counted until it has a workout");
  eq(stripSentence(quiet), { lead: "You trained ", strong: "2 of the 3 weeks", tail: " since you started." }, "weeks missed since the start");

  // A session on this week's Sunday is this week's; one dated after it isn't drawn.
  const edge = trainingTotals({ history: [...history, session("2026-11-22", []), session("2026-11-23", [])], programs: [], today: TODAY });
  eq(edge.weeks[25].workouts, 3, "this week runs to Sunday; a later date is left off");
}
{
  // A long history: the sentence says the last 26 weeks.
  const history: CompletedWorkout[] = [session("2026-01-12", [])];
  const t0 = trainingTotals({ history, programs: [], today: TODAY });
  const starts = t0.weeks.map(w => w.start).filter(s => s !== "2026-08-03" && s !== "2026-09-07");
  for (const s of starts) history.push(session(s, []));
  const t = trainingTotals({ history, programs: [], today: TODAY });
  eq([t.weeksTrained, t.weeksCounted, t.sinceStart], [24, 26, false], "the last 26 weeks, two of them off");
  eq(t.weeks.filter(w => w.workouts === 0).map(w => w.start), ["2026-08-03", "2026-09-07"], "a week off is 0, not nothing");
  eq(stripSentence(t), { lead: "You trained ", strong: "24 of the last 26 weeks", tail: "." }, "the sentence over the last 26 weeks");
  eq(stripSentence({ weeksTrained: 26, weeksCounted: 26, sinceStart: false }).strong, "every one of the last 26 weeks", "every one of them");
  eq(stripSentence({ weeksTrained: 1, weeksCounted: 1, sinceStart: true }), { lead: "Your ", strong: "first week", tail: " of training." }, "the first week");
  eq(
    stripMonths(t.weeks),
    [{ col: 1, label: "Jun" }, { col: 6, label: "Jul" }, { col: 10, label: "Aug" }, { col: 15, label: "Sep" }, { col: 19, label: "Oct" }, { col: 23, label: "Nov" }],
    "each month under its first week",
  );
}
{
  // Across a daylight-saving change (Sydney's ends 5 April 2026): every week a
  // Monday, each seven days after the last.
  const t = trainingTotals({ history: [session("2026-01-05", [])], programs: [], today: "2026-06-10" });
  const utc = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  eq(t.weeks.every(w => new Date(utc(w.start)).getUTCDay() === 1), true, "every week starts on a Monday");
  eq(t.weeks.slice(1).every((w, i) => (utc(w.start) - utc(t.weeks[i].start)) / 86400000 === 7), true, "weeks seven days apart across DST");
}

// ─── This week's plan: Home's ring's ─────────────────────────────────────────
{
  const p = program({
    status: "active", trainingDays: 4,
    cyclePattern: ["Upper", "Lower", "Rest", "Upper", "Rest", "Legs", "Rest"],
    dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  });
  const today = "2026-09-16";
  const home = buildWeekSchedule({
    program: p, history: [], weekStartYMD: weekStartFor(today), effectiveToday: today,
    resolvedTodayName: resolveWorkoutForDate(p, null, today, [p])?.name ?? null, override: null, allPrograms: [p],
  }).plannedCount;
  eq(plannedThisWeek({ program: p, history: [], programs: [p], today, override: null }), home, "this week's plan is Home's ring's");
  eq(home, 4, "four workouts planned this week");
  eq(plannedThisWeek({ program: null, history: [], programs: [], today, override: null }), null, "no program, no plan");
}

// ─── Then and now ────────────────────────────────────────────────────────────
eq(
  [monthsBeforeYMD("2026-11-19", 3), monthsBeforeYMD("2026-05-31", 3), monthsBeforeYMD("2024-05-31", 3), monthsBeforeYMD("2026-01-15", 3)],
  ["2026-08-19", "2026-02-28", "2024-02-29", "2025-10-15"],
  "three months back, held to the month's end",
);
{
  const history = [
    session("2026-01-12", [ex("Curl", [set("15", "10")])]),
    session("2026-08-19", [
      ex("Bench Press", [set("72.5", "6")]),
      ex("Barbell Row", [set("60", "8")]),
      ex("Push-Up", [set("0", "20")]),
      ex("Plank", [set("20", "60")], { isIsometric: true }),
    ], { id: "then" }),
    session("2026-11-16", [
      ex("Bench Press", [set("80", "6")]),
      ex("Barbell Row", [set("65", "8")]),
      ex("Push-Up", [set("0", "40")]),
      ex("Plank", [set("40", "90")], { isIsometric: true }),
    ]),
  ];
  const m = thenAndNow(history, TODAY);
  eq(m && { id: m.workoutId, lift: m.exerciseName, then: m.then, now: m.now, first: m.first },
    { id: "then", lift: "Bench Press", then: { kg: 72.5, reps: 6 }, now: { kg: 80, reps: 6 }, first: false },
    "the lift come on most for its size; bodyweight and holds left out");
  eq(m && memoryWhen(m, TODAY), "3 months ago  ·  19 Aug", "then and now's when");
  eq(m && [topSetText(m.then, true), topSetText(m.now, true)], ["72.5 kg × 6", "80 kg × 6"], "the sets in the unit on screen");

  const assisted = thenAndNow([
    session("2026-08-12", [ex("Assisted Pull-Up", [set("30", "8")]), ex("Lat Pulldown", [set("50", "10")])]),
    session("2026-11-12", [ex("Assisted Pull-Up", [set("20", "8")]), ex("Lat Pulldown", [set("55", "10")])]),
  ], TODAY);
  eq(assisted && [assisted.exerciseName, assisted.now.kg], ["Assisted Pull-Up", 20], "less help is better on an assisted lift");
  eq(thenAndNow([
    session("2026-08-12", [ex("Assisted Pull-Up", [set("20", "8")])]),
    session("2026-11-12", [ex("Assisted Pull-Up", [set("25", "8")])]),
  ], TODAY), null, "more help isn't");

  eq(thenAndNow([
    session("2026-08-10", [ex("Bench Press", [set("80", "6")])]),
    session("2026-11-10", [ex("Bench Press", [set("77.5", "6")])]),
  ], TODAY), null, "nothing come on, no line: never a lift going backwards");

  const reps = thenAndNow([
    session("2026-08-10", [ex("Bench Press", [set("80", "6")])]),
    session("2026-11-10", [ex("Bench Press", [set("80", "8")])]),
  ], TODAY);
  eq(reps && reps.now, { kg: 80, reps: 8 }, "the same weight for more reps has come on");

  const tries = thenAndNow([
    session("2026-08-14", [ex("Bench Press", [set("70", "5")])], { id: "older" }),
    session("2026-08-18", [ex("Squat", [set("100", "5")])], { id: "newest-then" }),
    session("2026-11-14", [ex("Squat", [set("100", "5")]), ex("Bench Press", [set("75", "5")])]),
  ], TODAY);
  eq(tries && tries.workoutId, "older", "a session with nothing come on is passed over for the one before");

  eq(thenAndNow([
    session("2026-08-01", [ex("Bench Press", [set("70", "5")])]),
    session("2026-09-30", [ex("Bench Press", [set("80", "5")])]),
    session("2026-11-10", [ex("Squat", [set("100", "5")])]),
  ], TODAY), null, "now is the last time within six weeks");

  const renamed = thenAndNow([
    session("2026-08-10", [ex("Hack Squat", [set("100", "8")], { customId: "c1" })]),
    session("2026-11-10", [ex("Hack Squat Machine", [set("110", "8")], { customId: "c1" })]),
  ], TODAY);
  eq(renamed && renamed.exerciseName, "Hack Squat Machine", "a lift by its identity, named as it was last done");

  const twoCards = thenAndNow([
    session("2026-08-10", [ex("Bench Press", [set("60", "8")]), ex("Bench Press", [set("70", "5")])]),
    session("2026-11-10", [ex("Bench Press", [set("75", "5")])]),
  ], TODAY);
  eq(twoCards && twoCards.then, { kg: 70, reps: 5 }, "a lift on two cards: its best set over both");

  const firstOnly = thenAndNow([
    session("2026-10-26", [ex("Bench Press", [set("50", "8")])], { id: "first" }),
    session("2026-11-16", [ex("Bench Press", [set("55", "8")])]),
  ], TODAY);
  eq(firstOnly && [firstOnly.workoutId, firstOnly.first], ["first", true], "under 3 months in: the first workout");
  eq(firstOnly && memoryWhen(firstOnly, TODAY), "Your first workout  ·  26 Oct", "the first workout's when");
  eq(thenAndNow([
    session("2026-11-09", [ex("Bench Press", [set("50", "8")])]),
    session("2026-11-16", [ex("Bench Press", [set("55", "8")])]),
  ], TODAY), null, "a first workout under two weeks old: no line yet");

  const lastTry: CompletedWorkout[] = [session("2026-01-12", [ex("Bench Press", [set("40", "8")])], { id: "jan" })];
  for (let d = 1; d <= 8; d++) lastTry.push(session(`2026-08-0${d}`, [ex("Curl", [set("20", "10")])]));
  lastTry.push(session("2026-11-16", [ex("Bench Press", [set("80", "6")]), ex("Curl", [set("20", "10")])]));
  const fallback = thenAndNow(lastTry, TODAY);
  eq(fallback && [fallback.workoutId, fallback.first, fallback.exerciseName], ["jan", true, "Bench Press"], "the first workout is tried last");

  eq(memoryWhen({ date: "2025-10-01", first: false }, TODAY), "1 year ago  ·  1 Oct 2025", "a year ago, with its year");
  eq(memoryWhen({ date: "2024-06-01", first: false }, TODAY), "2 years ago  ·  1 Jun 2024", "years ago");
  eq(thenAndNow([], TODAY), null, "no history, no line");
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-training-totals: ${passed} passed`);
