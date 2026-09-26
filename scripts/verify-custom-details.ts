// A custom exercise travelling with a program (utils/customExerciseDetails.ts):
//
//   * a trainer's custom exercise reaches the client with the trainer's
//     muscles, steps, photo and video, and takes none of the client's slots;
//   * the client's Progress radar places it by the trainer's muscles;
//   * the client can pick it ("From your trainer") and it keeps its details in
//     their own program, even after the trainer's program is gone;
//   * only media that were uploaded travel (a local path means nothing on
//     another phone), and nothing is stamped twice or onto the wrong row.
//
// The upload itself and the bucket's write rules are covered by
// scripts/verify-db.ts (0038); this is the logic around them.
//
// Run:  npx tsx scripts/verify-custom-details.ts

import type { CarriedExercise, CustomExercise } from "../constants/exercises";
import type { CompletedWorkout, Exercise, SavedProgram, WorkoutMap } from "../constants/programs";
import {
  carriedExercises,
  exerciseSummaryParams,
  knownCustomExercises,
  sharedExercises,
  stampCustomDetails,
  withRemoteMedia,
} from "../utils/customExerciseDetails";
import { musclesForExercise } from "../utils/muscleGroups";
import { computeMuscleGroupStats } from "../utils/progressStats";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

const TRAINER = "trainer-uid";
const CLIENT = "client-uid";
const URL = (file: string) => `https://x.supabase.co/storage/v1/object/public/exercise-media/${TRAINER}/${file}`;

const program = (id: string, status: SavedProgram["status"], workouts: WorkoutMap): SavedProgram => ({
  id, name: id, totalWeeks: 8, currentWeek: 1, status, startDate: "01 Sep 2026",
  trainingDays: 1, cycleDays: 2, cyclePattern: ["Push", "Rest"], workouts,
});
const ex = (id: string, name: string, extra: Partial<Exercise> = {}): Exercise =>
  ({ id, name, sets: [{ type: "working", reps: "10" }], ...extra });

// ─── What travels ────────────────────────────────────────────────────────────
// The trainer's own exercise, as it sits in their list: files on their phone.
const twist: CustomExercise = {
  name: "Landmine Twist",
  muscles: ["Core", "Shoulders"],
  imageUri: "file:///trainer/exercise_icon_1.jpg",
  videoUri: "file:///trainer/exercise_video_1.mp4",
  muted: true,
  steps: ["Brace", "Rotate through the hips"],
};
const uploaded = { [twist.imageUri!]: URL("exercise_icon_1.jpg"), [twist.videoUri!]: URL("exercise_video_1.mp4") };

eq(withRemoteMedia(twist, uploaded),
  { name: twist.name, muscles: twist.muscles, steps: twist.steps, imageUri: URL("exercise_icon_1.jpg"), videoUri: URL("exercise_video_1.mp4"), muted: true },
  "media: the uploaded copies replace the trainer's local files");
eq(withRemoteMedia(twist, { [twist.imageUri!]: URL("exercise_icon_1.jpg") }),
  { name: twist.name, muscles: twist.muscles, steps: twist.steps, imageUri: URL("exercise_icon_1.jpg") },
  "media: a clip that didn't upload is left out, with its muted flag, never sent as a path");
eq(withRemoteMedia({ name: "X", muscles: ["Arms"], imageUri: URL("a.jpg") }, {}).imageUri, URL("a.jpg"),
  "media: one that's already a URL stays");

// ─── The trainer sends ───────────────────────────────────────────────────────
const trainerProgram = program("tp", "active", {
  "0:Push": [ex("e1", "Barbell Bench Press"), ex("e2", "Landmine Twist"), ex("e3", "Mystery Move")],
});
const send = (w: WorkoutMap, own: CustomExercise[], by: string, carried: CarriedExercise[] = []) =>
  stampCustomDetails(w, { own: own.map(c => withRemoteMedia(c, uploaded)), stampOwn: true, carried, by });
const sent = send(trainerProgram.workouts, [twist], TRAINER);
const [bench, sentTwist, mystery] = sent["0:Push"];
eq(bench.customDetails, undefined, "send: a catalogue exercise carries nothing");
eq(sentTwist.customDetails?.by, TRAINER, "send: the trainer's exercise is marked as theirs");
eq(sentTwist.customDetails?.imageUri, URL("exercise_icon_1.jpg"), "send: ...with their photo");
eq(sentTwist.customDetails?.videoUri, URL("exercise_video_1.mp4"), "send: ...and their video");
eq(sentTwist.customDetails?.steps, twist.steps, "send: ...and their steps");
eq(mystery.customDetails, undefined, "send: a name nobody knows carries nothing");
eq(send(sent, [twist], TRAINER), sent, "send: stamping again changes nothing (the same object back)");
eq(trainerProgram.workouts["0:Push"][1].customDetails, undefined, "send: the trainer's own program is untouched");

// ─── The client accepts ──────────────────────────────────────────────────────
// Accepting copies the snapshot's workouts as they are (trainerStore
// materialiseSnapshot), so the client's program IS the sent one.
const clientOwn: CustomExercise[] = [{ name: "Band Pull-Apart", muscles: ["Back"] }];
const accepted = program("accepted", "active", sent);
const clientKnown = knownCustomExercises(clientOwn, carriedExercises([accepted]));
eq(clientOwn.length, 1, "slots: the client's own list is untouched, so no slot is taken");
eq(clientKnown.map(c => c.name), ["Band Pull-Apart", "Landmine Twist"], "lookup: the client can look up the trainer's exercise by name");
eq(clientKnown.find(c => c.name === "Landmine Twist")?.imageUri, URL("exercise_icon_1.jpg"),
  "lookup: ...and gets the trainer's photo (the exercise screen's hero)");
