// Client wrappers for real account-to-account chat (migration 0011). Messages
// between connected accounts live in Supabase keyed by auth uid, so both sides
// of an accepted connection read the same thread and history survives
// sign-out / account switches on this device. RN-only (imports the Supabase
// client).
//
// utils/chatStore.ts is the store the screens talk to — it routes each contact
// here when the id is an auth uid (real connection) and to the legacy local
// blob otherwise (mock roster people, offline).

import { supabase } from "./supabase";
import type { MessageRow, ChatReadRow } from "./database.types";
import type { ChatMessage, ChatThreads, ChatReads } from "../constants/chat";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a contact id is an auth uid (real connection) rather than a
 *  locally-generated mock-roster id. */
export function isCloudContactId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Current session's user id, or null when signed out. Local read — no network. */
export async function getMyUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

const toChatMessage = (r: MessageRow, uid: string): ChatMessage => ({
  id: r.id,
  mine: r.sender_id === uid,
  text: r.body,
  sentAtISO: r.created_at,
});

/** All of my cloud messages grouped per peer, oldest → newest per thread. */
export async function fetchAllCloudThreads(uid: string): Promise<ChatThreads> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`sender_id.eq.${uid},recipient_id.eq.${uid}`)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load messages: ${error.message}`);
  const out: ChatThreads = {};
  for (const r of (data as MessageRow[] | null) ?? []) {
    const peer = r.sender_id === uid ? r.recipient_id : r.sender_id;
    (out[peer] ??= []).push(toChatMessage(r, uid));
  }
  return out;
}

/** One conversation with `otherId`, oldest → newest. */
export async function fetchCloudThread(uid: string, otherId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`and(sender_id.eq.${uid},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${uid})`)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`load thread: ${error.message}`);
  return ((data as MessageRow[] | null) ?? []).map(r => toChatMessage(r, uid));
}

/** Insert one message; returns the stored row mapped for the UI. Throws when
 *  the insert is rejected (offline, or no accepted connection — e.g. blocked). */
export async function sendCloudMessage(uid: string, otherId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ sender_id: uid, recipient_id: otherId, body })
    .select()
    .single();
  if (error) throw new Error(`send message: ${error.message}`);
  return toChatMessage(data as MessageRow, uid);
}

/** One bulk insert for a broadcast — a separate 1:1 message per recipient,
 *  mirroring broadcastMessage's "not a group chat" semantics. */
export async function sendCloudBroadcast(uid: string, otherIds: string[], body: string): Promise<void> {
  if (otherIds.length === 0) return;
  const { error } = await supabase
    .from("messages")
    .insert(otherIds.map(recipient_id => ({ sender_id: uid, recipient_id, body })));
  if (error) throw new Error(`send broadcast: ${error.message}`);
}

/** peer_id → last_read_at for my account ({} when none). */
export async function fetchCloudReads(uid: string): Promise<ChatReads> {
  const { data, error } = await supabase
    .from("chat_reads")
    .select("*")
    .eq("user_id", uid);
  if (error) throw new Error(`load chat reads: ${error.message}`);
  const out: ChatReads = {};
  for (const r of (data as ChatReadRow[] | null) ?? []) out[r.peer_id] = r.last_read_at;
  return out;
}

/** Stamp a thread read as of now (upsert on (user, peer)). */
export async function markCloudThreadRead(uid: string, peerId: string): Promise<void> {
  const { error } = await supabase
    .from("chat_reads")
    .upsert({ user_id: uid, peer_id: peerId, last_read_at: new Date().toISOString() });
  if (error) throw new Error(`mark thread read: ${error.message}`);
}

/** Live inbound messages: fires with the sender's id on every INSERT addressed
 *  to me (Postgres Changes respects the RLS select policy). Returns an
 *  unsubscribe. The open thread uses this to refresh without waiting for a
 *  refocus; delivery still works without it via the focus-effect reloads. */
export function subscribeToInbound(uid: string, onInbound: (senderId: string) => void): () => void {
  const channel = supabase
    .channel(`inbound_messages_${uid}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${uid}` },
      payload => onInbound((payload.new as MessageRow).sender_id),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
