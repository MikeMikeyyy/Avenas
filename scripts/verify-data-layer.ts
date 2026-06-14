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
  normalizeExerciseName,
} from "../utils/workout";
import { parseStoredDate, formatStoredDate, todayYMD } from "../utils/dates";
import {
  programToRow, programFromRow,
  workoutToRow, workoutFromRow,
  journalToRow, journalFromRow,
  customToRow, customFromRow,
} from "../lib/mappers";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
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
eq(getWorkoutForDate(p, "2026-01-01"), { dayIndex: 0, name: "Push", exercises: p.workouts["0:Push"] }, "workoutForDate -> Push");
eq(getWorkoutForDate(p, "2026-01-04"), null, "workoutForDate Rest -> null");
eq(getWorkoutForDate(p, "2026-01-03"), { dayIndex: 2, name: "Legs", exercises: [] }, "workoutForDate Legs (empty exercises)");
eq(getWorkoutForDate(makeProgram({ startDate: "nope" }), "2026-01-01"), null, "workoutForDate unparseable -> null");

// ── getTodaysWorkout / resolveTodayWorkout (today-relative) ─────────────────────
const pToday = makeProgram({ startDate: formatStoredDate(new Date()) }); // started today -> dayIndex 0 -> Push
eq(getTodaysWorkout(pToday)?.name, "Push", "getTodaysWorkout (start today) -> Push");
eq(resolveTodayWorkout(pToday, null)?.name, "Push", "resolveToday no override -> Push");
eq(
  resolveTodayWorkout(pToday, { date: todayYMD(), workoutName: "Pull" }),
  { dayIndex: 1, name: "Pull", exercises: pToday.workouts["1:Pull"] },
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
  { dayIndex: 0, name: "Push", exercises: p.workouts["0:Push"] },
  "resolveForDate no override -> scheduled",
);
eq(
  resolveWorkoutForDate(p, { date: "2026-01-01", workoutName: "Pull" }, "2026-01-01"),
  { dayIndex: 1, name: "Pull", exercises: p.workouts["1:Pull"] },
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

// ── report ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error("  ✗ " + f);
  throw new Error(`${failures.length} data-layer assertion(s) failed`);
}
console.log("✓ data-layer invariants hold");
