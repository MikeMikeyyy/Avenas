// lib/blocks.ts
//
// Blocks on the server (migration 0040). RN-only (imports the Supabase client).
// utils/moderation.ts owns the flow: the phone's own list is what hides people
// on this device, and these calls are how the server (which severs, takes them
// out of the blocker's groups, and stops their notifications) and the
// blocker's other devices find out. Each throws when it can't reach the server
// or the migration isn't there yet, so the caller can leave the block marked
// unsent.

import { supabase } from "./supabase";

/** Current session's user id, or null when signed out. Local read, no network. */
async function myUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export type ServerBlock = { id: string; name: string; blockedAtISO: string };

/** Everyone I've blocked, as the server has it. */
export async function fetchMyBlocks(): Promise<ServerBlock[]> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { data, error } = await supabase
    .from("blocks")
    .select("blocked_id, name, created_at")
    .eq("blocker_id", uid);
  if (error) throw new Error(`load blocks: ${error.message}`);
  return ((data as { blocked_id: string; name: string | null; created_at: string }[] | null) ?? []).map(r => ({
    id: r.blocked_id,
    name: r.name ?? "",
    blockedAtISO: r.created_at,
  }));
}

/** Record a block. Already recorded is success (the primary key refuses a
 *  second row, and upsert-ignore makes that a no-op). */
export async function insertBlock(blockedId: string, name: string): Promise<void> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { error } = await supabase
    .from("blocks")
    .upsert({ blocker_id: uid, blocked_id: blockedId, name }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
  if (error) throw new Error(`record block: ${error.message}`);
}

/** Lift a block. Nothing to lift is success. */
export async function deleteBlock(blockedId: string): Promise<void> {
  const uid = await myUid();
  if (!uid) throw new Error("not signed in");
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", uid)
    .eq("blocked_id", blockedId);
  if (error) throw new Error(`lift block: ${error.message}`);
}
