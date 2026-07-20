// lib/shares.ts
//
// Row-level Supabase wrappers for cross-account program sharing (migration
// 0013). RN-only (imports the Supabase client). This module is a dumb
// transport: utils/trainerStore.ts owns the mapping between rows and the
// SharedProgram / SentProgram shapes the screens consume, plus the merge with
// the local mock roster's on-device entries.

import { supabase } from "./supabase";
import type { SharedProgramRow } from "./database.types";
import type { SavedProgram } from "../constants/programs";

export type { SharedProgramRow };

/** Current session's user id, or null when signed out. Local read — no network. */
export async function getMyUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Every share/review row I participate in, newest first. */
export async function fetchMyShareRows(uid: string): Promise<SharedProgramRow[]> {
  const { data, error } = await supabase
    .from("shared_programs")
    .select("*")
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("sent_at", { ascending: false });
  if (error) throw new Error(`load shares: ${error.message}`);
  return (data as SharedProgramRow[] | null) ?? [];
}

export async function fetchShareRow(id: string): Promise<SharedProgramRow | null> {
  const { data, error } = await supabase
    .from("shared_programs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load share: ${error.message}`);
  return (data as SharedProgramRow | null) ?? null;
}

export type NewShareRow = {
  recipientId: string;
  kind: "share" | "review";
  senderProgramId: string;
  programName: string;
  snapshot: SavedProgram;
  sentKey: string;
};

/** Insert one row per recipient. Throws when offline / signed out / not
 *  connected to a recipient — callers surface that instead of pretending the
 *  send worked (the whole point of the cloud path). */
export async function insertShareRows(uid: string, entries: NewShareRow[]): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase.from("shared_programs").insert(
    entries.map(e => ({
      sender_id: uid,
      recipient_id: e.recipientId,
      kind: e.kind,
      sender_program_id: e.senderProgramId,
      program_name: e.programName,
      snapshot: e.snapshot,
      sent_key: e.sentKey,
    })),
  );
  if (error) throw new Error(`send program: ${error.message}`);
}

/** Column-level patch. trainerStore maps SharedProgram/SentProgram field names
 *  to these columns; unknown fields must never reach here. */
export async function updateShareRow(
  id: string,
  patch: Partial<Pick<SharedProgramRow,
    "snapshot" | "program_name" | "last_edited_at" | "accepted_at" |
    "deleted_by_recipient_at" | "returned_at" | "trainer_comments" | "returned_snapshot"
  >>,
): Promise<void> {
  const { error } = await supabase.from("shared_programs").update(patch).eq("id", id);
  if (error) throw new Error(`update share: ${error.message}`);
}

/** Sender-only (RLS): unsend a share/review entirely. */
export async function deleteShareRow(id: string): Promise<void> {
  const { error } = await supabase.from("shared_programs").delete().eq("id", id);
  if (error) throw new Error(`delete share: ${error.message}`);
}
