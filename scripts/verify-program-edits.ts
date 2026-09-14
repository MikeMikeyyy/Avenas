// Editing a program that's already running must not disturb what has already
// been logged. This suite pins that down for the edits users actually make:
// reordering exercises on a day, swapping an exercise out, doing both, renaming,
// and dragging a day to another cycle slot.
//
// For each edit it checks the whole chain the four interlinked pages read:
//   - the day's stable id (kept, or forked per the documented rule)
//   - the exercises still filed under the day after the save re-keys the map
//   - history still matching the day  (workoutMatchesDay)
//   - previous values on the Workout screen (buildPrevByName)
//   - the per-exercise trend and the day's logged-exercise rows (Progress)
//   - the logged sessions themselves, byte for byte (Journal reads these)
//
// Run:  npx tsx scripts/verify-program-edits.ts
// Exits non-zero (throws) if any assertion fails.

import {
  canonicalizeWorkouts,
  forkChangedDayIds,
  normalizeDayIds,
  programDays,
  reorderCycleSlots,
  workoutKey,
} from "../utils/programDays";
import { buildPrevByName, prevDayScopeFor } from "../utils/workout";
import {
  collectExerciseHistory,
  collectLoggedExercisesForDay,
  sessionCountForDay,
  workoutMatchesDay,
} from "../utils/progressStats";
import type {
  CompletedWorkout,
  Exercise,
  SavedProgram,
  WorkoutMap,
} from "../constants/programs";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
function ok(cond: boolean, label: string) { eq(cond, true, label); }

// ─── fixture: a running program with two same-named "Upper" days ──────────────

const ex = (id: string, name: string): Exercise => ({
  id, name, sets: [{ type: "working", reps: "8" }],
});

const UPPER_A = 0; // cycle slot 0, dayId d0
const UPPER_B = 3; // cycle slot 3, dayId d3

const baseCycle = ["Upper", "Lower", "Rest", "Upper", "Lower", "Rest"];
const baseTraining = [true, true, false, true, true, false];
const baseWorkouts: WorkoutMap = {
  "0:Upper": [ex("a1", "Bench Press"), ex("a2", "Barbell Row"), ex("a3", "Curl")],
  "1:Lower": [ex("b1", "Squat")],
  "3:Upper": [ex("c1", "Incline Press"), ex("c2", "Lat Pulldown"), ex("c3", "Curl")],
  "4:Lower": [ex("d1", "Deadlift")],
};

const program: SavedProgram = {
  id: "P", name: "Upper/Lower", totalWeeks: 8, currentWeek: 2, status: "active",
  startDate: "01 Jul 2026", trainingDays: 4, cycleDays: 6,
  cyclePattern: [...baseCycle],
  dayIds: normalizeDayIds(undefined, 6), // d0…d5
  workouts: JSON.parse(JSON.stringify(baseWorkouts)),
};

const set = (w: string, r: string) => ({ type: "working" as const, weight: w, reps: r, done: true });
const session = (
  id: string, date: string, dayId: string, exs: [string, string, string][],
): CompletedWorkout => ({
  id, date, completedAt: `${date}T10:00:00.000Z`,
  workoutName: "Upper", durationSeconds: 3600, programId: "P", dayId,
  exercises: exs.map(([name, w, r]) => ({ name, notes: "", sets: [set(w, r)] })),
});

const history: CompletedWorkout[] = [
  session("s4", "2026-07-18", "d3", [["Incline Press", "42", "8"], ["Lat Pulldown", "52", "10"], ["Curl", "24", "12"]]),
  session("s3", "2026-07-15", "d0", [["Bench Press", "102", "5"], ["Barbell Row", "62", "10"], ["Curl", "20", "12"]]),
  session("s2", "2026-07-11", "d3", [["Incline Press", "40", "8"], ["Lat Pulldown", "50", "10"], ["Curl", "22", "12"]]),
  session("s1", "2026-07-08", "d0", [["Bench Press", "100", "5"], ["Barbell Row", "60", "10"], ["Curl", "20", "12"]]),
];
// The Journal renders logged sessions verbatim. Snapshot it up front so every
// edit below can assert nothing rewrote a single field.
const historyBefore = JSON.stringify(history);

