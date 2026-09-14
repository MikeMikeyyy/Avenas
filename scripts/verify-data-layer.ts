// Lightweight, framework-free verification of the pure data-layer functions in
// utils/workout.ts (which only depend on utils/dates.ts). These power "today's
// workout" resolution and the "previous values" shown while logging, so they
// must stay correct as we head into the Supabase backend.
//
// Run:  npx tsx scripts/verify-data-layer.ts
// Exits non-zero (throws) if any assertion fails.

import {
  resolveDayIndex,
  getWorkoutForDate,
  getTodaysWorkout,
  resolveTodayWorkout,
  resolveWorkoutForDate,
  getEffectiveToday,
  buildPrevByName,
  prevDayScopeFor,
  normalizeExerciseName,
} from "../utils/workout";
import { parseStoredDate, formatStoredDate, todayYMD } from "../utils/dates";
import {
  formatWeightForDisplay, parseWeightToKg, migrateWeightLbToKg, trimNumber,
  KG_PER_LB,
} from "../utils/units";
import { migrateHistoryWeights, migrateProgramWeights } from "../utils/weightMigration";
import { assignProgramDayIds, backfillHistoryDayIds, resolveHistoricDayId } from "../utils/dayIdMigration";
import {
  canonicalizeWorkouts, dayIdAt, dayLabel, forkChangedDayIds, historicalDays,
  normalizeDayIds, parseDayKey, programDays, trainingDayKeys,
} from "../utils/programDays";
import {
  programToRow, programFromRow,
  workoutToRow, workoutFromRow,
  journalToRow, journalFromRow,
  customToRow, customFromRow,
  toReplaceUserDataPayload,
} from "../lib/mappers";
import type { CompletedWorkout, SavedProgram, WorkoutMap } from "../constants/programs";
import type { ProgramRow, WorkoutRow, JournalRow, CustomExerciseRow } from "../lib/database.types";
import type { JournalEntry } from "../constants/journal";
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

function makeProgram(partial: Partial<SavedProgram> = {}): SavedProgram {
  return {
    id: "p1",
    name: "Test",
    totalWeeks: 8,
    currentWeek: 1,
    status: "active",
    startDate: "01 Jan 2026",
    trainingDays: 3,
    cycleDays: 7,
    cyclePattern: ["Push", "Pull", "Legs", "Rest", "Push", "Pull", "Rest"],
    workouts: {
      "0:Push": [{ id: "e1", name: "Bench Press", sets: [{ type: "working", reps: "5" }] }],
      "1:Pull": [{ id: "e2", name: "Row", sets: [{ type: "working", reps: "8" }] }],
      "2:Legs": [],
    },
    ...partial,
  };
}

function makeWorkout(id: string, completedAt: string, exName: string, weight: string, reps: string): CompletedWorkout {
  return {
    id,
    date: completedAt.slice(0, 10),
    completedAt,
    workoutName: "Push",
    durationSeconds: 0,
    exercises: [{ name: exName, notes: "", sets: [{ type: "working", weight, reps, done: true }] }],
  };
}

// ── parseStoredDate: strict, null on junk ──────────────────────────────────────
eq(parseStoredDate("garbage"), null, "parseStoredDate junk -> null");
eq(parseStoredDate("32 Jan 2026"), null, "parseStoredDate day>31 -> null");
eq(parseStoredDate("01 Xyz 2026"), null, "parseStoredDate bad month -> null");
eq(parseStoredDate(""), null, "parseStoredDate empty -> null");
eq(parseStoredDate(undefined), null, "parseStoredDate undefined -> null");
check(parseStoredDate("01 Jan 2026") instanceof Date, "parseStoredDate valid -> Date");

// ── resolveDayIndex: cycle math ────────────────────────────────────────────────
const p = makeProgram();
eq(resolveDayIndex(p, "2026-01-01"), 0, "dayIndex start day -> 0");
eq(resolveDayIndex(p, "2026-01-04"), 3, "dayIndex +3 -> 3 (Rest)");
eq(resolveDayIndex(p, "2026-01-08"), 0, "dayIndex wrap-around 7%7 -> 0");
eq(resolveDayIndex(p, "2025-12-31"), null, "dayIndex pre-start -> null");
eq(resolveDayIndex(makeProgram({ cycleOffset: 2 }), "2026-01-01"), 2, "dayIndex +cycleOffset 2 -> 2");
eq(resolveDayIndex(makeProgram({ cycleOffset: -1 }), "2026-01-01"), 6, "dayIndex negative-safe (-1 -> 6)");
eq(resolveDayIndex(makeProgram({ startDate: "garbage" }), "2026-01-01"), null, "dayIndex unparseable start -> null");

// ── getWorkoutForDate ──────────────────────────────────────────────────────────
eq(getWorkoutForDate(p, "2026-01-01"), { dayIndex: 0, name: "Push", exercises: p.workouts["0:Push"], programId: "p1", dayId: "d0" }, "workoutForDate -> Push");
eq(getWorkoutForDate(p, "2026-01-04"), null, "workoutForDate Rest -> null");
eq(getWorkoutForDate(p, "2026-01-03"), { dayIndex: 2, name: "Legs", exercises: [], programId: "p1", dayId: "d2" }, "workoutForDate Legs (empty exercises)");
eq(getWorkoutForDate(makeProgram({ startDate: "nope" }), "2026-01-01"), null, "workoutForDate unparseable -> null");