eq(musclesForExercise("landmine twist", clientKnown), ["Core", "Shoulders"], "lookup: ...and the trainer's muscles");

// The Progress radar places a logged set of it by those muscles.
const session: CompletedWorkout = {
  id: "w1", date: "2026-09-24", completedAt: "2026-09-24T18:00:00.000Z", workoutName: "Push", durationSeconds: 1800,
  programId: "accepted", dayId: "d0",
  exercises: [{ name: "Landmine Twist", notes: "", sets: [
    { type: "working", weight: "20", reps: "10", done: true },
    { type: "working", weight: "20", reps: "10", done: true },
  ] }],
};
const withTrainers = computeMuscleGroupStats([session], clientKnown);
const ownOnly = computeMuscleGroupStats([session], clientOwn);
eq([withTrainers.Core.sets, withTrainers.Shoulders.sets], [1, 1], "progress: its sets are split across the trainer's two muscles");
eq([withTrainers.Core.volume, withTrainers.Shoulders.volume], [200, 200], "progress: ...and so is its volume");
eq(ownOnly.Core.sets + ownOnly.Shoulders.sets, 0, "progress: (from the client's own list alone it placed nowhere, the reported bug)");

// ─── "From your trainer" ─────────────────────────────────────────────────────
eq(sharedExercises(clientOwn, carriedExercises([accepted]), CLIENT).map(c => c.name), ["Landmine Twist"],
  "picker: the client is offered the trainer's exercise");
eq(sharedExercises([{ name: "landmine twist", muscles: ["Core"] }], carriedExercises([accepted]), CLIENT), [],
  "picker: not when the client has one of that name (theirs is under CUSTOM)");
eq(sharedExercises([], carriedExercises([accepted]), TRAINER), [],
  "picker: never your own exercise that came back to you in a program");
eq(sharedExercises([], [{ name: "Barbell Bench Press", muscles: ["Chest"], by: TRAINER }], CLIENT), [],
  "picker: never something the catalogue already has");

// The client picks it into their own program. The builder's save stamps it
// from what their programs carry (not their own list: stampOwn is off).
const clientBuild: WorkoutMap = { "0:Legs": [ex("c1", "Landmine Twist"), ex("c2", "Band Pull-Apart")] };
const saved = stampCustomDetails(clientBuild, { own: clientOwn, stampOwn: false, carried: carriedExercises([accepted]) });
eq(saved["0:Legs"][0].customDetails, sentTwist.customDetails, "builder: a picked trainer exercise is saved with the trainer's details");
eq(saved["0:Legs"][1].customDetails, undefined, "builder: the client's own custom exercise isn't stamped (their list has it)");
// ...so it outlives the trainer's program.
const clientProgram = program("mine", "created", saved);
eq(musclesForExercise("Landmine Twist", knownCustomExercises(clientOwn, carriedExercises([clientProgram]))), ["Core", "Shoulders"],
  "builder: with the trainer's program deleted, the client's own program still knows it");

// A builder swap renames the row and leaves the old details on it; the save
// clears them rather than label another exercise with them.
const swapped: WorkoutMap = { "0:Push": [{ ...sentTwist, name: "Barbell Bench Press" }, { ...sentTwist, name: "Mystery Move" }] };
const afterSwap = stampCustomDetails(swapped, { own: [], stampOwn: false, carried: [] });
eq(afterSwap["0:Push"].map(e => e.customDetails), [undefined, undefined], "builder: a swapped-out exercise's details go with it");
eq(exerciseSummaryParams(swapped["0:Push"][1]), { exerciseName: "Mystery Move" }, "summary: ...and never open for the new name");
eq(exerciseSummaryParams(sentTwist).details, JSON.stringify(sentTwist.customDetails), "summary: a carried exercise opens with its details");

// ─── Both ends of a review ───────────────────────────────────────────────────
// The client sends their program for review: their own exercise goes as
// theirs, the trainer's keeps the trainer's details.
const forReview = send(saved, clientOwn, CLIENT, carriedExercises([accepted]));
eq(forReview["0:Legs"].map(e => e.customDetails?.by), [TRAINER, CLIENT], "review: each exercise keeps its own author");
// The client's own list wins a clash on their phone, and the carried copy of
// the trainer's is the one the program was sent with, not a newer one elsewhere.
const newer: CarriedExercise = { ...sentTwist.customDetails!, steps: ["A newer version"] };
const kept = stampCustomDetails(saved, { own: clientOwn, stampOwn: false, carried: [newer] });
eq(kept["0:Legs"][0].customDetails?.steps, twist.steps, "review: an exercise keeps the version it was sent with");
eq(knownCustomExercises([{ name: "Landmine Twist", muscles: ["Legs"] }], [sentTwist.customDetails!])[0].muscles, ["Legs"],
  "lookup: your own exercise wins a name clash");

// The active program's copy wins over an older program's.
const older = program("older", "completed", { "0:Push": [ex("o1", "Landmine Twist", { customDetails: newer })] });
eq(carriedExercises([older, accepted])[0].steps, twist.steps, "lookup: the active program's version wins");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