// ─── the builder's save, exactly as new-program.tsx:handleFinish does it ──────

type Edit = {
  cyclePattern?: string[];
  isTrainingDay?: boolean[];
  dayIds?: string[];
  workouts?: WorkoutMap;
};

/** Apply an edit to `program` through the real save pipeline and return the
 *  program that would be written to storage. */
function save(base: SavedProgram, edit: Edit): SavedProgram {
  const cyclePattern = edit.cyclePattern ?? base.cyclePattern;
  const isTrainingDay = edit.isTrainingDay ?? cyclePattern.map(n => n !== "Rest");
  const workouts = edit.workouts ?? base.workouts;
  const dayIds = edit.dayIds ?? base.dayIds!;

  const savedCyclePattern = cyclePattern.map((n, i) => isTrainingDay[i] ? (n.trim() || "Workout") : "Rest");
  const savedWorkouts = canonicalizeWorkouts(workouts, cyclePattern, isTrainingDay);
  const savedDayIds = forkChangedDayIds(
    { cyclePattern: base.cyclePattern, dayIds: base.dayIds!, workouts: base.workouts },
    {
      cyclePattern: savedCyclePattern,
      dayIds: normalizeDayIds(dayIds, savedCyclePattern.length),
      workouts: savedWorkouts,
    },
  );
  return { ...base, cyclePattern: savedCyclePattern, dayIds: savedDayIds, workouts: savedWorkouts };
}

const names = (p: SavedProgram, slot: number) =>
  (p.workouts[workoutKey(slot, p.cyclePattern[slot])] ?? []).map(e => e.name);
const refFor = (p: SavedProgram, dayId: string) =>
  programDays(p).find(d => d.dayId === dayId);

/**
 * Everything downstream of an edit that must survive it, for Upper B.
 * `slot` is where Upper B now sits; `expectAttached` is false only when the day
 * was deliberately forked away from its history.
 */
function checkUpperB(label: string, after: SavedProgram, slot: number, expectAttached = true) {
  const dayId = after.dayIds![slot];
  const ref = refFor(after, dayId);
  ok(!!ref, `${label}: Upper B is still a day of the program`);
  if (!ref) return;

  const scope = prevDayScopeFor(
    { name: ref.label, programId: after.id, dayId: ref.dayId },
    after,
  );
  const prev = buildPrevByName(history, undefined, scope);
  const matched = history.filter(w => workoutMatchesDay(w, ref));

  if (expectAttached) {
    eq(matched.map(w => w.id), ["s4", "s2"], `${label}: both Upper B sessions still match the day`);
    eq(sessionCountForDay(history, ref), 2, `${label}: session count intact`);
    eq(prev["incline press"], ["42×8"], `${label}: prev is Upper B's own last numbers`);
    eq(prev["curl"], ["24×12"], `${label}: prev for an exercise on BOTH days stays Upper B's`);
    eq(
      collectExerciseHistory(history, "Incline Press", ref).map(p => p.date),
      ["2026-07-11", "2026-07-18"],
      `${label}: per-exercise trend keeps both sessions`,
    );
  } else {
    eq(matched.map(w => w.id), [], `${label}: forked day starts with no sessions`);
    eq(prev["incline press"], undefined, `${label}: forked day has no previous values yet`);
  }

  // Upper A must be untouched by anything done to Upper B.
  const refA = refFor(after, "d0");
  ok(!!refA, `${label}: Upper A still present`);
  if (refA) {
    eq(
      history.filter(w => workoutMatchesDay(w, refA)).map(w => w.id),
      ["s3", "s1"],
      `${label}: Upper A keeps its own sessions`,
    );
    const prevA = buildPrevByName(history, undefined, prevDayScopeFor(
      { name: refA.label, programId: after.id, dayId: refA.dayId }, after,
    ));
    eq(prevA["bench press"], ["102×5"], `${label}: Upper A prev untouched`);
    eq(prevA["curl"], ["20×12"], `${label}: Upper A's Curl is its own, not Upper B's`);
  }

  eq(JSON.stringify(history), historyBefore, `${label}: logged sessions byte-identical (Journal)`);
}