// ── getTodaysWorkout / resolveTodayWorkout (today-relative) ─────────────────────
const pToday = makeProgram({ startDate: formatStoredDate(new Date()) }); // started today -> dayIndex 0 -> Push
eq(getTodaysWorkout(pToday)?.name, "Push", "getTodaysWorkout (start today) -> Push");
eq(resolveTodayWorkout(pToday, null)?.name, "Push", "resolveToday no override -> Push");
eq(
  resolveTodayWorkout(pToday, { date: todayYMD(), workoutName: "Pull" }),
  { dayIndex: 1, name: "Pull", exercises: pToday.workouts["1:Pull"], programId: "p1", dayId: "d1" },
  "resolveToday override -> Pull",
);
eq(resolveTodayWorkout(pToday, { date: "2020-01-01", workoutName: "Pull" })?.name, "Push", "resolveToday stale override ignored");
eq(
  resolveTodayWorkout(null, { date: todayYMD(), workoutName: "Free Day" }),
  { dayIndex: -1, name: "Free Day", exercises: [] },
  "resolveToday free workout, no program",
);
eq(resolveTodayWorkout(null, null), null, "resolveToday null program + null override -> null");

// ── resolveWorkoutForDate (explicit-date, override-aware) ───────────────────────
eq(
  resolveWorkoutForDate(p, null, "2026-01-01"),
  { dayIndex: 0, name: "Push", exercises: p.workouts["0:Push"], programId: "p1", dayId: "d0" },
  "resolveForDate no override -> scheduled",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Pull" }, "2026-01-01"),
  { dayIndex: 1, name: "Pull", exercises: p.workouts["1:Pull"], programId: "p1", dayId: "d1" },
  "resolveForDate override matching date -> override day",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-02", workoutName: "Pull" }, "2026-01-01")?.name,
  "Push",
  "resolveForDate override for another date ignored",
);
eq(resolveWorkoutForDate(p, null, "2026-01-04"), null, "resolveForDate Rest day -> null");
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Rest" }, "2026-01-01"),
  null,
  "resolveForDate Rest override on a training day -> null",
);
eq(
  resolveWorkoutForDate(null, { date: "2026-01-01", workoutName: "Free" }, "2026-01-01"),
  { dayIndex: -1, name: "Free", exercises: [] },
  "resolveForDate free workout, no program",
);
eq(resolveWorkoutForDate(null, null, "2026-01-01"), null, "resolveForDate null program + null override -> null");

// ── resolveWorkoutForDate: cross-program override (override.programId) ─────────
// Change-day can pick a day from a NON-active program. The override records the
// source program's id; re-resolution must restore THAT program's exercises, not
// resolve the name against the active program (which would drop them).
const pOther = makeProgram({
  id: "p2",
  name: "Other",
  cyclePattern: ["Upper", "Rest"],
  cycleDays: 2,
  workouts: { "0:Upper": [{ id: "e9", name: "Overhead Press", sets: [{ type: "working", reps: "5" }] }] },
});
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Upper", programId: "p2" }, "2026-01-01", [p, pOther]),
  { dayIndex: 0, name: "Upper", exercises: pOther.workouts["0:Upper"], programId: "p2", dayId: "d0" },
  "resolveForDate cross-program override -> source program's exercises",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Pull", programId: "p1" }, "2026-01-01", [p, pOther]),
  { dayIndex: 1, name: "Pull", exercises: p.workouts["1:Pull"], programId: "p1", dayId: "d1" },
  "resolveForDate override with the active program's own id -> active day",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Upper", programId: "gone" }, "2026-01-01", [p, pOther]),
  { dayIndex: -1, name: "Upper", exercises: [] },
  "resolveForDate override whose source program was deleted -> name only, no exercises",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Upper", programId: "p2" }, "2026-01-01"),
  { dayIndex: -1, name: "Upper", exercises: [] },
  "resolveForDate cross-program override without allPrograms -> name only (degrades safely)",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Rest", programId: "p2" }, "2026-01-01", [p, pOther]),
  null,
  "resolveForDate cross-program Rest override -> null",
);

// ── getEffectiveToday: late-night grace window ──────────────────────────────────
// makeProgram cyclePattern (from 01 Jan 2026): Push Pull Legs Rest Push Pull Rest
const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h, 0, 0);
eq(getEffectiveToday(p, [], at(2026, 1, 6, 10)), "2026-01-06", "effectiveToday past cutoff -> calendar day");
eq(getEffectiveToday(p, [], at(2026, 1, 6, 1)), "2026-01-05", "effectiveToday pre-cutoff, yesterday unfinished -> yesterday");
eq(getEffectiveToday(p, [], at(2026, 1, 6, 3)), "2026-01-06", "effectiveToday exactly at cutoff -> calendar day");
eq(
  getEffectiveToday(p, [makeWorkout("y", "2026-01-05T23:00:00.000Z", "Bench", "100", "5")], at(2026, 1, 6, 1)),
  "2026-01-06",
  "effectiveToday pre-cutoff but yesterday already logged -> rolls over",
);
eq(getEffectiveToday(p, [], at(2026, 1, 5, 1)), "2026-01-05", "effectiveToday pre-cutoff, yesterday was Rest -> calendar day");
eq(getEffectiveToday(null, [], at(2026, 1, 6, 1)), "2026-01-06", "effectiveToday no program -> calendar day");

