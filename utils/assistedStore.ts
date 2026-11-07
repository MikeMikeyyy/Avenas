// utils/assistedStore.ts
//
// Fills utils/assisted.ts's lists of custom exercises from storage: your own
// (CUSTOM_KEY) and the ones carried in your programs. At launch, before the
// splash lifts (app/_layout.tsx), and again after anything brings in a change
// to either: Create Exercise's save, a restore or merge from the backup, a
// program accepted or a review taken back (utils/trainerStore.ts). Local
// reads only.

import { CUSTOM_KEY, type CustomExercise } from "../constants/exercises";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import { noteAssistedCustoms } from "./assisted";
import { carriedExercises } from "./customExerciseDetails";
import { getJSON } from "./storage";

export async function refreshAssisted(): Promise<void> {
  const [own, programs] = await Promise.all([
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
  ]);
  noteAssistedCustoms("own", Array.isArray(own) ? own : []);
  noteAssistedCustoms("carried", Array.isArray(programs) ? carriedExercises(programs) : []);
}
