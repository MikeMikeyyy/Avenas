// A custom exercise's identity, and what deleting one does (user request,
// 2026-10-15; utils/customExercises.ts, utils/exerciseNames.ts exerciseIdentity).
//
//   1. The rules: which exercise a row or a session is (by its id, else by its
//      name for one made before ids), which are live, what a deletion keeps,
//      and what a rename touches.
//   2. The user's story, through the screens' own functions: a custom exercise
//      logged for a few weeks is deleted. What was logged stays (its chart, its
//      records, its muscles on the radar), and it leaves the program and the
//      picker. A new exercise later given its name starts with nothing of the
//      old one's: no "last time" numbers or notes, its own chart, rows, records
//      and muscles, and its first session is a first, not a PR against the old.
//      One made before ids goes the same way, by its name.
//   3. The real utils/customExerciseStore.ts on an in-memory phone: a delete
//      keeps the exercise hidden, takes it out of every program and the
//      builder's draft, unstars it, deletes its files and backs up; a rename
//      reaches every program, the draft and the star, and only that exercise.
//
// Run:  npx tsx scripts/verify-custom-identity.ts
// Exits non-zero if any assertion fails.

import type { CarriedExercise, CustomExercise } from "../constants/exercises";
import type { CompletedExercise, CompletedWorkout, Exercise, SavedProgram, WorkoutMap } from "../constants/programs";
import { exerciseIdentity, sameExercise } from "../utils/exerciseNames";
import {
  customFor, customIdForName, customNameTaken, isDeletedExercise, isThisCustom, liveCustoms, liveIndexOf,
  newCustomId, tombstoneOf, withCurrentCustomNames, withRenamedCustom, withoutCustomExercise,
} from "../utils/customExercises";
import {
  carriedExercises, exerciseSummaryParams, knownCustomExercises, sharedExercises, stampCustomDetails,
} from "../utils/customExerciseDetails";
import { musclesForExercise } from "../utils/muscleGroups";
import {
  collectExerciseHistory, collectLoggedExercisesForDay, computeMuscleGroupStats, computePRs, scopedProgramDays,
} from "../utils/progressStats";
import { buildPrevNoteLookup, buildPrevSetsLookup, getWorkoutForDate, prevDayScopeFor, swapOrigin } from "../utils/workout";
import { computeSessionRecords } from "../utils/workoutSummary";
import { exerciseHistoryRows } from "../utils/exerciseHistory";
import { todayYMD } from "../utils/dates";

/* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, no @types/node (see ./harness/db.ts) */
type NodeModule = {
  _load(request: string, parent: { filename?: string } | null, isMain: boolean): unknown;
};
const Module = require("node:module") as NodeModule;
const path = require("node:path") as {
  resolve(...parts: string[]): string;
  dirname(p: string): string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const ok = (cond: boolean, label: string) => eq(cond, true, label);

const ex = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ id, name, sets: [{ type: "working", reps: "8" }, { type: "working", reps: "8" }], ...extra });
const done = (weight: string, reps = "8") => ({ type: "working" as const, weight, reps, done: true });

// ─── 1. The rules ────────────────────────────────────────────────────────────

const A: CustomExercise = {
  id: "cxA", name: "Landmine Twist", muscles: ["Core"],
  imageUri: "file:///phone/exercise_icon_1.jpg", videoUri: "file:///phone/exercise_video_1.mp4", muted: true,
  steps: ["Brace", "Rotate through the hips"], description: "Old notes",
};
/** Made before ids: known by its name. */
const L: CustomExercise = { name: "Cable Twist", muscles: ["Core"] };

eq(exerciseIdentity({ name: "Landmine Twist", customId: "cxA" }), "custom:cxA", "identity: a custom exercise with an id is its id");
eq(exerciseIdentity({ name: "Dumbbell Lateral Raise" }), exerciseIdentity({ name: "lateral raise" }),
  "identity: anything else is its name, through the catalogue's renames");
