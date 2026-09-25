// The program page the Journal opens: which sessions it holds, which week each
// lands in, what each day of a week was, and what the weeks earned.
//
// The cases are the ways the page has got it wrong: another program's
// same-named day counted as this one's; weeks that ran from whatever weekday
// the program started on (a Friday start showed every week Friday to
// Thursday); and nothing to say what a week was short of.
//
// Run:  npx tsx scripts/verify-program-history.ts
// Exits non-zero if any assertion fails.

import type { CompletedExercise, CompletedWorkout, SavedProgram } from "../constants/programs";
import { buildProgramHistory, sessionStats } from "../utils/programHistory";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── fixture ─────────────────────────────────────────────────────────────────
// Starts Mon 7 Sep 2026, four weeks. Cycle: Push, Pull, Rest, Legs, Rest,
// Upper, Rest. "Today" is Wed 23 Sep, a rest day.
const TODAY = "2026-09-23";
const W1 = "2026-09-07", W2 = "2026-09-14", W3 = "2026-09-21";
const program: SavedProgram = {
  id: "P", name: "PPL", totalWeeks: 4, currentWeek: 1, status: "active",
  startDate: "07 Sep 2026", trainingDays: 4, cycleDays: 7,
  cyclePattern: ["Push", "Pull", "Rest", "Legs", "Rest", "Upper", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
  workouts: {},
};

const bench = (kg: number, done = true): CompletedExercise => ({
  name: "Bench Press",
  notes: "",
  sets: [
    { type: "warmup", weight: "40", reps: "10", done },
    { type: "working", weight: String(kg), reps: "5", done },
    { type: "working", weight: String(kg), reps: "5", done },
  ],
});

function session(
  date: string,
  workoutName: string,
  over: Partial<CompletedWorkout> = {},
): CompletedWorkout {
  return {
    id: `${over.programId ?? "P"}-${date}-${workoutName}`,
    date,
    completedAt: `${date}T18:00:00.000Z`,
    workoutName,
    durationSeconds: 3600,
    exercises: [],
    programId: "P",
    ...over,
  };
}

const history: CompletedWorkout[] = [
  // Week of 7 Sep: Push, Pull, Legs. Upper (Sat 12) skipped, but another
  // program's "Push" was logged that day.
  session("2026-09-07", "Push", { exercises: [bench(100)] }),
  session("2026-09-08", "Pull"),
  session("2026-09-10", "Legs"),
  session("2026-09-12", "Push", { programId: "OTHER" }),
  // Week of 14 Sep: Push (a bench PR), Pull, Upper. Legs (Thu 17) went to a
  // free workout instead.
  session("2026-09-14", "Push", { exercises: [bench(105)] }),
  session("2026-09-15", "Pull"),
  session("2026-09-17", "Run", { programId: "" }),
  session("2026-09-19", "Upper"),
  // This week: Push only. Pull (Tue 22) missed.
  session("2026-09-21", "Push", { exercises: [bench(105)] }),
];

const weekOf = (h: ReturnType<typeof buildProgramHistory>, monday: string) =>
  h.weeks.find(w => w.startYMD === monday)!;
const states = (h: ReturnType<typeof buildProgramHistory>, monday: string) =>
  weekOf(h, monday).days.map(d => d.state);

// ─── which weeks, and which sessions ─────────────────────────────────────────
{
  const h = buildProgramHistory(program, history, TODAY);
  eq(h.weeks.map(w => w.startYMD), [W3, W2, W1], "one section per Monday-to-Sunday week, newest first, up to this one");
  eq(h.weeks.map(w => w.number), [3, 2, 1], "numbered from the first");
  eq(h.weeks.map(w => w.isCurrent), [true, false, false], "this week is marked");
  eq(h.weeks.every(w => w.days.length === 7), true, "every week is seven days");
  eq(weekOf(h, W1).sessions.map(w => w.workoutName), ["Push", "Pull", "Legs"],
    "another program's session isn't this program's, even under the same day name");
  eq(h.totals.sessions, 7, "seven sessions in all");
}

// ─── what each day was ───────────────────────────────────────────────────────
{
  const h = buildProgramHistory(program, history, TODAY);
  eq(states(h, W1), ["trained", "trained", "rest", "trained", "rest", "replaced", "rest"],
    "a planned day something else was logged on reads replaced");
  eq(states(h, W2), ["trained", "trained", "rest", "replaced", "rest", "trained", "rest"],
    "a free workout on a planned day reads replaced too");
  eq(states(h, W3), ["trained", "missed", "rest", "upcoming", "rest", "upcoming", "rest"],
    "a planned day with nothing logged is missed, the rest of this week is to come");
  eq([weekOf(h, W1).done, weekOf(h, W1).planned], [3, 4], "3 of 4");
  eq([weekOf(h, W3).done, weekOf(h, W3).planned], [1, 4], "this week counts the days still to come in its plan");}

// ─── a program that started mid-week ─────────────────────────────────────────
// The reported case: a Friday start used to make every week Friday to Thursday.
{
  const friday: SavedProgram = { ...program, startDate: "11 Sep 2026" };
  const h = buildProgramHistory(friday, [session("2026-09-11", "Push")], TODAY);
  eq(h.weeks.map(w => w.startYMD), [W3, W2, W1], "weeks still start on Monday");
  eq(weekOf(h, W1).number, 1, "the short week it started in is Week 1");
  eq(states(h, W1), ["off", "off", "off", "off", "trained", "missed", "rest"],
    "the days before it started are outside it; from Friday it runs its cycle");
}

// ─── totals ──────────────────────────────────────────────────────────────────
{
  const h = buildProgramHistory(program, history, TODAY);
  const w1 = weekOf(h, W1);
  eq(w1.volumeKg, 1000, "volume counts completed working sets only (2 × 5 × 100)");
  eq(w1.sets, 2, "sets count completed working sets only");
  eq(w1.durationSeconds, 3 * 3600, "time adds up the week's sessions");
  eq(sessionStats(session("2026-09-07", "Push", { exercises: [bench(100, false)] })),
    { exercises: 0, sets: 0, volumeKg: 0 }, "a session with nothing ticked has nothing to count");
}

// ─── achievements ────────────────────────────────────────────────────────────
{
  const h = buildProgramHistory(program, history, TODAY);
  const cats = (monday: string) => weekOf(h, monday).achievements.map(a => a.category);
  eq(cats(W1), [], "a first-ever log isn't a PR");
  eq(cats(W2), ["pr"], "the heavier bench is");
  const pr = weekOf(h, W2).achievements[0];
  eq(pr.category === "pr" ? pr.prs : null, [{ exerciseName: "Bench Press", valueKg: 105, prevKg: 100 }],
    "the PR names the lift and both weights");
  eq(cats(W3), [], "equalling it isn't");
  // The tenth workout of all time lands in whichever week it was logged. Every
  // workout counts towards it, this program's or not: five before the program,
  // three of its first week, the other program's on Sat 12, then Mon 14's Push.
  const earlier = Array.from({ length: 5 }, (_, i) =>
    session(`2026-08-0${i + 1}`, "Run", { programId: "" }));
  const tenth = buildProgramHistory(program, [...earlier, ...history], TODAY);
  eq(weekOf(tenth, W2).achievements.map(a => a.category), ["pr", "workouts"],
    "the 10th workout ever is Mon 14's Push, and it's a milestone there");
  const eleventh = buildProgramHistory(program, [...earlier, session("2026-08-06", "Run", { programId: "" }), ...history], TODAY);
  eq(eleventh.weeks.flatMap(w => w.achievements).some(a => a.category === "workouts"), false,
    "one more before it and the 10th is the other program's session, so no milestone shows here");
}

// ─── a moved day ─────────────────────────────────────────────────────────────
// Move to Tomorrow with no rest day to absorb it: a bare push on Tue 8. The
// week is still Monday to Sunday; the cycle behind it runs a day later.
{
  const pushed: SavedProgram = { ...program, skippedDates: ["2026-09-08"], pushedDates: ["2026-09-08"] };
  const h = buildProgramHistory(pushed, [session("2026-09-14", "Upper")], TODAY);
  eq(states(h, W1), ["missed", "rest", "missed", "rest", "missed", "rest", "missed"],
    "the moved day reads rest, and every planned day after it lands a day later");
  eq(weekOf(h, W2).sessions.map(s => s.date), ["2026-09-14"], "a session belongs to the calendar week it was done in");
}

// ─── a program that stopped ──────────────────────────────────────────────────
{
  const ended: SavedProgram = { ...program, status: "completed", completedDate: "16 Sep 2026", currentWeek: 2 };
  const h = buildProgramHistory(ended, history, TODAY);
  eq(h.weeks.map(w => w.startYMD), [W3, W2, W1], "a completed program still shows every week a session landed in");
  eq(states(h, W2).slice(3), ["off", "off", "trained", "off"],
    "after it was marked complete, days are off, not missed (a session logged anyway still shows)");
  eq(h.weeks.flatMap(w => w.achievements).some(a => a.category === "program"), false,
    "finishing early earns nothing");

  const full: SavedProgram = { ...program, totalWeeks: 2, status: "completed", completedDate: "20 Sep 2026", currentWeek: 2 };
  const done = buildProgramHistory(full, history.filter(w => w.date <= "2026-09-20"), TODAY);
  eq(done.weeks.map(w => w.startYMD), [W2, W1], "it stops at the week it ended in");
  eq(weekOf(done, W2).achievements.map(a => a.category), ["pr", "program"],
    "finishing the full run lands in the week it ended");

  const held: SavedProgram = { ...program, pausedAt: "2026-09-16", currentWeek: 2 };
  const hh = buildProgramHistory(held, history.filter(w => w.date < "2026-09-16"), TODAY);
  eq(hh.weeks.map(w => w.startYMD), [W2, W1], "a held program stops at the week the hold began");
  eq(states(hh, W2), ["trained", "trained", "held", "held", "held", "held", "held"],
    "from the hold on, days are held");

  eq(buildProgramHistory({ ...program, status: "created" }, [], TODAY).weeks, [], "a program never started has no weeks");
  eq(buildProgramHistory({ ...program, startDate: "not a date" }, history, TODAY).weeks, [],
    "an unreadable start date has no weeks (never a year-0 program)");
}

// ─── a legacy session ────────────────────────────────────────────────────────
{
  const legacy = session("2026-09-07", "Push", { id: "legacy", programId: undefined });
  const h = buildProgramHistory(program, [legacy], TODAY);
  eq(weekOf(h, W1).sessions.map(w => w.id), ["legacy"],
    "a session from before programIds is still counted by its day name, inside the program's dates");
}

if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`${passed} passed, 0 failed`);
  console.log("✓ program history holds");
}
