// lib/clientTraining.ts
//
// Reading the training of someone you coach (migration 0032). RN-only (imports
// the Supabase client). A dumb transport like lib/shares.ts: utils/trainerStore.ts
// owns the cache and the routing between real accounts and the mock roster.
//
// Who may read whom is decided entirely by the server (can_view_training: a
// trainer account with an accepted connection). Nothing here filters, so the
// app can never show more than the database agreed to hand over.

import { supabase } from "./supabase";
import { customFromRow, journalFromRow, programFromRow, workoutFromRow } from "./mappers";
import type { CustomExerciseRow, JournalRow, ProgramRow, WorkoutRow } from "./database.types";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";

export type ClientTraining = {
  workoutHistory: CompletedWorkout[];
  programs: SavedProgram[];
  journal: JournalEntry[];
  customExercises: CustomExercise[];
  /** When their phone last backed up (ISO), or undefined if it never has. */
  backedUpAt?: string;
};

type ClientTrainingPayload = {
  programs: ProgramRow[];
  workouts: WorkoutRow[];
  journal: JournalRow[];
  custom: CustomExerciseRow[];
  backed_up_at?: string | null;
};

/**
 * Everything one person has backed up, read in a single statement so the
 * programs and the workouts come from the same backup (every backup re-mints
 * the program ids the workouts point at).
 *
 * `null` means the server said no: you're not a trainer, or not connected to
 * them any more. Throws when it couldn't be asked at all (offline, signed out),
 * which callers treat differently, since that says nothing about access.
 */
export async function fetchClientTraining(clientId: string): Promise<ClientTraining | null> {
  const { data, error } = await supabase.rpc("get_client_training", { p_client: clientId });
  if (error) throw new Error(`load client training: ${error.message}`);
  const payload = data as ClientTrainingPayload | null;
  if (!payload) return null;
  return {
    programs: (payload.programs ?? []).map(programFromRow),
    workoutHistory: (payload.workouts ?? []).map(workoutFromRow),
    journal: (payload.journal ?? []).map(journalFromRow),
    customExercises: (payload.custom ?? []).map(customFromRow),
    backedUpAt: payload.backed_up_at ?? undefined,
  };
}

/** Each person's active program name, by id. Anyone the server won't let you
 *  read, or who has no active program, is simply absent. */
export async function fetchClientsActivePrograms(clientIds: string[]): Promise<Record<string, string>> {
  if (clientIds.length === 0) return {};
  const { data, error } = await supabase.rpc("get_clients_active_programs", { p_clients: clientIds });
  if (error) throw new Error(`load active programs: ${error.message}`);
  const rows = (data as { user_id: string; name: string }[] | null) ?? [];
  return Object.fromEntries(rows.map(r => [r.user_id, r.name]));
}
