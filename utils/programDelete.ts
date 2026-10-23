// utils/programDelete.ts
//
// A program deleted for good (My Programs' Delete, or the archive's): what its
// sessions keep of it. They stay in the Journal and move to Progress's Custom
// workouts, being in no program now, and each keeps the program's name
// (CompletedWorkout.programName) so it can still say whose it was (user
// request, 2026-10-23): "From Push Pull Legs" on its day there, the program's
// name on Exercise History. The program's id stays on them too until a
// restore, which can't point a session at a program it doesn't have; the name
// is synced (0052), so it outlasts that.
//
// Pure apart from keepDeletedProgramName, so scripts/verify-custom-workouts.ts
// covers it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { workoutBelongsToProgram } from "./progressStats";

/** `history` with `program`'s name on each session of it, or null when none
 *  needed it. */
export function withDeletedProgramName(history: readonly CompletedWorkout[], program: SavedProgram): CompletedWorkout[] | null {
  let changed = false;
  const next = history.map(w => {
    if (w.programName === program.name || !workoutBelongsToProgram(w, program)) return w;
    changed = true;
    return { ...w, programName: program.name };
  });
  return changed ? next : null;
}

/**
 * Before `program` is deleted: its name onto its sessions. The history is read
 * and written in one go, and one that can't be read is left alone. A failure
 * doesn't stop the delete: the sessions just say "From a deleted program".
 */
export async function keepDeletedProgramName(program: SavedProgram): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
    if (!raw) return;
    const history: unknown = JSON.parse(raw);
    if (!Array.isArray(history)) return;
    const next = withDeletedProgramName(history as CompletedWorkout[], program);
    if (next) await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(next));
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "keepDeletedProgramName", WORKOUT_HISTORY_KEY, e);
  }
}