ok(sameExercise({ name: "Landmine Twist", customId: "cxA" }, { name: "landmine twist", customId: "cxA" }), "same: one id, any spelling");
ok(!sameExercise({ name: "Landmine Twist", customId: "cxA" }, { name: "Landmine Twist", customId: "cxB" }), "same: two ids of one name are two exercises");
ok(!sameExercise({ name: "Landmine Twist", customId: "cxA" }, { name: "Landmine Twist" }), "same: an id and a bare name are two exercises");
ok(!sameExercise(null, { name: "Landmine Twist" }), "same: nothing is never an exercise");

const ids = new Set(Array.from({ length: 2000 }, () => newCustomId(1_760_000_000_000)));
eq(ids.size, 2000, "ids: two thousand made in the same millisecond are all different");
ok([...ids].every(i => i.startsWith("cx")), "ids: each starts cx");

const tombA = tombstoneOf(A, "2026-10-01");
eq(tombA, { id: "cxA", name: "Landmine Twist", muscles: ["Core"], steps: A.steps, description: "Old notes", deletedAt: "2026-10-01" },
  "tombstone: keeps its id and what its sessions are read with, drops its photo, video and sound");
eq(tombstoneOf(L, "2026-10-01"), { name: "Cable Twist", muscles: ["Core"], deletedAt: "2026-10-01" },
  "tombstone: one made before ids stays without one");
eq(liveCustoms([tombA, L]).map(c => c.name), ["Cable Twist"], "live: a deleted one is out of the picker and the slots");

eq(customFor({ name: "Landmine Twist", customId: "cxA" }, [tombA, L]), tombA, "lookup: a session finds its deleted exercise by id");
eq(customFor({ name: "Cable Twist" }, [L]), L, "lookup: one made before ids is found by its name");
eq(customFor({ name: "Landmine Twist" }, [tombA]), undefined, "lookup: a bare name never finds an exercise with an id");
eq(customFor({ name: "Barbell Bench Press" }, [tombA, L]), undefined, "lookup: a catalogue exercise is nobody's custom");
const tombL = tombstoneOf(L, "2026-10-01");
const liveL2: CustomExercise = { name: "Cable Twist", muscles: ["Shoulders"] };
eq(customFor({ name: "cable twist" }, [tombL, liveL2]), liveL2, "lookup: of two made before ids, the live one first");
ok(isDeletedExercise({ name: "Landmine Twist", customId: "cxA" }, [tombA]), "deleted: by id");
ok(!isDeletedExercise({ name: "Landmine Twist", customId: "cxB" }, [tombA]), "deleted: never another of its name");

eq(customIdForName("landmine twist", [A]), "cxA", "pick: picking your exercise by name records its id");
eq(customIdForName("Landmine Twist", [tombA]), undefined, "pick: a deleted one can't be picked");
eq(customIdForName("Cable Twist", [L]), undefined, "pick: one made before ids records none (its history is by name)");
const trainers: CarriedExercise = { id: "cxT", name: "Sled Push", muscles: ["Legs"], by: "trainer" };
eq(customIdForName("Sled Push", [], [trainers]), "cxT", "pick: a trainer's exercise records the trainer's id");

ok(!customNameTaken("Landmine Twist", [tombA]), "name: a deleted exercise's name is free");
ok(customNameTaken("landmine twist ", [A]), "name: a live one's is taken, any case or spacing");
ok(!customNameTaken("Landmine Twist", [A], 0), "name: an exercise keeps its own name when edited");
eq(liveIndexOf([tombA, { ...A, id: "cxB" }], "Landmine Twist"), 1, "edit: the live exercise of a name, never its deleted namesake");