// ── buildPrevByName: newest wins, name-normalized, beforeDate filter ────────────
const hist = [
  makeWorkout("w1", "2026-02-01T10:00:00.000Z", "bench press", "90", "5"),  // older, lowercase
  makeWorkout("w2", "2026-02-02T10:00:00.000Z", "Bench Press", "100", "5"), // newer, capitalized
];
eq(buildPrevByName(hist)["bench press"], ["100×5"], "prev: newest wins + name normalized");
eq(buildPrevByName(hist, "2026-02-02")["bench press"], ["90×5"], "prev beforeDate: excludes same-day, keeps earlier");
eq(buildPrevByName(hist, "2026-02-01"), {}, "prev beforeDate: excludes all at/after -> empty");

// Timezone edge: a session logged on the morning of the 10th in a +UTC zone has
// completedAt rolled back to the 9th in UTC. Filtering must use the local `date`
// (10th), so logging for the 10th excludes it — not the UTC timestamp prefix.
const tzHist: CompletedWorkout[] = [{
  id: "tz", date: "2026-05-10", completedAt: "2026-05-09T23:00:00.000Z",
  workoutName: "Push", durationSeconds: 0,
  exercises: [{ name: "Bench", notes: "", sets: [{ type: "working", weight: "100", reps: "5", done: true }] }],
}];
eq(buildPrevByName(tzHist, "2026-05-10"), {}, "prev beforeDate: same-local-day session (completedAt rolled to prev UTC day) is excluded");
eq(buildPrevByName(tzHist, "2026-05-11")["bench"], ["100×5"], "prev beforeDate: that session is included for the next day");

const fmtHist: CompletedWorkout[] = [{
  id: "w", date: "2026-03-01", completedAt: "2026-03-01T10:00:00.000Z", workoutName: "X", durationSeconds: 0,
  exercises: [{
    name: "Var", notes: "", sets: [
      { type: "working", weight: "100", reps: "5", done: true },
      { type: "working", weight: "100", reps: "", done: true },
      { type: "working", weight: "", reps: "8", done: true },
      { type: "working", weight: "", reps: "", done: false },
    ],
  }],
}];
eq(buildPrevByName(fmtHist)["var"], ["100×5", "100", "8", "—"], "prev: set formatting variants");

// ── Reorder / multi-session "previous figures" invariants ──────────────────────
// Two program weeks with the SAME exercises in DIFFERENT orders, plus exercises
// done in only one of the weeks. Previous figures must come from the most-recent
// session BY DATE and resolve BY NAME — so reordering (or adding) exercises never
// erases values or shows another exercise's figures.
const mkSet = (w: string, r: string) => ({ type: "working" as const, weight: w, reps: r, done: true });
const week3ago: CompletedWorkout = {
  id: "wk-3ago", date: "2026-01-13", completedAt: "2026-01-13T10:00:00.000Z",
  workoutName: "Push", durationSeconds: 0,
  exercises: [
    { name: "Squat", notes: "", sets: [mkSet("100", "5")] }, // index 0
    { name: "Bench", notes: "", sets: [mkSet("80", "5")] },  // index 1
    { name: "Curl",  notes: "", sets: [mkSet("20", "12")] }, // only ever done 3 weeks ago
  ],
};
const weekLast: CompletedWorkout = {
  id: "wk-last", date: "2026-01-27", completedAt: "2026-01-27T10:00:00.000Z",
  workoutName: "Push", durationSeconds: 0,
  exercises: [
    { name: "Bench", notes: "", sets: [mkSet("90", "5")] },  // reordered to index 0
    { name: "Row",   notes: "", sets: [mkSet("65", "8")] },  // added last week
    { name: "Squat", notes: "", sets: [mkSet("110", "5")] }, // reordered to index 2
  ],
};
const prevMulti = buildPrevByName([week3ago, weekLast]);
eq(prevMulti["bench"], ["90×5"],  "prev multi: reordered exercise (idx 1->0) takes LAST week, not 3 weeks ago");
eq(prevMulti["squat"], ["110×5"], "prev multi: reordered exercise (idx 0->2) takes LAST week by name");
eq(prevMulti["row"],   ["65×8"],  "prev multi: exercise added last week shows its own figures");
eq(prevMulti["curl"],  ["20×12"], "prev multi: exercise only done 3 weeks ago still shows its last recorded figures");
// Recency is decided by completedAt, not array order — reversing the input is identical.
eq(buildPrevByName([weekLast, week3ago])["bench"], ["90×5"], "prev multi: array order irrelevant — newest completedAt wins");

