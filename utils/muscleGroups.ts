// utils/muscleGroups.ts
//
// Resolves a logged exercise *name* to the muscle group(s) it trains, bridging
// the two catalogues that store muscle data:
//   - bundled exercises (constants/exerciseData.ts) carry a single
//     `primaryMuscle`.
//   - custom exercises (CUSTOM_KEY) carry a `muscles: SelectableMuscle[]` array.
//
// Workouts only ever store an exercise `name` (see CompletedExercise), so this
// is the single place that maps a name back to its muscle group, mirroring the
// name→id bridge in utils/exerciseLookup.ts.

import { EXERCISES } from "../constants/exerciseData";
import type { CustomExercise, SelectableMuscle } from "../constants/exercises";

// Canonical axis order for the Strength radar. The hexagon is flat-topped:
// Chest sits top-left, then clockwise — Back (top-right), Legs (right),
// Core (bottom-right), Shoulders (bottom-left), Arms (left) — matching the
// reference design. Deliberately separate from MUSCLE_GROUPS (which leads
// with "All" and uses a different order for the picker filter).
export const RADAR_GROUPS: SelectableMuscle[] = [
  "Chest",
  "Back",
  "Legs",
  "Core",
  "Shoulders",
  "Arms",
];

// Same normalization as utils/exerciseLookup.ts so the two stay in lockstep.
const PRIMARY_BY_NAME = new Map<string, SelectableMuscle>(
  EXERCISES.map(e => [e.name.trim().toLowerCase(), e.primaryMuscle]),
);

/**
 * Muscle group(s) an exercise name trains.
 *   - bundled exercise → `[primaryMuscle]`
 *   - custom exercise  → its `muscles` array (deduped, drops empties)
 *   - no match         → `[]` (uncategorized; excluded from the radar)
 *
 * Custom exercises win over bundled only when a name isn't in the catalogue;
 * bundled names are unique slugs so collisions are not expected. Callers pass
 * the loaded `CustomExercise[]` explicitly to keep this pure/testable.
 */
export function musclesForExercise(
  name: string,
  customExercises: CustomExercise[],
): SelectableMuscle[] {
  const key = name.trim().toLowerCase();
  const primary = PRIMARY_BY_NAME.get(key);
  if (primary) return [primary];
  const custom = customExercises.find(c => c.name.trim().toLowerCase() === key);
  if (custom && custom.muscles.length > 0) {
    return Array.from(new Set(custom.muscles));
  }
  return [];
}