// Which rows a delete or a rename touches.
const rows: WorkoutMap = {
  "0:Upper": [
    ex("e1", "Barbell Bench Press"),
    ex("e2", "Landmine Twist", { customId: "cxA" }),
    ex("e3", "Landmine Twist", { customId: "cxB" }),
    ex("e4", "Cable Twist"),
    ex("e5", "Cable Twist", { customDetails: { name: "Cable Twist", muscles: ["Arms"], by: "trainer" } }),
  ],
  "1:Lower": [ex("e6", "Barbell Squat")],
};
ok(isThisCustom(rows["0:Upper"][1], A) && !isThisCustom(rows["0:Upper"][2], A), "rows: by id, never another of its name");
ok(isThisCustom(rows["0:Upper"][3], L) && !isThisCustom(rows["0:Upper"][4], L) && !isThisCustom(rows["0:Upper"][2], L),
  "rows: one made before ids by name, never a trainer's of its name or one with an id");
const withoutA = withoutCustomExercise(rows, A);
eq(withoutA["0:Upper"].map(e => e.id), ["e1", "e3", "e4", "e5"], "delete: only its own rows leave the day");
ok(withoutA["1:Lower"] === rows["1:Lower"], "delete: a day without it is the same list");
eq(withoutCustomExercise(rows, L)["0:Upper"].map(e => e.id), ["e1", "e2", "e3", "e5"], "delete: one made before ids, by its name");
const noA = { "1:Lower": rows["1:Lower"] };
ok(withoutCustomExercise(noA, A) === noA, "delete: the same object back when it wasn't there");

const renamedB = withRenamedCustom(rows, { ...A, id: "cxB" }, "Landmine Spin");
eq(renamedB["0:Upper"].map(e => e.name), ["Barbell Bench Press", "Landmine Twist", "Landmine Spin", "Cable Twist", "Cable Twist"],
  "rename: only that exercise's rows, by id");
eq(withRenamedCustom(rows, L, "Cable Spin")["0:Upper"].map(e => e.name),
  ["Barbell Bench Press", "Landmine Twist", "Landmine Twist", "Cable Spin", "Cable Twist"],
  "rename: one made before ids by name, never a trainer's of its name");
ok(withRenamedCustom(noA, A, "Anything") === noA, "rename: the same object back when it wasn't there");

const current = withCurrentCustomNames(rows, [tombA, { ...A, id: "cxB", name: "Landmine Spin" }]);
eq(current["0:Upper"].map(e => e.name), ["Barbell Bench Press", "Landmine Twist", "Landmine Spin", "Cable Twist", "Cable Twist"],
  "builder: a row takes its live exercise's current name; a deleted one's rows and others' are left");
ok(withCurrentCustomNames(rows, [A]) === rows, "builder: the same object back when every name is current");
// A program that came back to you (a review) can hold rows of your exercise
// from before you renamed and then deleted it: they keep the name they have.
const cameBack: WorkoutMap = { "0:Upper": [ex("r1", "Old Twist", { customId: "cxA" })] };
ok(withCurrentCustomNames(cameBack, [tombA]) === cameBack, "builder: a deleted exercise's rows keep the name they have");

// ─── 2. The story ────────────────────────────────────────────────────────────
// Upper every day. Landmine Twist (yours, with an id) is done three times with
// notes, then deleted, then made again under the same name.

const program: SavedProgram = {
  id: "p1", name: "Every Day", totalWeeks: 8, currentWeek: 1, status: "active", startDate: "01 Sep 2026",
  trainingDays: 1, cycleDays: 1, cyclePattern: ["Upper"], dayIds: ["d0"],
  workouts: { "0:Upper": [ex("e1", "Barbell Bench Press"), ex("e2", "Landmine Twist", { customId: "cxA" })] },
};
const twistA = (weight: string, notes = ""): CompletedExercise =>
  ({ name: "Landmine Twist", customId: "cxA", programExerciseId: "e2", notes, sets: [done(weight), done(weight)] });
const bench = (weight: string): CompletedExercise =>
  ({ name: "Barbell Bench Press", programExerciseId: "e1", notes: "", sets: [done(weight, "5")] });