// ── buildPrevByName day scoping ─────────────────────────────────────────────────
// The same exercise programmed on two days (Lateral Raise heavier on Push than
// on Arms). With a day scope, previous values come ONLY from sessions of THAT
// day — never from the most recent appearance overall, and never borrowed from
// another day for an exercise the day has no history for.
const mkDaySession = (
  id: string, date: string, workoutName: string, exs: [string, string, string][],
  ids?: { dayId?: string; programId?: string },
): CompletedWorkout => ({
  id, date, completedAt: `${date}T10:00:00.000Z`, workoutName, durationSeconds: 0,
  dayId: ids?.dayId, programId: ids?.programId,
  exercises: exs.map(([name, w, r]) => ({ name, notes: "", sets: [mkSet(w, r)] })),
});
const dayHist = [
  mkDaySession("push1", "2026-06-01", "Push", [["Lateral Raise", "12", "10"], ["Bench", "100", "5"]]),
  mkDaySession("arms1", "2026-06-04", "Arms", [["Lateral Raise", "8", "15"], ["Curl", "20", "12"]]),
];
eq(buildPrevByName(dayHist, undefined, { name: "Push" })["lateral raise"], ["12×10"], "prev day-scoped: Push day shows Push numbers even though Arms session is newer");
eq(buildPrevByName(dayHist, undefined, { name: "Arms" })["lateral raise"], ["8×15"], "prev day-scoped: Arms day shows Arms numbers");
eq(buildPrevByName(dayHist)["lateral raise"], ["8×15"], "prev unscoped: newest appearance on any day wins (unchanged)");
eq(buildPrevByName(dayHist, undefined, { name: "Push" })["curl"], undefined, "prev day-scoped: exercise never done on this day shows NOTHING (no any-day borrow)");
eq(buildPrevByName(dayHist, undefined, { name: " push " })["lateral raise"], ["12×10"], "prev day-scoped: day match is trimmed + case-insensitive");
eq(buildPrevByName(dayHist, "2026-06-04", { name: "Arms" })["lateral raise"], undefined, "prev day-scoped + beforeDate: no earlier Arms session -> blank, not the earlier Push one");
const dayHist2 = [...dayHist, mkDaySession("push2", "2026-06-08", "Push", [["Lateral Raise", "14", "8"]])];
eq(buildPrevByName(dayHist2, undefined, { name: "Push" })["lateral raise"], ["14×8"], "prev day-scoped: newest session OF the day wins");

// Two days of one program that SHARE a name — the case a name alone can't tell
// apart. "Upper" at cycle slots d0 and d3, the same press on both.
const twoUpper = [
  mkDaySession("u0a", "2026-07-08", "Upper", [["Incline Press", "30", "10"]], { dayId: "d0", programId: "P" }),
  mkDaySession("u3", "2026-07-11", "Upper", [["Incline Press", "40", "8"]], { dayId: "d3", programId: "P" }),
  mkDaySession("u0b", "2026-07-12", "Upper", [["Incline Press", "32", "10"]], { dayId: "d0", programId: "P" }),
];
const upperA = { name: "Upper", dayId: "d0", programId: "P", absorbsUnidentified: true };
const upperB = { name: "Upper", dayId: "d3", programId: "P", absorbsUnidentified: false };
eq(buildPrevByName(twoUpper, undefined, upperB)["incline press"], ["40×8"], "prev two same-named days: 2nd Upper keeps its own numbers");
eq(buildPrevByName(twoUpper, undefined, upperA)["incline press"], ["32×10"], "prev two same-named days: 1st Upper keeps its own numbers");

// A session the dayId backfill couldn't attribute (or a free workout) carries no
// dayId, so it can only be matched by name. It attaches to the FIRST day with
// that name and to no other — otherwise the 2nd Upper shows weights that were
// actually lifted on the 1st.
const unidentified = [
  mkDaySession("u3", "2026-07-11", "Upper", [["Incline Press", "40", "8"]], { dayId: "d3", programId: "P" }),
  mkDaySession("uX", "2026-07-12", "Upper", [["Incline Press", "32", "10"]], { programId: "P" }),
];
eq(buildPrevByName(unidentified, undefined, upperB)["incline press"], ["40×8"], "prev unidentified session: does NOT leak onto the 2nd same-named day");
eq(buildPrevByName(unidentified, undefined, upperA)["incline press"], ["32×10"], "prev unidentified session: absorbed by the 1st same-named day");

// Positional fallback ids (d0, d1, …) are only unique within a program, so a
// slot id must never match across programs.
const crossProgram = [
  mkDaySession("old", "2026-07-12", "Upper", [["Incline Press", "20", "10"]], { dayId: "d3", programId: "OLD" }),
  mkDaySession("cur", "2026-07-08", "Upper", [["Incline Press", "40", "8"]], { dayId: "d3", programId: "P" }),
];
eq(buildPrevByName(crossProgram, undefined, upperB)["incline press"], ["40×8"], "prev cross-program: another program's slot d3 does not match this program's d3");

// prevDayScopeFor marks the day against its own program: first "Upper" absorbs,
// the second does not.
{
  const twoUpperProgram: SavedProgram = {
    id: "P", name: "UL", totalWeeks: 6, currentWeek: 1, status: "active",
    startDate: "01 Jul 2026", trainingDays: 4, cycleDays: 6,
    cyclePattern: ["Upper", "Lower", "Rest", "Upper", "Lower", "Rest"],
    workouts: {},
  };
  eq(
    prevDayScopeFor({ name: "Upper", programId: "P", dayId: "d0" }, twoUpperProgram),
    { name: "Upper", dayId: "d0", programId: "P", absorbsUnidentified: true },
    "prevDayScopeFor: first same-named day absorbs unidentified sessions",
  );
  eq(
    prevDayScopeFor({ name: "Upper", programId: "P", dayId: "d3" }, twoUpperProgram).absorbsUnidentified,
    false,
    "prevDayScopeFor: second same-named day does not absorb",
  );
  eq(
    prevDayScopeFor({ name: "Freestyle" }, null).absorbsUnidentified,
    true,
    "prevDayScopeFor: free workout (no program, no dayId) absorbs",
  );
}

