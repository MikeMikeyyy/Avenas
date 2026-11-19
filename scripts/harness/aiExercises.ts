// The AI program builder's exercise list, from the catalogue: shared by
// scripts/build-ai-exercises.ts (which writes it) and scripts/verify-ai.ts
// (which checks the written copy still matches).

import type { Exercise } from "../../constants/exercises";

/** "Name | muscle | equipment" for every exercise the picker offers. */
export function aiExerciseLines(exercises: readonly Exercise[]): string[] {
  return exercises
    .filter(e => !e.hidden)
    .map(e => `${e.name} | ${e.primaryMuscle} | ${e.equipment}`)
    .sort((a, b) => a.localeCompare(b));
}
