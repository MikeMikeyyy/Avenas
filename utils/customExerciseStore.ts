// utils/customExerciseStore.ts
//
// Deleting or renaming one of your custom exercises (the rules are
// utils/customExercises.ts). Every screen's delete goes through here, so they
// all do the same thing: the builder's used to take it out of the program being
// edited and no other, the Workout tab's only out of the list, and the
// Journal's and a workout page's weren't backed up.

import * as FileSystem from "expo-file-system/legacy";
import { CUSTOM_KEY, FAVOURITE_EXERCISES_KEY, type CustomExercise } from "../constants/exercises";
import { NEW_PROGRAM_DRAFT_KEY, PROGRAMS_KEY, type SavedProgram, type WorkoutMap } from "../constants/programs";
import { scheduleCloudPush } from "../lib/syncManager";
import { isRemoteUri } from "./customExerciseDetails";
import { liveIndexOf, tombstoneOf, withRenamedCustom, withoutCustomExercise } from "./customExercises";
import { todayYMD } from "./dates";
import { normalizeFavourite } from "./exerciseFavourites";
import { getJSON, setJSON } from "./storage";

/**
 * Delete your live custom exercise called `name`. What was logged with it
 * stays (a session is never rewritten), and so does what those sessions are
 * read with: the exercise stays in the list, hidden (tombstoneOf). The rest of
 * it goes: out of every saved program and the builder's draft, its photo and
 * video off the phone, its star. Backed up. Returns the list as it now stands,
 * for the caller's state; unchanged when there's no live exercise of that name.
 */
export async function deleteCustomExercise(name: string): Promise<CustomExercise[]> {
  const list = await getJSON<CustomExercise[]>(CUSTOM_KEY, []);
  const i = liveIndexOf(list, name);
  if (i < 0) return list;
  const target = list[i];
  const next = list.map((c, j) => (j === i ? tombstoneOf(c, todayYMD()) : c));
  await setJSON(CUSTOM_KEY, next);

  // Out of every program, finished ones too (one can be run again), and the
  // one in the builder.
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  let changed = false;
  const kept = programs.map(p => {
    const workouts = withoutCustomExercise(p.workouts ?? {}, target);
    if (workouts === p.workouts) return p;
    changed = true;
    return { ...p, workouts };
  });
  if (changed) await setJSON(PROGRAMS_KEY, kept);
  const draft = await getJSON<{ workouts?: WorkoutMap } | null>(NEW_PROGRAM_DRAFT_KEY, null);
  if (draft?.workouts) {
    const workouts = withoutCustomExercise(draft.workouts, target);
    if (workouts !== draft.workouts) await setJSON(NEW_PROGRAM_DRAFT_KEY, { ...draft, workouts });
  }

  // Its star, so a new exercise later given its name starts without one.
  const favourites = await getJSON<string[]>(FAVOURITE_EXERCISES_KEY, []);
  const key = normalizeFavourite(target.name);
  const unstarred = favourites.filter(f => normalizeFavourite(f) !== key);
  if (unstarred.length !== favourites.length) await setJSON(FAVOURITE_EXERCISES_KEY, unstarred);

  // Its photo and video, off the phone. A copy uploaded with a program you
  // sent stays: the people it went to still show it.
  for (const uri of [target.imageUri, target.videoUri]) {
    if (uri && !isRemoteUri(uri)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }

  scheduleCloudPush();
  return next;
}

/**
 * Carry a rename of `target` (as it was before the edit) to `name` through
 * every saved program, the builder's draft and its star. The list itself is the
 * caller's (create-custom-exercise writes it, then calls this), and so is the
 * backup. Only rows that are this exercise: one made before ids by its name,
 * and never a trainer's exercise of the same name carried with a program.
 */
export async function renameCustomExercise(target: CustomExercise, name: string): Promise<void> {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  let changed = false;
  const renamed = programs.map(p => {
    const workouts = withRenamedCustom(p.workouts ?? {}, target, name);
    if (workouts === p.workouts) return p;
    changed = true;
    return { ...p, workouts };
  });
  if (changed) await setJSON(PROGRAMS_KEY, renamed);
  const draft = await getJSON<{ workouts?: WorkoutMap } | null>(NEW_PROGRAM_DRAFT_KEY, null);
  if (draft?.workouts) {
    const workouts = withRenamedCustom(draft.workouts, target, name);
    if (workouts !== draft.workouts) await setJSON(NEW_PROGRAM_DRAFT_KEY, { ...draft, workouts });
  }

  // Its star moves with it: left under the old name, it would star a new
  // exercise later given that name.
  const favourites = await getJSON<string[]>(FAVOURITE_EXERCISES_KEY, []);
  const oldKey = normalizeFavourite(target.name);
  if (oldKey !== normalizeFavourite(name) && favourites.some(f => normalizeFavourite(f) === oldKey)) {
    const kept = favourites.filter(f => normalizeFavourite(f) !== oldKey);
    if (!kept.some(f => normalizeFavourite(f) === normalizeFavourite(name))) kept.push(name);
    await setJSON(FAVOURITE_EXERCISES_KEY, kept);
  }
}