eq(normalizeExerciseName("  Bench Press  "), "bench press", "normalizeExerciseName trims + lowercases");

// ── mappers: app <-> Supabase row round-trips ──────────────────────────────────
{
  const p: SavedProgram = {
    id: "uuid-p", name: "PPL", totalWeeks: 8, currentWeek: 2, status: "active",
    startDate: "01 Jan 2026", completedDate: "05 Mar 2026", cycleOffset: 2,
    trainingDays: 3, cycleDays: 7,
    cyclePattern: ["Push", "Pull", "Rest"],
    workouts: { "0:Push": [{ id: "e1", name: "Bench Press", sets: [{ type: "working", reps: "5" }] }] },
    extraWorkouts: ["Extra A"],
  };
  const pRow: ProgramRow = { ...programToRow(p, "user-1"), id: "uuid-p", created_at: "t", updated_at: "t" };
  eq(pRow.start_date, "2026-01-01", "program start_date -> YMD");
  eq(programFromRow(pRow), p, "program row round-trip");

  const w: CompletedWorkout = {
    id: "uuid-w", date: "2026-02-02", completedAt: "2026-02-02T10:00:00.000Z",
    workoutName: "Push", durationSeconds: 3600,
    exercises: [{ name: "Bench Press", notes: "", sets: [{ type: "working", weight: "100", reps: "5", done: true }] }],
    sessionNotes: "felt good", programId: "uuid-p",
  };
  const wRow: WorkoutRow = { ...workoutToRow(w, "user-1", "uuid-p"), id: "uuid-w", created_at: "t", updated_at: "t" };
  eq(workoutFromRow(wRow), w, "workout row round-trip (with program)");

  const free: CompletedWorkout = { ...w, id: "uuid-f", programId: "" };
  const freeRow: WorkoutRow = { ...workoutToRow(free, "user-1", null), id: "uuid-f", created_at: "t", updated_at: "t" };
  eq(freeRow.program_id, null, "free workout -> program_id null");
  eq(workoutFromRow(freeRow).programId, "", "free workout program_id null -> ''");

  const j: JournalEntry = { id: "uuid-j", title: "T", body: "B", createdAt: "2026-01-01T00:00:00.000Z" };
  const jRow: JournalRow = { ...journalToRow(j, "user-1"), id: "uuid-j", updated_at: "t" };
  eq(journalFromRow(jRow), j, "journal row round-trip");

  const c: CustomExercise = { name: "My Curl", muscles: ["Arms"], imageUri: "file://x", videoUri: undefined, description: "desc" };
  const cRow: CustomExerciseRow = { ...customToRow(c, "user-1"), id: "uuid-c", created_at: "t", updated_at: "t" };
  eq(customFromRow(cRow), c, "custom exercise row round-trip");
}

// ── toReplaceUserDataPayload: program_index linkage for the atomic push RPC ─────
{
  const progs: SavedProgram[] = [
    { id: "local-A", name: "A", totalWeeks: 8, currentWeek: 1, status: "active",
      startDate: "01 Jan 2026", trainingDays: 3, cycleDays: 7,
      cyclePattern: ["Push", "Rest"], workouts: {} },
    { id: "local-B", name: "B", totalWeeks: 8, currentWeek: 1, status: "completed",
      startDate: "01 Feb 2026", trainingDays: 3, cycleDays: 7,
      cyclePattern: ["Pull", "Rest"], workouts: {} },
  ];
  const mkW = (id: string, programId: string | undefined): CompletedWorkout => ({
    id, date: "2026-02-02", completedAt: "2026-02-02T10:00:00.000Z",
    workoutName: "Push", durationSeconds: 0,
    exercises: [{ name: "Bench", notes: "", sets: [{ type: "working", weight: "100", reps: "5", done: true }] }],
    ...(programId !== undefined ? { programId } : {}),
  });
  const history: CompletedWorkout[] = [
    mkW("w-A", "local-A"),   // -> index 0
    mkW("w-B", "local-B"),   // -> index 1
    mkW("w-free", ""),       // free workout -> null
    mkW("w-legacy", undefined), // legacy (no programId) -> null
    mkW("w-ghost", "gone"),  // references a program not in the list -> null
  ];
  const payload = toReplaceUserDataPayload(progs, history, [], [], "user-1");
  eq(payload.p_programs.length, 2, "replacePayload: program count");
  eq(payload.p_programs[0].start_date, "2026-01-01", "replacePayload: start_date converted to YMD");
  eq(payload.p_workouts.map(w => w.program_index), [0, 1, null, null, null], "replacePayload: program_index resolves by array position; free/legacy/missing -> null");
  // The uuid-only program_id must NOT leak into the payload (server uses program_index).
  check(!("program_id" in (payload.p_workouts[0] as object)), "replacePayload: program_id stripped from workout payload");
}

