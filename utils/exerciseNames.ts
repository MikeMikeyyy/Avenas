// Exercise identity across renames.
//
// Workouts, programs and favourites store an exercise by its NAME, and a
// logged session is never rewritten. So when the catalogue renames an exercise
// ("Dumbbell Lateral Raise" became "Lateral Raise"), every place that
// recognises an exercise by name has to treat the old name as the new one, or
// its history, "last time" numbers, charts and records start again from zero.
//
// The catalogue records each exercise's former names (`Exercise.formerNames`,
// from scripts/exercise-library.json). A former name is never also a live
// exercise's name (the build refuses it), and an entry keeps EVERY name it has
// had, so one lookup is enough even after several renames.

import { EXERCISES } from "../constants/exerciseData";

const lower = (s: string) => s.trim().toLowerCase();

/** Former name (trimmed, lowercased) → the exercise's current name. */
const CURRENT_BY_FORMER = new Map<string, string>();
for (const e of EXERCISES) for (const f of e.formerNames ?? []) CURRENT_BY_FORMER.set(lower(f), e.name);

/** The name an exercise goes by now: the catalogue's current name when `name`
 *  is one it used to have, otherwise `name` unchanged. */
export function currentExerciseName(name: string): string {
  return CURRENT_BY_FORMER.get(lower(name)) ?? name;
}

/** The key that identifies an exercise: trimmed, lowercased, with a former
 *  name resolved to the current one. Compare exercise names through this,
 *  never through `toLowerCase()` alone. */
export function exerciseKey(name: string): string {
  return lower(currentExerciseName(name));
}

/** True when `name` is a name the catalogue has retired by renaming. */
export function isFormerExerciseName(name: string): boolean {
  return CURRENT_BY_FORMER.has(lower(name));
}