const session = (id: string, date: string, exercises: CompletedExercise[]): CompletedWorkout => ({
  id, date, completedAt: `${date}T08:00:00.000Z`, workoutName: "Upper", durationSeconds: 3000,
  programId: "p1", dayId: "d0", exercises,
});
const logged = [
  session("w3", "2026-09-05", [bench("85"), twistA("25", "lean into it")]),
  session("w2", "2026-09-03", [bench("82.5"), twistA("22.5")]),
  session("w1", "2026-09-01", [bench("80"), twistA("20")]),
];
const asA = { name: "Landmine Twist", customId: "cxA" };
const asB = { name: "Landmine Twist", customId: "cxB" };

// Deleted.
const customs1 = [tombA];
const program1: SavedProgram = { ...program, workouts: withoutCustomExercise(program.workouts, A) };
eq(program1.workouts["0:Upper"].map(e => e.name), ["Barbell Bench Press"], "story: deleted, it's out of the program");
eq(liveCustoms(customs1).length, 0, "story: ...out of the picker, and its slot is free");
const dayOf = (p: SavedProgram, hist: CompletedWorkout[]) =>
  scopedProgramDays({ kind: "program", programId: p.id }, [p], hist).find(d => d.dayId === "d0")!;
const day1 = dayOf(program1, logged);
eq(collectExerciseHistory(logged, asA, day1).map(pt => pt.topWeight), [20, 22.5, 25], "story: what was logged stays on its chart");
eq(computePRs(collectExerciseHistory(logged, asA, day1), logged, asA, day1).heaviest?.value, 25, "story: ...and its records");
eq(musclesForExercise(asA, customs1), ["Core"], "story: ...and the radar still places it");
eq(computeMuscleGroupStats(logged, customs1).Core.sets, 6, "story: ...every set of it");
const rows1 = collectLoggedExercisesForDay(logged, day1);
eq(rows1.map(r => [r.name, r.customId ?? null, r.inProgram]), [["Barbell Bench Press", null, true], ["Landmine Twist", "cxA", false]],
  "story: its row stays on the day, no longer in the program");
ok(isDeletedExercise(rows1[1], knownCustomExercises(customs1)), "story: ...marked deleted");
// A trainer's exercise of the name is offered again, now that yours is gone.
const trainerTwist: CarriedExercise = { id: "cxT2", name: "Landmine Twist", muscles: ["Legs"], by: "trainer" };
const carriedProgram: SavedProgram = { ...program, id: "tp", status: "created", workouts: { "0:Upper": [ex("t1", "Landmine Twist", { customId: "cxT2", customDetails: trainerTwist })] } };
eq(sharedExercises(customs1, carriedExercises([carriedProgram]), "me").map(c => c.id), ["cxT2"],
  "story: a trainer's exercise of its name can be picked once yours is deleted");

// Made again, under the same name: a new exercise.
const B: CustomExercise = { id: "cxB", name: "Landmine Twist", muscles: ["Shoulders"] };
ok(!customNameTaken(B.name, customs1), "again: the name is free to use");
const customs2 = [...customs1, B];
eq(sharedExercises(customs2, carriedExercises([carriedProgram]), "me"), [], "again: then yours is the one of that name in the picker");
eq(customIdForName("Landmine Twist", customs2), "cxB", "again: picking it records the new id");
const program2: SavedProgram = { ...program1, workouts: { "0:Upper": [...program1.workouts["0:Upper"], ex("e3", "Landmine Twist", { customId: "cxB" })] } };
const resolved = getWorkoutForDate(program2, "2026-09-08");
ok(!!resolved, "again: the 8th is an Upper day");
const scope = prevDayScopeFor(resolved!, program2);
const prevSets = buildPrevSetsLookup(logged, undefined, scope);
const prevNote = buildPrevNoteLookup(logged, undefined, scope);
eq(prevSets({ ...asB, programExerciseId: "e3" }), undefined, "again: no \"Previous\" numbers from the deleted one");
eq(prevSets(asB), undefined, "again: ...nor when added mid-session");
eq(prevNote({ ...asB, programExerciseId: "e3" }), undefined, "again: no \"last time\" note from it either");
eq(prevSets({ ...asA, programExerciseId: "e2" }), ["25×8", "25×8"], "again: (the deleted one's own numbers are still there for it)");
eq(prevNote({ ...asA, programExerciseId: "e2" }), "lean into it", "again: (and its note)");