// ── units: kg-canonical display / input conversion ─────────────────────────────
eq(trimNumber(100, 1), "100", "trimNumber: whole");
eq(trimNumber(100.5, 1), "100.5", "trimNumber: 1dp");
eq(trimNumber(99.999999, 1), "100", "trimNumber: rounds up");
eq(trimNumber(0, 1), "0", "trimNumber: zero");

// kg mode is a passthrough lens (no value change for kg loggers).
eq(formatWeightForDisplay("100", true), "100", "display kg: as-is");
eq(parseWeightToKg("100", true), "100", "input kg: as-is");

// lb mode: stored kg shows as lb, typed lb stores as kg.
eq(formatWeightForDisplay("100", false), "220.5", "display lb: 100kg -> 220.5lb");
eq(parseWeightToKg("225", false), trimNumber(225 * KG_PER_LB, 3), "input lb: 225lb -> kg");

// The property that prevents drift: typing a clean lb value and showing it back
// must round-trip to the same number.
for (const lb of ["45", "100", "135", "225", "315", "100.5"]) {
  const storedKg = parseWeightToKg(lb, false);
  eq(formatWeightForDisplay(storedKg, false), trimNumber(parseFloat(lb), 1), `lb round-trip: ${lb} -> kg -> ${lb}`);
}

// Bodyweight / empty pass through untouched in every direction.
for (const bw of ["BW", "", "—"]) {
  eq(formatWeightForDisplay(bw, false), bw, `display passthrough: "${bw}"`);
  eq(parseWeightToKg(bw, false), bw, `input passthrough: "${bw}"`);
  eq(migrateWeightLbToKg(bw), bw, `migrate passthrough: "${bw}"`);
}

// Migration: a lb-mode user's stored "225" (really lb) becomes canonical kg,
// and then displays back as 225 lb — their numbers look identical post-migration.
{
  const migrated = migrateWeightLbToKg("225");
  eq(migrated, trimNumber(225 * KG_PER_LB, 3), "migrate: 225 (lb) -> kg");
  eq(formatWeightForDisplay(migrated, false), "225", "migrate then display in lb: unchanged to the user");
}

// ── weight migration transformers (lb → kg) ────────────────────────────────────
{
  const hist: CompletedWorkout[] = [{
    id: "m", date: "2026-05-01", completedAt: "2026-05-01T10:00:00.000Z",
    workoutName: "Push", durationSeconds: 0,
    exercises: [{ name: "Bench", notes: "", sets: [
      { type: "working", weight: "225", reps: "5", done: true },  // lb -> kg
      { type: "working", weight: "BW", reps: "10", done: true },  // passthrough
    ] }],
  }];
  const out = migrateHistoryWeights(hist);
  eq(out[0].exercises[0].sets[0].weight, trimNumber(225 * KG_PER_LB, 3), "migrate history: 225lb -> kg");
  eq(out[0].exercises[0].sets[1].weight, "BW", "migrate history: BW untouched");
  eq(out[0].exercises[0].sets[0].reps, "5", "migrate history: reps untouched");

  const progs: SavedProgram[] = [{
    id: "p", name: "P", totalWeeks: 8, currentWeek: 1, status: "active",
    startDate: "01 Jan 2026", trainingDays: 3, cycleDays: 7,
    cyclePattern: ["Push", "Rest"],
    workouts: { "0:Push": [{ id: "e1", name: "Bench", sets: [
      { type: "working", weightKg: "135", reps: "5" },
      { type: "working" },  // no weightKg -> untouched
    ] }] },
  }];
  const pOut = migrateProgramWeights(progs);
  eq(pOut[0].workouts["0:Push"][0].sets[0].weightKg, trimNumber(135 * KG_PER_LB, 3), "migrate program: 135lb -> kg");
  eq(pOut[0].workouts["0:Push"][0].sets[1].weightKg, undefined, "migrate program: missing weightKg untouched");
}

// ── day ids: normalization ─────────────────────────────────────────────────────
{
  eq(normalizeDayIds(undefined, 4), ["d0", "d1", "d2", "d3"], "dayIds: legacy program gets deterministic positional ids");
  eq(normalizeDayIds(["a", "b"], 4).slice(0, 2), ["a", "b"], "dayIds: existing entries preserved when growing");
  eq(normalizeDayIds(["a", "b", "c", "d"], 2), ["a", "b"], "dayIds: trimmed when the cycle shrinks");
  const grown = normalizeDayIds(["a", "b"], 3);
  check(grown[2] !== "a" && grown[2] !== "b" && grown.length === 3, "dayIds: new slot gets a distinct id");
  // A reorder that lands a real id in the position whose positional id is taken
  // must not hand out a duplicate.
  const reordered = normalizeDayIds(["d1", undefined as unknown as string, "d0"], 3);
  check(new Set(reordered).size === 3, "dayIds: gap fill never duplicates an existing id");
  eq(dayIdAt({ dayIds: undefined }, 3), "d3", "dayIdAt: falls back to the positional id");
  eq(dayIdAt({ dayIds: ["x", "y"] }, 1), "y", "dayIdAt: uses the stored id");
}