// ─── A. reorder exercises on Upper B ─────────────────────────────────────────
{
  const edit: Edit = {
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c2", "Lat Pulldown"), ex("c3", "Curl"), ex("c1", "Incline Press")],
    },
  };
  const after = save(program, edit);
  eq(after.dayIds![UPPER_B], "d3", "A reorder exercises: dayId kept (not a different workout)");
  eq(names(after, UPPER_B), ["Lat Pulldown", "Curl", "Incline Press"], "A reorder exercises: new order saved");
  eq(names(after, UPPER_A), ["Bench Press", "Barbell Row", "Curl"], "A reorder exercises: Upper A untouched");
  checkUpperB("A reorder exercises", after, UPPER_B);
  const rows = collectLoggedExercisesForDay(history, refFor(after, "d3")!);
  eq(rows.map(r => r.name).sort(), ["Curl", "Incline Press", "Lat Pulldown"], "A reorder exercises: every logged exercise still listed");
  eq(rows.every(r => r.inProgram), true, "A reorder exercises: nothing reads as swapped out");
}

// ─── B. swap one exercise out on Upper B ─────────────────────────────────────
{
  const edit: Edit = {
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c1", "Incline Press"), ex("c4", "Cable Row"), ex("c3", "Curl")],
    },
  };
  const after = save(program, edit);
  eq(after.dayIds![UPPER_B], "d3", "B swap exercise: dayId kept (re-stocking alone never forks)");
  eq(names(after, UPPER_B), ["Incline Press", "Cable Row", "Curl"], "B swap exercise: new exercise saved");
  checkUpperB("B swap exercise", after, UPPER_B);

  const rows = collectLoggedExercisesForDay(history, refFor(after, "d3")!);
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  eq(byName["Lat Pulldown"]?.inProgram, false, "B swap exercise: dropped exercise flagged Swapped out");
  eq(byName["Lat Pulldown"]?.lastWeight, "52", "B swap exercise: dropped exercise keeps its logged numbers");
  eq(byName["Lat Pulldown"]?.sessionCount, 2, "B swap exercise: dropped exercise keeps its session count");
  eq(byName["Incline Press"]?.inProgram, true, "B swap exercise: kept exercise still in program");
  eq(
    collectExerciseHistory(history, "Lat Pulldown", refFor(after, "d3")!).length,
    2,
    "B swap exercise: dropped exercise's trend is still readable",
  );
  // The exercise swapped IN has no history on this day, so it shows nothing
  // rather than borrowing the other Upper day's numbers.
  const scope = prevDayScopeFor({ name: "Upper", programId: "P", dayId: "d3" }, after);
  eq(buildPrevByName(history, undefined, scope)["cable row"], undefined, "B swap exercise: new exercise has no prev yet");
}

// ─── C. reorder AND swap on Upper B ──────────────────────────────────────────
{
  const edit: Edit = {
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c3", "Curl"), ex("c4", "Cable Row"), ex("c1", "Incline Press")],
    },
  };
  const after = save(program, edit);
  eq(after.dayIds![UPPER_B], "d3", "C reorder + swap: dayId kept (name unchanged)");
  eq(names(after, UPPER_B), ["Curl", "Cable Row", "Incline Press"], "C reorder + swap: both changes saved");
  checkUpperB("C reorder + swap", after, UPPER_B);
  const byName = Object.fromEntries(
    collectLoggedExercisesForDay(history, refFor(after, "d3")!).map(r => [r.name, r]),
  );
  eq(byName["Lat Pulldown"]?.inProgram, false, "C reorder + swap: dropped exercise still flagged");
  eq(byName["Incline Press"]?.inProgram, true, "C reorder + swap: moved exercise not mistaken for dropped");
}