const firstB = session("w4", "2026-09-08", [
  bench("87.5"),
  { name: "Landmine Twist", customId: "cxB", programExerciseId: "e3", notes: "", sets: [done("10"), done("10")] },
]);
const all = [firstB, ...logged];
const twistRecords = computeSessionRecords(firstB, logged).filter(r => r.exerciseName === "Landmine Twist");
eq(twistRecords.map(r => [r.kind, r.valueKg, r.prevKg]), [["heaviest", 10, null]],
  "again: its first session is a first, not a lighter session of the old one");
const day2 = dayOf(program2, all);
eq(collectExerciseHistory(all, asB, day2).map(pt => pt.topWeight), [10], "again: its chart is its own");
eq(collectExerciseHistory(all, asA, day2).map(pt => pt.topWeight), [20, 22.5, 25], "again: the deleted one's chart is untouched");
eq(computePRs(collectExerciseHistory(all, asB, day2), all, asB, day2).heaviest?.value, 10, "again: its records are its own");
eq(collectLoggedExercisesForDay(all, day2).filter(r => r.name === "Landmine Twist").map(r => [r.customId, r.sessionCount, r.inProgram]),
  [["cxB", 1, true], ["cxA", 3, false]], "again: two rows of one name on the day, the deleted one apart");
eq([musclesForExercise(asA, customs2), musclesForExercise(asB, customs2)], [["Core"], ["Shoulders"]], "again: each keeps its own muscles");
const radar = computeMuscleGroupStats(all, customs2);
eq([radar.Core.sets, radar.Shoulders.sets], [6, 2], "again: the radar counts each under its own");
const today = new Date(2026, 8, 10);
const historyRows = (customId: string) =>
  exerciseHistoryRows(all, [program2], { exerciseName: "Landmine Twist", customId, dayName: "Upper", dayId: "d0", programId: "p1", days: 365, today });
eq([historyRows("cxB").length, historyRows("cxA").length], [1, 3], "again: Exercise History lists each one's sessions alone");
eq(knownCustomExercises(customs2).map(c => c.id), ["cxA", "cxB"], "again: both are known, never merged");
eq(customFor(asB, customs2), B, "again: its exercise screen opens the new one");
eq(exerciseSummaryParams(program2.workouts["0:Upper"][1]), { exerciseName: "Landmine Twist", customId: "cxB" },
  "again: ...which its row asks for by id");
const sent = stampCustomDetails(program2.workouts, { own: customs2, stampOwn: true, carried: [], by: "me" });
eq(sent["0:Upper"][1].customDetails?.muscles, ["Shoulders"], "again: a send carries the new one's details, never the old one's");
// A program that came back to you can still hold the deleted one's row, with
// the details it was sent with (its uploaded photo): a send keeps them rather
// than stamp what's left of it.
const backRow = ex("r2", "Landmine Twist", { customId: "cxA", customDetails: { ...A, imageUri: "https://x/a.jpg", by: "me" } });
eq(stampCustomDetails({ "0:Upper": [backRow] }, { own: customs2, stampOwn: true, carried: [], by: "me" })["0:Upper"][0].customDetails,
  backRow.customDetails, "again: a deleted exercise's row keeps the details it was sent with");
eq(swapOrigin(asA, asB), { swappedFrom: "Landmine Twist", swappedFromId: "cxA" }, "again: swapping one for the other is a swap");

