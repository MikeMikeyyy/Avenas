// utils/exerciseRenameMigration.ts
//
// Saved programs and favourites take the catalogue's current exercise names
// (`Exercise.formerNames`, utils/exerciseNames.ts). Logged workouts are never
// rewritten: they keep the name they were logged under, and every lookup reads
// that name through exerciseKey, so their history still counts. Programs and
// favourites are live, though, and a since-renamed name there only confuses:
// "Dumbbell Lateral Raise" in a program, "Lateral Raise" in the picker.
//
// Runs on EVERY launch, not once: a program can arrive later carrying an old
// name (a trainer's program accepted from before the rename, a backup brought
// back), and the pass is cheap and writes only when something changed. Gated at
// startup with the one-shot migrations (app/_layout.tsx), after them, so no
// screen reads a program halfway through.
//
// A name that belongs to a custom exercise is the user's or a trainer's own
// word and is never renamed: an exercise carrying custom details, or named like
// one of the user's own custom exercises.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROGRAMS_KEY, type Exercise, type SavedProgram } from "../constants/programs";
import { CUSTOM_KEY, FAVOURITE_EXERCISES_KEY, type CustomExercise } from "../constants/exercises";
import { currentExerciseName, exerciseKey, isFormerExerciseName } from "./exerciseNames";

const lower = (s: string) => s.trim().toLowerCase();

/** `ex` under its current catalogue name, or `ex` itself when nothing changes. */
function renamed(ex: Exercise, customNames: ReadonlySet<string>): Exercise {
  if (ex.customDetails || customNames.has(lower(ex.name)) || !isFormerExerciseName(ex.name)) return ex;
  return { ...ex, name: currentExerciseName(ex.name) };
}

/** Programs with every renamed catalogue exercise under its current name.
 *  Pure; an unchanged program comes back as the same object. */
export function renameProgramExercises(
  programs: SavedProgram[],
  customNames: ReadonlySet<string>,
): { programs: SavedProgram[]; changed: boolean } {
  let changed = false;
  const next = programs.map(p => {
    let programChanged = false;
    const workouts: SavedProgram["workouts"] = {};
    for (const [day, list] of Object.entries(p.workouts ?? {})) {
      workouts[day] = list.map(ex => {
        const r = renamed(ex, customNames);
        if (r !== ex) programChanged = true;
        return r;
      });
    }
    if (!programChanged) return p;
    changed = true;
    return { ...p, workouts };
  });
  return { programs: changed ? next : programs, changed };
}

/** Favourites under current names, without duplicates (starring "Dumbbell
 *  Lateral Raise" and "Lateral Raise" is one star). Pure. */
export function renameFavourites(
  favourites: string[],
  customNames: ReadonlySet<string>,
): { favourites: string[]; changed: boolean } {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const f of favourites) {
    const name = customNames.has(lower(f)) ? f : currentExerciseName(f);
    const key = customNames.has(lower(f)) ? lower(f) : exerciseKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(name);
  }
  const changed = next.length !== favourites.length || next.some((n, i) => n !== favourites[i]);
  return { favourites: changed ? next : favourites, changed };
}

/** Apply the catalogue's renames to saved programs and favourites. Awaited at
 *  startup, after the one-shot migrations, before any screen reads them. */
export async function runExerciseRenames(): Promise<void> {
  try {
    const [progRaw, favRaw, customRaw] = await Promise.all([
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(FAVOURITE_EXERCISES_KEY),
      AsyncStorage.getItem(CUSTOM_KEY),
    ]);
    const customs: CustomExercise[] = customRaw ? JSON.parse(customRaw) : [];
    const customNames = new Set(customs.map(c => lower(c.name)));
    const pairs: [string, string][] = [];
    if (progRaw) {
      const r = renameProgramExercises(JSON.parse(progRaw), customNames);
      if (r.changed) pairs.push([PROGRAMS_KEY, JSON.stringify(r.programs)]);
    }
    if (favRaw) {
      const parsed = JSON.parse(favRaw);
      if (Array.isArray(parsed)) {
        const r = renameFavourites(parsed.filter((n): n is string => typeof n === "string"), customNames);
        if (r.changed) pairs.push([FAVOURITE_EXERCISES_KEY, JSON.stringify(r.favourites)]);
      }
    }
    if (pairs.length) await AsyncStorage.multiSet(pairs);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] exercise renames", e);
  }
}