// ─── D. rename Upper B only ──────────────────────────────────────────────────
{
  const after = save(program, { cyclePattern: ["Upper", "Lower", "Rest", "Upper B", "Lower", "Rest"] });
  eq(after.dayIds![UPPER_B], "d3", "D rename only: dayId kept");
  eq(names(after, UPPER_B), ["Incline Press", "Lat Pulldown", "Curl"], "D rename only: exercises carried onto the new key");
  eq(after.workouts["3:Upper"], undefined, "D rename only: old key is gone, not duplicated");
  checkUpperB("D rename only", after, UPPER_B);
  eq(refFor(after, "d3")!.label, "Upper B", "D rename only: the day now shows its new label");
}

// ─── E. rename AND swap -> the one documented fork ───────────────────────────
{
  const after = save(program, {
    cyclePattern: ["Upper", "Lower", "Rest", "Upper B", "Lower", "Rest"],
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c1", "Incline Press"), ex("c4", "Cable Row"), ex("c3", "Curl")],
    },
  });
  ok(after.dayIds![UPPER_B] !== "d3", "E rename + swap: a new dayId is minted");
  eq(names(after, UPPER_B), ["Incline Press", "Cable Row", "Curl"], "E rename + swap: exercises still carried by index");
  checkUpperB("E rename + swap", after, UPPER_B, false);
  // The old day survives as a historical row rather than losing its sessions.
  eq(
    history.filter(w => w.dayId === "d3").map(w => w.id),
    ["s4", "s2"],
    "E rename + swap: the old day's sessions keep pointing at d3",
  );
}

// ─── F. rename AND reorder (no exercise added or removed) -> no fork ─────────
{
  const after = save(program, {
    cyclePattern: ["Upper", "Lower", "Rest", "Upper B", "Lower", "Rest"],
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c3", "Curl"), ex("c1", "Incline Press"), ex("c2", "Lat Pulldown")],
    },
  });
  eq(after.dayIds![UPPER_B], "d3", "F rename + reorder: reordering is not an exercise change, so no fork");
  eq(names(after, UPPER_B), ["Curl", "Incline Press", "Lat Pulldown"], "F rename + reorder: order saved under the new label");
  checkUpperB("F rename + reorder", after, UPPER_B);
}

// ─── G. drag Upper B to another cycle slot ───────────────────────────────────
{
  // Upper B (slot 3) dragged to slot 1: cycle becomes Upper, Upper B, Lower, Rest, Lower, Rest.
  const moved = reorderCycleSlots(3, 1, {
    cyclePattern: program.cyclePattern,
    isTrainingDay: baseTraining,
    dayIds: program.dayIds!,
    workouts: program.workouts,
  });
  eq(moved.cyclePattern, ["Upper", "Upper", "Lower", "Rest", "Lower", "Rest"], "G move day: cycle reordered");
  eq(moved.dayIds, ["d0", "d3", "d1", "d2", "d4", "d5"], "G move day: ids travel with their day");
  eq(moved.isTrainingDay, [true, true, true, false, true, false], "G move day: Training/Rest flags travel too");
  eq(moved.workouts["1:Upper"]?.map(e => e.name), ["Incline Press", "Lat Pulldown", "Curl"], "G move day: exercises re-keyed onto the new slot");
  eq(moved.workouts["2:Lower"]?.map(e => e.name), ["Squat"], "G move day: the days it displaced kept theirs");

  const after = save(program, moved);
  eq(after.dayIds![1], "d3", "G move day: dayId survives the save");
  checkUpperB("G move day", after, 1);
  eq(refFor(after, "d3")!.index, 1, "G move day: the day reports its new cycle position");
}