// Made before ids: the same, by its name.
const oldTwist = (weight: string): CompletedExercise => ({ name: "Cable Twist", notes: "", sets: [done(weight)] });
const legacyLogged = [session("v1", "2026-09-02", [oldTwist("15")])];
const C: CustomExercise = { id: "cxC", name: "Cable Twist", muscles: ["Shoulders"] };
const customs3 = [tombL, C];
eq(customFor({ name: "Cable Twist" }, customs3), tombL, "before ids: its sessions still find it, by name");
eq(musclesForExercise({ name: "Cable Twist" }, customs3), ["Core"], "before ids: ...and its muscles, never the new one's");
eq(customIdForName("Cable Twist", customs3), "cxC", "before ids: made again, it's a new exercise with an id");
const legacyScope = prevDayScopeFor(resolved!, program2);
eq(buildPrevSetsLookup(legacyLogged, undefined, legacyScope)({ name: "Cable Twist", customId: "cxC" }), undefined,
  "before ids: the new one shows none of the old one's numbers");
eq(buildPrevSetsLookup(legacyLogged, undefined, legacyScope)({ name: "Cable Twist" }), ["15×8"],
  "before ids: (the old one's are there for it)");

// ─── 3. The store, on an in-memory phone ─────────────────────────────────────

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
const ROOT = path.resolve(__dirname, "..");
const byFile: Record<string, unknown> = {};
const byRequest: Record<string, unknown> = {};
const originalLoad = Module._load;
Module._load = function (this: unknown, request, parent, isMain) {
  if (request in byRequest) return byRequest[request];
  if (request.startsWith(".") && parent?.filename) {
    const hit = byFile[norm(path.resolve(path.dirname(parent.filename), request))];
    if (hit) return hit;
  }
  return originalLoad.call(this, request, parent, isMain);
};
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const disk = new Map<string, string>();
byRequest["@react-native-async-storage/async-storage"] = {
  __esModule: true,
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => { disk.set(k, v); },
    removeItem: async (k: string) => { disk.delete(k); },
  },
};
const deletedFiles: string[] = [];
byRequest["expo-file-system/legacy"] = {
  __esModule: true,
  deleteAsync: async (uri: string) => { deletedFiles.push(uri); },
};
let pushes = 0;
byFile[norm(path.resolve(ROOT, "lib/syncManager"))] = { __esModule: true, scheduleCloudPush: () => { pushes += 1; } };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the stubs
const store = require("../utils/customExerciseStore") as typeof import("../utils/customExerciseStore");

const K = {
  custom: "@avenas/custom_exercises", programs: "@avenas/programs", draft: "@avenas/new_program_draft",
  favourites: "@avenas/favourite_exercises",
};
const read = <T,>(k: string): T => JSON.parse(disk.get(k) as string) as T;
const write = (k: string, v: unknown) => disk.set(k, JSON.stringify(v));

