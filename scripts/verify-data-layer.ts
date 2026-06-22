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
  formatWeightForDisplay, parseWeightToKg, migrateWeightLbToKg, trimNumber,
  KG_PER_LB,
} from "../utils/units";
import { migrateHistoryWeights, migrateProgramWeights } from "../utils/weightMigration";
import {
  programToRow, programFromRow,
  workoutToRow, workoutFromRow,
  journalToRow, journalFromRow,
  customToRow, customFromRow,
  toReplaceUserDataPayload,
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

// ── report ─────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error("  ✗ " + f);
  throw new Error(`${failures.length} data-layer assertion(s) failed`);
}
console.log("✓ data-layer invariants hold");