// ── day keys: rename must not drop a day's exercises ───────────────────────────
// The builder's map is keyed `${index}:${label}`, so renaming a day changes its
// key. Every reload/save path re-keys through canonicalizeWorkouts, which
// carries exercises across by cycle INDEX — looking the new key up directly is
// what used to empty a renamed day.
{
  const bench = [{ id: "e1", name: "Bench", sets: [{ type: "working" as const }] }];
  const squat = [{ id: "e2", name: "Squat", sets: [{ type: "working" as const }] }];
  const before = { "0:Upper": bench, "1:Lower": squat };
  const isTraining = [true, true];

  // Both days renamed at once — the exact case that lost them.
  const renamed = canonicalizeWorkouts(before, ["Upper A", "Lower B"], isTraining);
  eq(Object.keys(renamed).sort(), ["0:Upper A", "1:Lower B"], "canonicalize: keys follow the new names");
  eq(renamed["0:Upper A"], bench, "canonicalize: renamed day keeps its exercises");
  eq(renamed["1:Lower B"], squat, "canonicalize: the other renamed day keeps its own");

  // Two days renamed to the SAME name stay separate — the index disambiguates.
  const twins = canonicalizeWorkouts(before, ["Upper", "Upper"], isTraining);
  eq(twins["0:Upper"], bench, "canonicalize: first same-named day keeps its exercises");
  eq(twins["1:Upper"], squat, "canonicalize: second same-named day is not merged into the first");

  // Turning a day into Rest drops it; an unnamed training day is keyed "Workout".
  eq(Object.keys(canonicalizeWorkouts(before, ["Upper", "Lower"], [true, false])), ["0:Upper"], "canonicalize: a day switched to Rest leaves the map");
  eq(Object.keys(canonicalizeWorkouts(before, ["", "Lower"], isTraining)), ["0:Workout", "1:Lower"], "canonicalize: unnamed training day keyed 'Workout'");
  eq(canonicalizeWorkouts({}, ["Upper"], [true]), { "0:Upper": [] }, "canonicalize: a brand-new day starts empty");
  // A malformed key can't poison the carry-over.
  eq(canonicalizeWorkouts({ "junk": bench }, ["Upper"], [true]), { "0:Upper": [] }, "canonicalize: malformed keys are skipped, not re-keyed");

  eq(trainingDayKeys(["Push", "", "Pull"], [true, false, true]), ["0:Push", "2:Pull"], "trainingDayKeys: rest days skipped, index preserved");
  eq(dayLabel("3:Push"), "Push", "dayLabel: strips the index");
  eq(dayLabel("3:A:B"), "A:B", "dayLabel: a label containing ':' round-trips");
  eq(parseDayKey("3:A:B"), { idx: 3, label: "A:B" }, "parseDayKey: splits on the first colon only");
  eq(parseDayKey("x:Push"), null, "parseDayKey: non-numeric index -> null");
  eq(parseDayKey(":Push"), null, "parseDayKey: missing index -> null");
}

// ── day ids: forking a day whose identity changed mid-program ──────────────────
// Editing a running program must not silently pool two different workouts into
// one trend, nor split a day that only moved or only got a new label. A day
// forks (new id, old sessions become a historical day) ONLY when its name AND
// its exercise list both changed.
{
  const bench = [{ id: "e1", name: "Bench", sets: [{ type: "working" as const }] }];
  const incline = [{ id: "e2", name: "Incline Press", sets: [{ type: "working" as const }] }];
  const squat = [{ id: "e3", name: "Squat", sets: [{ type: "working" as const }] }];
  type DaySnapshot = { cyclePattern: string[]; dayIds: string[]; workouts: WorkoutMap };
  const before: DaySnapshot = {
    cyclePattern: ["Upper", "Lower", "Rest"],
    dayIds: ["d0", "d1", "d2"],
    workouts: { "0:Upper": bench, "1:Lower": squat },
  };
  const fork = (after: DaySnapshot) => forkChangedDayIds(before, after);

  // Nothing changed at all.
  eq(fork(before), ["d0", "d1", "d2"], "fork: an untouched program keeps every id");

  // Renamed only — same workout, new label. One continuous trend.
  eq(
    fork({ ...before, cyclePattern: ["Upper A", "Lower", "Rest"], workouts: { "0:Upper A": bench, "1:Lower": squat } }),
    ["d0", "d1", "d2"],
    "fork: rename alone does NOT fork",
  );

  // Exercises swapped only — normal in-program tuning, stays one day.
  eq(
    fork({ ...before, workouts: { "0:Upper": incline, "1:Lower": squat } }),
    ["d0", "d1", "d2"],
    "fork: swapping exercises alone does NOT fork",
  );

  // Sets/reps/weight edited under the same names — programming, not a new day.
  eq(
    fork({
      ...before,
      cyclePattern: ["Upper A", "Lower", "Rest"],
      workouts: {
        "0:Upper A": [{ id: "e1", name: "Bench", sets: [{ type: "working" as const, reps: "5" }, { type: "working" as const }] }],
        "1:Lower": squat,
      },
    }),
    ["d0", "d1", "d2"],
    "fork: rename + set/rep edits (same exercises) does NOT fork",
  );

  // Moved to another slot, carrying its id and exercises — the Progress page
  // does not care which cycle day a session fell on.
  eq(
    fork({
      cyclePattern: ["Lower", "Upper", "Rest"],
      dayIds: ["d1", "d0", "d2"],
      workouts: { "0:Lower": squat, "1:Upper": bench },
    }),
    ["d1", "d0", "d2"],
    "fork: moving a day to another slot does NOT fork",
  );

  // Renamed AND re-stocked → forks. Only that day; the untouched one is stable.
  {
    const out = fork({
      ...before,
      cyclePattern: ["Upper A", "Lower", "Rest"],
      workouts: { "0:Upper A": incline, "1:Lower": squat },
    });
    check(out[0] !== "d0", "fork: rename + exercise change mints a new id");
    eq(out.slice(1), ["d1", "d2"], "fork: only the changed day forks");
  }

  // Adding an exercise counts as an exercise change (the chosen threshold).
  {
    const out = fork({
      ...before,
      cyclePattern: ["Upper A", "Lower", "Rest"],
      workouts: { "0:Upper A": [...bench, ...incline], "1:Lower": squat },
    });
    check(out[0] !== "d0", "fork: rename + an added exercise forks");
  }

  // A slot that didn't exist before has nothing to fork from.
  eq(
    forkChangedDayIds(before, {
      cyclePattern: ["Upper", "Lower", "Arms"],
      dayIds: ["d0", "d1", "brand-new"],
      workouts: { "0:Upper": bench, "1:Lower": squat, "2:Arms": incline },
    }),
    ["d0", "d1", "brand-new"],
    "fork: a newly added day keeps the id it was given",
  );
}