async function storeChecks() {
  const Lremote: CustomExercise = { ...L, imageUri: "https://x.supabase.co/storage/v1/object/public/exercise-media/me/a.jpg" };
  const finished: SavedProgram = { ...program, id: "p0", status: "completed" };
  const trainerRow = ex("t9", "Landmine Twist", { customDetails: { name: "Landmine Twist", muscles: ["Legs"], by: "trainer" } });
  write(K.custom, [A, Lremote]);
  write(K.programs, [program, { ...finished, workouts: { "0:Upper": [ex("f1", "Landmine Twist", { customId: "cxA" }), trainerRow] } }]);
  write(K.draft, { name: "Draft", step: 2, workouts: { "0:Push": [ex("d1", "Landmine Twist", { customId: "cxA" }), ex("d2", "Barbell Bench Press")] } });
  write(K.favourites, ["Landmine Twist", "Barbell Bench Press"]);

  const back = await store.deleteCustomExercise("landmine twist");
  eq(read<CustomExercise[]>(K.custom), [tombstoneOf(A, todayYMD()), Lremote], "store delete: kept, hidden, dated today");
  eq(back, read<CustomExercise[]>(K.custom), "store delete: hands back the list as it now stands");
  const programs = read<SavedProgram[]>(K.programs);
  eq(programs.map(p => p.workouts["0:Upper"].map(e => e.id)), [["e1"], ["t9"]],
    "store delete: out of every program, finished ones too, never a trainer's exercise of its name");
  const draft = read<{ name: string; step: number; workouts: WorkoutMap }>(K.draft);
  eq([draft.name, draft.step, draft.workouts["0:Push"].map(e => e.id)], ["Draft", 2, ["d2"]], "store delete: out of the builder's draft, the rest kept");
  eq(read<string[]>(K.favourites), ["Barbell Bench Press"], "store delete: its star goes, so a new one of its name starts unstarred");
  eq(deletedFiles, [A.imageUri, A.videoUri], "store delete: its photo and video are deleted from the phone");
  eq(pushes, 1, "store delete: backed up");

  const again = await store.deleteCustomExercise("Landmine Twist");
  eq([again.length, pushes], [2, 1], "store delete: a name with nothing live does nothing");

  await store.deleteCustomExercise("Cable Twist");
  eq(deletedFiles.length, 2, "store delete: a photo that's a link (uploaded with a send) isn't a file to delete");
  eq(read<CustomExercise[]>(K.custom).map(c => [c.name, !!c.deletedAt]), [["Landmine Twist", true], ["Cable Twist", true]],
    "store delete: one made before ids, by its name");

  // Made again and renamed: its rows, the draft and its star follow; nothing else.
  const B2: CustomExercise = { id: "cxB", name: "Landmine Twist", muscles: ["Shoulders"] };
  write(K.custom, [tombstoneOf(A, "2026-10-01"), B2, L]);
  write(K.programs, [{ ...program, workouts: { "0:Upper": [ex("e1", "Barbell Bench Press"), ex("e3", "Landmine Twist", { customId: "cxB" }), trainerRow, ex("e4", "cable twist")] } }]);
  write(K.draft, { name: "Draft", workouts: { "0:Push": [ex("d3", "Landmine Twist", { customId: "cxB" })] } });
  write(K.favourites, ["Landmine Twist", "Cable Twist"]);
  await store.renameCustomExercise(B2, "Landmine Spin");
  eq(read<SavedProgram[]>(K.programs)[0].workouts["0:Upper"].map(e => e.name),
    ["Barbell Bench Press", "Landmine Spin", "Landmine Twist", "cable twist"], "store rename: its rows, never a trainer's of its old name");
  eq(read<{ workouts: WorkoutMap }>(K.draft).workouts["0:Push"].map(e => e.name), ["Landmine Spin"], "store rename: the builder's draft too");
  eq(read<string[]>(K.favourites), ["Cable Twist", "Landmine Spin"], "store rename: its star moves with it");
  await store.renameCustomExercise(L, "Cable Spin");
  eq(read<SavedProgram[]>(K.programs)[0].workouts["0:Upper"].map(e => e.name),
    ["Barbell Bench Press", "Landmine Spin", "Landmine Twist", "Cable Spin"], "store rename: one made before ids, by its name, any case");
  eq(read<string[]>(K.favourites), ["Landmine Spin", "Cable Spin"], "store rename: ...and its star");
  await store.renameCustomExercise({ ...L, name: "Cable Spin" }, "cable spin");
  eq(read<string[]>(K.favourites), ["Landmine Spin", "Cable Spin"], "store rename: a change of case keeps one star");
  // A name can already be starred (a trainer's exercise of that name): one star.
  write(K.favourites, ["Landmine Spin", "Sled Push"]);
  await store.renameCustomExercise({ ...B2, name: "Landmine Spin" }, "Sled Push");
  eq(read<string[]>(K.favourites), ["Sled Push"], "store rename: onto a name already starred, one star");
  eq(pushes, 2, "store rename: the backup is the caller's (create-custom-exercise saves the list, then pushes once)");
}

storeChecks()
  .catch(e => { failures.push(`✗ store checks threw: ${(e as Error).stack ?? e}`); })
  .finally(() => {
    for (const f of failures) console.log(f);
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) process.exitCode = 1;
    else console.log("✓ custom exercise identity invariants hold");
  });
