// Progress's Custom workouts: the sessions in no program (user request,
// 2026-10-23, after importing a Hevy history that was all free workouts).
//
//   1. Which sessions they are: free workouts, imported ones, a deleted
//      program's (by the rule the workout cards go by), never a program's.
//   2. Their days: one per name, a deleted program's days each their own, the
//      newest first, saying which deleted program they came from; under
//      "All programs" a card of their own after every program's.
//   3. A program's day that shares a name ("Push") never takes them, nor they
//      it; and a pre-program-id session outside every program's dates is one.
//   4. The chart of one of their exercises: its sessions, numbered as the
//      workout cards number them, none missed.
//   5. "See Exercise History" from that chart lists the same sessions, under
//      "Custom workouts · Push", each row saying whose it was.
//   6. Deleting a program keeps its name on its sessions (utils/programDelete.ts),
//      through a restore (which takes their program id away), and the real
//      store does it on a phone, leaving a history it can't read alone.
//
// Run:  npx tsx scripts/verify-custom-workouts.ts
// Exits non-zero if any assertion fails.

import { on, type Phone } from "./harness/app";
import { WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import {
  CUSTOM_GROUP_ID, CUSTOM_WORKOUTS_NAME, collectExerciseHistory, collectLoggedExercisesForDay, filterByProgramScope,
  groupDaysByProgram, isCustomSession, scopedProgramDays, sessionCountForDay, workoutMatchesDay,
} from "../utils/progressStats";
import { exerciseHistoryRows, pickLabel, picksFromHistoryParams, exerciseHistoryOptions } from "../utils/exerciseHistory";
import { buildSessionTracks } from "../utils/sessionTrack";
import { exerciseDaySlots } from "../utils/exerciseDaySlots";
import { keepDeletedProgramName, withDeletedProgramName } from "../utils/programDelete";
import { programDays } from "../utils/programDays";
import { workoutFromRow, workoutToRow } from "../lib/mappers";
import type { WorkoutRow } from "../lib/database.types";

declare const process: { exitCode?: number };

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const ok = (cond: boolean, label: string) => eq(cond, true, label);

// ─── The phone ───────────────────────────────────────────────────────────────

const ex = (name: string) => ({ id: `e_${name}`, name, sets: [{ type: "working" as const, reps: "5" }] });
const STRENGTH: SavedProgram = {
  id: "prog_a", name: "Strength", totalWeeks: 8, currentWeek: 2, status: "active",
  startDate: "31 Aug 2026", trainingDays: 2, cycleDays: 3,
  cyclePattern: ["Push", "Pull", "Rest"], dayIds: ["a0", "a1", "a2"],
  workouts: { "0:Push": [ex("Barbell Bench Press")], "1:Pull": [ex("Barbell Row")] },
};
const OLD_PPL: SavedProgram = {
  id: "prog_b", name: "PPL Old", totalWeeks: 4, currentWeek: 4, status: "completed",
  startDate: "03 Aug 2026", completedDate: "30 Aug 2026", trainingDays: 1, cycleDays: 2,
  cyclePattern: ["Legs", "Rest"], dayIds: ["b0", "b1"],
  workouts: { "0:Legs": [ex("Barbell Back Squat")] },
};

const set = (weight: string, reps = "5") => ({ type: "working" as const, weight, reps, done: true });
const session = (
  id: string, date: string, workoutName: string, programId: string | undefined, dayId: string | undefined,
  exercise: string, weight: string,
): CompletedWorkout => ({
  id, date, completedAt: `${date}T08:00:00.000Z`, workoutName, durationSeconds: 3600,
  ...(programId !== undefined ? { programId } : {}),
  ...(dayId ? { dayId } : {}),
  exercises: [{ name: exercise, notes: "", sets: [set(weight)] }],
});

const HISTORY: CompletedWorkout[] = [
  // Strength's own Push and Pull.
  session("w_a_push", "2026-09-01", "Push", "prog_a", "a0", "Barbell Bench Press", "80"),
  session("w_a_pull", "2026-09-02", "Pull", "prog_a", "a1", "Barbell Row", "70"),
  // A free workout logged in Avenas.
  session("w_arms", "2026-09-05", "Arms", "", undefined, "Barbell Curl", "30"),
  // PPL Old's, about to be deleted.
  session("w_b1", "2026-08-10", "Legs", "prog_b", "b0", "Barbell Back Squat", "100"),
  session("w_b2", "2026-08-17", "Legs", "prog_b", "b0", "Barbell Back Squat", "105"),
  // A program deleted before names were kept: its id, nothing else.
  session("w_c1", "2026-07-01", "Legs", "prog_c", "c0", "Barbell Back Squat", "90"),
  // Imported from Hevy: free, and named like Strength's Push.
  session("w_h1", "2026-06-01", "Push", "", undefined, "Barbell Bench Press", "70"),
  session("w_h2", "2026-06-08", "Push", "", undefined, "Barbell Bench Press", "72.5"),
  // From before program ids, named like Strength's Pull, months before it ran.
  session("w_legacy", "2026-05-01", "Pull", undefined, undefined, "Barbell Row", "60"),
  // ...and one while it ran, which is Strength's.
  session("w_legacy_in", "2026-09-03", "Pull", undefined, undefined, "Barbell Row", "72.5"),
];

// ─── 6. Deleting a program ───────────────────────────────────────────────────

const named = withDeletedProgramName(HISTORY, OLD_PPL);
eq(named?.filter(w => w.programName).map(w => [w.id, w.programName]), [["w_b1", "PPL Old"], ["w_b2", "PPL Old"]],
  "delete: its sessions keep its name, no one else's");
eq(withDeletedProgramName(named ?? [], OLD_PPL), null, "delete: twice changes nothing");
eq(withDeletedProgramName(HISTORY, { ...OLD_PPL, id: "prog_none" }), null, "delete: a program with no sessions changes nothing");
const history = named ?? HISTORY;
const programs = [STRENGTH]; // PPL Old deleted

// ─── 1. Which sessions ───────────────────────────────────────────────────────

const custom = filterByProgramScope(history, { kind: "custom" }, programs);
eq(custom.map(w => w.id).sort(), ["w_arms", "w_b1", "w_b2", "w_c1", "w_h1", "w_h2", "w_legacy"],
  "scope: free, imported, deleted programs' and a pre-id session outside every program; never a program's");
ok(!isCustomSession(history[0], programs) && isCustomSession(history[6], programs), "scope: Strength's Push isn't one, an imported Push is");
eq(filterByProgramScope(history, { kind: "custom" }, [STRENGTH, OLD_PPL]).some(w => w.id === "w_b1"), false,
  "scope: a program that's still here keeps its sessions");

// ─── 2. Their days ───────────────────────────────────────────────────────────

const days = scopedProgramDays({ kind: "custom" }, programs, custom);
const label = (d: (typeof days)[number]) =>
  `${d.label}${d.custom?.programName ? ` from ${d.custom.programName}` : d.custom?.deletedProgram ? " from a deleted program" : ""}`;
eq(days.map(label), ["Arms", "Legs from PPL Old", "Legs from a deleted program", "Push", "Pull"],
  "days: one per name, each deleted program's its own, newest first, saying whose");
eq(days.map(d => d.custom?.sessionIds.size), [1, 2, 1, 2, 1], "days: each with its sessions");
eq(days.map(d => d.duplicateLabel), [false, true, true, false, false], "days: the two Legs read alike, so each says whose");
ok(days.every(d => d.programId === "" && d.dayId.startsWith("custom:") && d.key.startsWith("custom::")), "days: in no program");

const all = scopedProgramDays({ kind: "all" }, programs, history);
const groups = groupDaysByProgram(all, programs);
eq(groups.map(g => [g.programId, g.programName, g.days.map(d => d.label)]),
  [["prog_a", "Strength", ["Push", "Pull"]], [CUSTOM_GROUP_ID, CUSTOM_WORKOUTS_NAME, ["Arms", "Legs", "Legs", "Push", "Pull"]]],
  "All programs: a Custom workouts card after every program's");
eq(all.filter(d => d.custom).map(d => d.key), days.map(d => d.key), "All programs: the same days, the same keys (a chart picked under one stays under the other)");
eq(scopedProgramDays({ kind: "current" }, programs, filterByProgramScope(history, { kind: "current" }, programs)).some(d => d.custom), false,
  "Current program: none of them");

// A session from before program ids goes by its name only inside its
// program's dates, under All programs as under the program itself: the one
// from before Strength ran is on Custom workouts' Pull alone, not twice.
const strengthPullAll = all.find(d => d.programId === "prog_a" && d.label === "Pull")!;
eq(history.filter(w => workoutMatchesDay(w, strengthPullAll)).map(w => w.id), ["w_a_pull", "w_legacy_in"],
  "All programs: Strength's Pull has its own and the pre-id one from while it ran, not the one from before");
eq(all.filter(d => d.custom && d.label === "Pull").map(d => [...d.custom!.sessionIds]), [["w_legacy"]],
  "All programs: the one from before is Custom workouts' Pull");
const strengthPullOwn = scopedProgramDays({ kind: "current" }, programs, filterByProgramScope(history, { kind: "current" }, programs))
  .find(d => d.label === "Pull")!;
eq(filterByProgramScope(history, { kind: "current" }, programs).filter(w => workoutMatchesDay(w, strengthPullOwn)).map(w => w.id),
  ["w_a_pull", "w_legacy_in"], "Current program: Strength's Pull reads the same");

// ─── 3. Same names, kept apart ───────────────────────────────────────────────

const strengthPush = programDays(STRENGTH)[0];
const customPush = days.find(d => d.label === "Push")!;
eq(history.filter(w => workoutMatchesDay(w, strengthPush)).map(w => w.id), ["w_a_push"], "Strength's Push takes none of the imported Push sessions");
eq(history.filter(w => workoutMatchesDay(w, customPush)).map(w => w.id), ["w_h1", "w_h2"], "the imported Push takes none of Strength's");
eq(sessionCountForDay(custom, customPush), 2, "the custom Push counts its own two");
eq(collectLoggedExercisesForDay(custom, customPush).map(r => [r.name, r.sessionCount, r.inProgram]), [["Barbell Bench Press", 2, true]],
  "its exercises, none of them 'swapped out'");

// ─── 4. Its chart ────────────────────────────────────────────────────────────

const points = collectExerciseHistory(custom, "Barbell Bench Press", customPush);
eq(points.map(p => [p.date, p.topWeight]), [["2026-06-01", 70], ["2026-06-08", 72.5]], "chart: its sessions, oldest first");
const tracks = buildSessionTracks(history, programs, "2026-09-10");
const slots = exerciseDaySlots({
  exercise: "Barbell Bench Press", points, programPoints: [], history, tracks, todayYMD: "2026-09-10",
});
eq(slots.map(s => [s.point?.date ?? null, s.missed ?? null, s.number]), [["2026-06-01", null, 1], ["2026-06-08", null, 2]],
  "chart: numbered 1, 2 as their cards are, nothing missed");
eq([tracks.numberById.w_h1, tracks.numberById.w_h2, tracks.numberById.w_b1, tracks.numberById.w_b2, tracks.numberById.w_c1],
  [1, 2, 1, 2, 1], "cards: each custom day counts its own (a deleted program's Legs apart from another's)");

// ─── 5. Exercise History from the chart ──────────────────────────────────────

const picks = picksFromHistoryParams({ customDay: customPush.custom!.key, dayName: customPush.label });
const rows = exerciseHistoryRows(history, programs, { exerciseName: "Barbell Bench Press", picks, days: 3650, today: new Date(2026, 8, 10) });
eq(rows.map(r => [r.workoutId, r.programName]), [["w_h2", "Custom workout"], ["w_h1", "Custom workout"]],
  "history: the chart's two sessions, not Strength's Push");
const options = exerciseHistoryOptions(history, programs, { name: "Barbell Bench Press" });
eq(pickLabel(picks[0], options, programs), "Custom workouts · Push", "history: the filter reads Custom workouts · Push");
eq(options.free, true, "history: the Custom workouts pill is offered");
const legs = days.filter(d => d.label === "Legs");
const legRows = legs.map(d => exerciseHistoryRows(history, programs, {
  exerciseName: "Barbell Back Squat", picks: picksFromHistoryParams({ customDay: d.custom!.key, dayName: d.label }), days: 3650, today: new Date(2026, 8, 10),
}).map(r => [r.workoutId, r.programName]));
eq(legRows, [[["w_b2", "PPL Old"], ["w_b1", "PPL Old"]], [["w_c1", "Deleted program"]]],
  "history: each Legs its own sessions, saying whose they were");
eq(picksFromHistoryParams({ dayName: "Push", dayId: "a0", programId: "prog_a" }), [{ kind: "day", programId: "prog_a", dayId: "a0", dayName: "Push" }],
  "history: a program's day still opens on that day");

// ─── 6 (cont.). Through a restore ────────────────────────────────────────────

// A backup can't point a session at a program it doesn't have: it comes back
// with programId "". The kept name rides along (0052).
const restored = history.map(w => {
  const row = { ...workoutToRow(w, "user", null), id: w.id, created_at: "", updated_at: "" } as WorkoutRow;
  return workoutFromRow(row);
});
eq(restored.filter(w => w.id.startsWith("w_b")).map(w => [w.programId, w.programName]), [["", "PPL Old"], ["", "PPL Old"]],
  "restore: a deleted program's sessions come back in no program, with its name");
const restoredDays = scopedProgramDays({ kind: "custom" }, programs, filterByProgramScope(restored, { kind: "custom" }, programs));
eq(restoredDays.find(d => d.custom?.programName === "PPL Old")?.key, days.find(d => d.custom?.programName === "PPL Old")?.key,
  "restore: its day keeps its key (a chart picked before still shows)");

// ─── 6 (cont.). On a phone ───────────────────────────────────────────────────

async function storeChecks() {
  const SAM: Phone = { uid: "sam", name: "Sam", store: new Map([[WORKOUT_HISTORY_KEY, JSON.stringify(HISTORY)]]), offline: false };
  await on(SAM, () => keepDeletedProgramName(OLD_PPL));
  const saved = JSON.parse(SAM.store.get(WORKOUT_HISTORY_KEY)!) as CompletedWorkout[];
  eq(saved.filter(w => w.programName).map(w => w.id), ["w_b1", "w_b2"], "store: the delete keeps the name on its sessions");
  eq(saved.map(w => w.id), HISTORY.map(w => w.id), "store: and nothing else changes");
  SAM.store.set(WORKOUT_HISTORY_KEY, "{not json");
  await on(SAM, () => keepDeletedProgramName(OLD_PPL));
  eq(SAM.store.get(WORKOUT_HISTORY_KEY), "{not json", "store: a history it can't read is left alone");
}

storeChecks()
  .catch(e => { failures.push(`✗ store checks threw: ${(e as Error).stack ?? e}`); })
  .finally(() => {
    for (const f of failures) console.log(f);
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) process.exitCode = 1;
    else console.log("✓ custom workouts hold");
  });