// ─── H. move a day AND re-stock it in the same edit ──────────────────────────
{
  const moved = reorderCycleSlots(3, 1, {
    cyclePattern: program.cyclePattern,
    isTrainingDay: baseTraining,
    dayIds: program.dayIds!,
    workouts: program.workouts,
  });
  const after = save(program, {
    ...moved,
    workouts: {
      ...moved.workouts,
      "1:Upper": [ex("c4", "Cable Row"), ex("c1", "Incline Press"), ex("c3", "Curl")],
    },
  });
  eq(after.dayIds![1], "d3", "H move + swap: dayId kept (moving isn't a rename)");
  eq(names(after, 1), ["Cable Row", "Incline Press", "Curl"], "H move + swap: new exercises on the new slot");
  checkUpperB("H move + swap", after, 1);
  const byName = Object.fromEntries(
    collectLoggedExercisesForDay(history, refFor(after, "d3")!).map(r => [r.name, r]),
  );
  eq(byName["Lat Pulldown"]?.inProgram, false, "H move + swap: dropped exercise flagged on the moved day");
}

// ─── I. reorder is reversible and never invents ids ──────────────────────────
{
  const cycle = {
    cyclePattern: program.cyclePattern,
    isTrainingDay: baseTraining,
    dayIds: program.dayIds!,
    workouts: program.workouts,
  };
  const there = reorderCycleSlots(3, 1, cycle);
  const back = reorderCycleSlots(1, 3, there);
  eq(back.cyclePattern, cycle.cyclePattern, "I reorder round-trip: cycle restored");
  eq(back.dayIds, cycle.dayIds, "I reorder round-trip: ids restored");
  eq(back.workouts, cycle.workouts, "I reorder round-trip: workouts map restored");
  eq(reorderCycleSlots(2, 2, cycle).dayIds, cycle.dayIds, "I reorder no-op: unchanged");
  eq(reorderCycleSlots(0, 9, cycle).dayIds, cycle.dayIds, "I reorder out of range: unchanged");
  eq(new Set(there.dayIds).size, there.dayIds.length, "I reorder: ids stay unique");
}

// ─── J. a mid-session swap/reorder is a session edit, never a program edit ───
{
  // The Workout screen mutates only its in-memory workoutInfo, and the finished
  // session records what was actually performed. The program is not rewritten,
  // and the Journal reads the session, so it shows the swap.
  const performed: CompletedWorkout = {
    id: "s5", date: "2026-07-22", completedAt: "2026-07-22T10:00:00.000Z",
    workoutName: "Upper", durationSeconds: 3600, programId: "P", dayId: "d3",
    exercises: [
      { name: "Curl", notes: "", sets: [set("26", "12")] },            // reordered to first
      { name: "Machine Row", notes: "", sets: [set("55", "10")] },     // swapped in for Lat Pulldown
      { name: "Incline Press", notes: "", sets: [set("44", "8")] },
    ],
  };
  const withSession = [performed, ...history];
  const ref = refFor(program, "d3")!;
  eq(
    collectLoggedExercisesForDay(withSession, ref).find(r => r.name === "Machine Row")?.inProgram,
    false,
    "J mid-session swap: the substitute is logged and flagged as not programmed",
  );
  eq(
    withSession[0].exercises.map(e => e.name),
    ["Curl", "Machine Row", "Incline Press"],
    "J mid-session reorder: the Journal entry lists exercises in the order performed",
  );
  eq(
    names(program, UPPER_B),
    ["Incline Press", "Lat Pulldown", "Curl"],
    "J mid-session swap: the program itself is untouched",
  );
  const scope = prevDayScopeFor({ name: "Upper", programId: "P", dayId: "d3" }, program);
  eq(buildPrevByName(withSession, undefined, scope)["incline press"], ["44×8"], "J mid-session: next time prev comes from the session just logged");
  eq(buildPrevByName(withSession, undefined, scope)["machine row"], ["55×10"], "J mid-session: the substitute now has prev on this day");
}

