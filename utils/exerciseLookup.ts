// Resolves a stored exercise name back to its catalogue id.
//
// Programs and workouts store exercises by `name` (a plain string), but the
// bundled image maps are keyed by the catalogue `id` slug. This bridges the
// two so any screen holding only a name can still render <ExerciseImage>.

import { EXERCISES } from "../constants/exerciseData";
import type { Exercise } from "../constants/exercises";

const ID_BY_NAME = new Map<string, string>(
  EXERCISES.map(e => [e.name.trim().toLowerCase(), e.id]),
);

const EXERCISE_BY_NAME = new Map<string, Exercise>(
  EXERCISES.map(e => [e.name.trim().toLowerCase(), e]),
);

/**
 * Catalogue id for an exercise name, or `undefined` if it isn't a bundled
 * exercise (e.g. a user's custom exercise). Pass the result straight to
 * <ExerciseImage exerciseId={...}> — it falls back to a tile when unmatched.
 */
export function exerciseIdByName(name: string): string | undefined {
  return ID_BY_NAME.get(name.trim().toLowerCase());
}

/**
 * Full catalogue entry for an exercise name (muscles/equipment/instructions),
 * or `undefined` for custom exercises not in the bundled set.
 */
export function exerciseByName(name: string): Exercise | undefined {
  return EXERCISE_BY_NAME.get(name.trim().toLowerCase());
}