// ── day ids: history backfill ──────────────────────────────────────────────────
// The rename case the whole feature exists for: a cycle ran "Upper" on days 0
// and 4, sessions were logged under that name, then the days were renamed to
// "Upper A" / "Upper B". No day still carries the logged name, so each session
// is attributed by the cycle math for the date it was performed on.
{
  const renamed = makeProgram({
    id: "pR",
    startDate: "01 Jan 2026",
    cyclePattern: ["Upper A", "Lower", "Rest", "Rest", "Upper B", "Rest", "Rest"],
    dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
    workouts: {},
  });
  const hist: CompletedWorkout[] = [
    // 01 Jan 2026 is cycle day 0 -> "Upper A"
    { id: "h1", date: "2026-01-01", completedAt: "2026-01-01T10:00:00.000Z", workoutName: "Upper", durationSeconds: 0, exercises: [], programId: "pR" },
    // 05 Jan 2026 is cycle day 4 -> "Upper B"
    { id: "h2", date: "2026-01-05", completedAt: "2026-01-05T10:00:00.000Z", workoutName: "Upper", durationSeconds: 0, exercises: [], programId: "pR" },
    // Name still matches exactly one slot -> that slot wins over the date.
    { id: "h3", date: "2026-01-05", completedAt: "2026-01-05T11:00:00.000Z", workoutName: "Lower", durationSeconds: 0, exercises: [], programId: "pR" },
    // Free workout: no slot to point at.
    { id: "h4", date: "2026-01-06", completedAt: "2026-01-06T10:00:00.000Z", workoutName: "Upper", durationSeconds: 0, exercises: [], programId: "" },
    // Already attributed: left exactly as-is.
    { id: "h5", date: "2026-01-01", completedAt: "2026-01-01T12:00:00.000Z", workoutName: "Upper", durationSeconds: 0, exercises: [], programId: "pR", dayId: "d4" },
  ];
  const out = backfillHistoryDayIds(hist, [renamed]);
  eq(out.map(w => w.dayId), ["d0", "d4", "d1", undefined, "d4"], "backfill: renamed days attributed by date, names by name, free workouts skipped");
  eq(out[3], hist[3], "backfill: an unattributable record is returned untouched");

  // A hold placed on the program afterwards must not un-attribute its history.
  const held = { ...renamed, pausedAt: "2026-01-02" };
  eq(resolveHistoricDayId(hist[1], held), "d4", "backfill: a later hold doesn't erase which day a session was performed on");

  // Two slots that still share the name: the date breaks the tie.
  const twins = makeProgram({
    id: "pT",
    cyclePattern: ["Upper", "Lower", "Rest", "Rest", "Upper", "Rest", "Rest"],
    dayIds: ["d0", "d1", "d2", "d3", "d4", "d5", "d6"],
    workouts: {},
  });
  eq(resolveHistoricDayId({ ...hist[1], programId: "pT" }, twins), "d4", "backfill: same-named slots disambiguated by the session's date");
  // Off-schedule session (that date is a Rest slot) falls back to the first match.
  eq(resolveHistoricDayId({ ...hist[1], date: "2026-01-03", programId: "pT" }, twins), "d0", "backfill: off-schedule same-named session lands on the first slot");

  // Programs without ids get the deterministic set, and one that has them is untouched.
  const [filled] = assignProgramDayIds([makeProgram({ dayIds: undefined })]);
  eq(filled.dayIds, ["d0", "d1", "d2", "d3", "d4", "d5", "d6"], "assignProgramDayIds: fills a legacy program");
  check(assignProgramDayIds([renamed])[0] === renamed, "assignProgramDayIds: a complete program is returned by identity");
}

// ── report ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error("  ✗ " + f);
  throw new Error(`${failures.length} data-layer assertion(s) failed`);
}
console.log("✓ data-layer invariants hold");