// ─── K. an edit never moves the program's own progress ───────────────────────
{
  // new-program.tsx:handleFinish (edit mode) spreads the stored program and
  // overwrites only name/weeks/cycle/dayIds/workouts. Everything that decides
  // WHERE in the cycle the user is, and how far through the program, is carried
  // through untouched — editing a running program must not restart it.
  const running: SavedProgram = {
    ...program,
    startDate: "01 Jul 2026", currentWeek: 3, status: "active",
    cycleOffset: 2, extraWorkouts: ["Sunday Conditioning"], pausedAt: "2026-07-20",
  };
  const after = save(running, {
    cyclePattern: ["Upper", "Lower", "Rest", "Upper B", "Lower", "Rest"],
    workouts: {
      ...running.workouts,
      "3:Upper": [ex("c3", "Curl"), ex("c1", "Incline Press"), ex("c2", "Lat Pulldown")],
    },
  });
  eq(after.startDate, "01 Jul 2026", "K edit: startDate untouched (the cycle doesn't restart)");
  eq(after.currentWeek, 3, "K edit: week counter untouched");
  eq(after.status, "active", "K edit: status untouched");
  eq(after.cycleOffset, 2, "K edit: cycleOffset untouched (day alignment holds)");
  eq(after.pausedAt, "2026-07-20", "K edit: an active hold survives the edit");
  eq(after.extraWorkouts, ["Sunday Conditioning"], "K edit: attached free workouts survive");
  eq(after.id, "P", "K edit: same program, not a new one");
}

// ─── L. the trainer's view of a client's day ─────────────────────────────────
{
  // app/trainer/client/[id].tsx renders the SAME <ProgressView> the user's own
  // Progress tab does, over ClientData.{workoutHistory, programs}. So "does the
  // trainer see what the client logged" reduces to: were they handed both halves?
  //
  // Client swapped Lat Pulldown out for Cable Row on Upper B, mid-program.
  const clientProgram = save(program, {
    workouts: {
      ...program.workouts,
      "3:Upper": [ex("c1", "Incline Press"), ex("c4", "Cable Row"), ex("c3", "Curl")],
    },
  });
  const day = refFor(clientProgram, "d3")!;

  // Both halves present: the trainer's rows are the client's rows, exactly.
  const trainerRows = collectLoggedExercisesForDay(history, day);
  const byName = Object.fromEntries(trainerRows.map(r => [r.name, r]));
  eq(byName["Incline Press"]?.lastWeight, "42", "L trainer view: current exercise shows the client's last weight");
  eq(byName["Incline Press"]?.lastReps, "8", "L trainer view: ...and reps");
  eq(byName["Lat Pulldown"]?.inProgram, false, "L trainer view: the swapped-out exercise is flagged");
  eq(byName["Lat Pulldown"]?.lastWeight, "52", "L trainer view: the swapped-out exercise keeps its logged numbers");
  eq(byName["Curl"]?.lastWeight, "24", "L trainer view: Upper B's Curl, not Upper A's");
  eq(sessionCountForDay(history, day), 2, "L trainer view: session count matches the client's");

  // The half that is easy to forget. Programs missing (or not yet synced) and
  // the per-day breakdown — the ONLY place "Swapped out" and per-day numbers
  // live — comes back empty, even though every session is still in scope.
  const noPrograms = programDays({ ...clientProgram, cyclePattern: [], dayIds: [], workouts: {} });
  eq(noPrograms, [], "L trainer view: no client programs -> no day rows at all");
  eq(
    history.filter(w => w.programId === "P").length,
    4,
    "L trainer view: ...even though the sessions themselves are still there",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("program-edit invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ program-edit invariants hold");
