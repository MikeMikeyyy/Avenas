// utils/exerciseFavourites.ts
//
// Starred exercises: the set of names the user wants at the top of the picker.
//
// Identity is the exercise NAME, trimmed and lowercased — the same handle the
// picker already uses to select and to de-duplicate (`pickedOrder` is names,
// custom exercises are keyed by name). That means one list covers both the
// curated catalogue and the user's own custom exercises without a second
// storage shape.
//
// Favourites are DEVICE-LOCAL (FAVOURITE_EXERCISES_KEY), like the picker's
// set-count stepper. They are deliberately not part of the cloud snapshot; if
// they ever should be, that needs a Supabase column, database.types and a
// mapper, or the round-trip drops them.
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-exercise-favourites.ts).

import { MUSCLE_GROUPS, type SelectableMuscle } from "../constants/exercises";

/** Muscle groups in the order the picker lists them, "All" stripped. */
export const MUSCLE_ORDER: SelectableMuscle[] = MUSCLE_GROUPS.filter(
  (m): m is SelectableMuscle => m !== "All",
);

/** Canonical form for matching a favourite across sessions. Matches the
 *  trim + lowercase convention used for exercise names everywhere else. */
export function normalizeFavourite(name: string): string {
  return name.trim().toLowerCase();
}

/** Is `name` starred? */
export function isFavourite(favourites: readonly string[], name: string): boolean {
  const key = normalizeFavourite(name);
  return favourites.some(f => normalizeFavourite(f) === key);
}

/**
 * `favourites` with `name` added or removed. Stores the name as given (so the
 * list stays readable) but compares normalized, so re-starring an exercise
 * under different casing removes it rather than adding a duplicate.
 */
export function toggleFavourite(favourites: readonly string[], name: string): string[] {
  const key = normalizeFavourite(name);
  const without = favourites.filter(f => normalizeFavourite(f) !== key);
  return without.length === favourites.length ? [...favourites, name.trim()] : without;
}

/** Where a muscle group sits in the picker's order. Unknown or missing muscles
 *  sort last rather than colliding with "Chest" at index 0. */
export function muscleOrderIndex(muscle: SelectableMuscle | undefined): number {
  if (!muscle) return MUSCLE_ORDER.length;
  const i = MUSCLE_ORDER.indexOf(muscle);
  return i === -1 ? MUSCLE_ORDER.length : i;
}

/**
 * Sort favourited items by muscle group (picker order: Chest, Back, Shoulders,
 * Legs, Arms, Core), then alphabetically inside each group.
 *
 * Grouping without section headers is deliberate: the favourites block is meant
 * to be a short glanceable list at the top of the sheet, and a header per
 * muscle would out-weigh the handful of rows under it.
 *
 * Returns a new array; the input is never mutated.
 */
export function sortByMuscleThenName<T>(
  items: readonly T[],
  muscleOf: (item: T) => SelectableMuscle | undefined,
  nameOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const ma = muscleOrderIndex(muscleOf(a));
    const mb = muscleOrderIndex(muscleOf(b));
    if (ma !== mb) return ma - mb;
    return nameOf(a).localeCompare(nameOf(b));
  });
}
