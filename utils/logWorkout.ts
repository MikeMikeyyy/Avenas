// utils/logWorkout.ts
//
// Log Workout's exercises (app/log-workout.tsx: a session entered after the
// fact, from the Journal): a program day's as the page opens them, and what
// its Save writes. Pure, so the solo flows run the page's own load and save.
//
// Supersets (utils/supersets.ts; user request, 2026-11-15): the day's come
// with it, so a session logged afterwards is joined as one done on the Workout
// tab is, and Superset With on a card (components/SupersetSheet.tsx) pairs
// exercises for this log alone, like a swap: the program keeps its own. There's
// no rest or round order here, only the numbers after the fact, so a superset
// is the pairing saved.

import { normaliseSets, type CompletedExercise, type Exercise, type ProgramSet } from "../constants/programs";
import { parseWeightToKg } from "./units";
import { cleanSupersets, supersetIdsOf } from "./supersets";

/** A set as a card holds it: the numbers as typed, in the log's unit, and the
 *  program's target, shown as its placeholders. */
export type LogSet = { type: "warmup" | "working"; weight: string; reps: string; done: boolean; programSet?: ProgramSet };

export type LogExercise = {
  id: string;
  name: string;
  /** Which custom exercise it is (CompletedExercise.customId). */
  customId?: string;
  sets: LogSet[];
  notes: string;
  programNotes?: string;
  isIsometric?: boolean;
  /** What this was swapped in for; saved as CompletedExercise.swappedFrom. */
  swappedFrom?: string;
  swappedFromId?: string;
  /** Which program exercise this is: its id in the day's template. `id` above
   *  is the page's own row id, freshly made, so the program's is kept here.
   *  Absent for one added here. Saved as CompletedExercise.programExerciseId. */
  programExerciseId?: string;
  /** Done in rounds with the ones beside it with the same id: the day's
   *  superset, or one made here. Saved only where it's real. */
  supersetId?: string;
};

/** A card's own id. */
export function makeLogId(): string {
  return `lex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** A program day's exercises as Log Workout opens them: each set empty and
 *  unticked with the program's target as its placeholder, and the day's
 *  supersets. */
export function logExercisesFor(template: readonly Exercise[], makeId: () => string = makeLogId): LogExercise[] {
  return cleanSupersets(template.map((ex): LogExercise => ({
    id: makeId(),
    name: ex.name,
    ...(ex.customId ? { customId: ex.customId } : {}),
    sets: normaliseSets(ex).map(ps => ({ type: ps.type, weight: "", reps: "", done: false, programSet: ps })),
    notes: "",
    programNotes: ex.programNotes,
    isIsometric: ex.isIsometric,
    programExerciseId: ex.id,
    ...(ex.supersetId ? { supersetId: ex.supersetId } : {}),
  })));
}

/** What Save writes: every set as it stands, the weights typed in the log's
 *  unit stored as kg, and a superset only where it's real (two or more side by
 *  side). */
export function loggedExercises(exercises: readonly LogExercise[], isKg: boolean): CompletedExercise[] {
  const supersets = supersetIdsOf(exercises);
  return exercises.map((ex, i) => ({
    name: ex.name,
    // Which custom exercise it was (utils/exerciseNames.ts exerciseIdentity).
    ...(ex.customId ? { customId: ex.customId } : {}),
    sets: ex.sets.map(s => ({ type: s.type, weight: parseWeightToKg(s.weight, isKg), reps: s.reps, done: s.done })),
    notes: ex.notes,
    ...(ex.swappedFrom ? { swappedFrom: ex.swappedFrom } : {}),
    ...(ex.swappedFrom && ex.swappedFromId ? { swappedFromId: ex.swappedFromId } : {}),
    ...(ex.programExerciseId ? { programExerciseId: ex.programExerciseId } : {}),
    // The Hold switch (CompletedExercise.isIsometric).
    ...(ex.isIsometric ? { isIsometric: true as const } : {}),
    // Done in rounds with the ones beside it (CompletedExercise.supersetId).
    ...(supersets[i] ? { supersetId: supersets[i] } : {}),
  }));
}
