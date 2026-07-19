// utils/chatStore.ts
//
// Chat data layer the screens talk to. Since migration 0011 this is a HYBRID:
//   - real connections (contact id = auth uid) → Supabase `messages`/`chat_reads`
//     via lib/chat.ts, so both accounts see the same thread and history survives
//     account switches on this device;
//   - mock-roster people (local non-uuid ids) and signed-out use → the legacy
//     local AsyncStorage blob (one CHATS_KEY map, contactId → messages).
// Cloud reads degrade gracefully offline (local-only view); cloud SENDS throw
// so the UI can tell the user instead of silently keeping a message the other
// side would never receive.

import { getJSON, setJSON, removeKey } from "./storage";
import { loadClients, loadCoaches, loadAssignedPT, loadOtherTrainers } from "./trainerStore";
import {
  getMyUid, isCloudContactId, fetchAllCloudThreads, fetchCloudThread,
  sendCloudMessage, sendCloudBroadcast, fetchCloudReads, markCloudThreadRead,
} from "../lib/chat";
import { CHATS_KEY, CHAT_READS_KEY, type ChatMessage, type ChatThreads, type ChatReads, type ChatContact } from "../constants/chat";
import type { AccountType } from "../contexts/AccountTypeContext";

// ─── contacts (who you can message) ──────────────────────────────────────────

/**
 * Everyone the current account can message, normalised to ChatContact:
 *   - trainer (pt):  their clients + their coaches
 *   - gym user:      their primary trainer + any other trainers
 * Deduped by id (a person added in two roles shows once).
 */
export async function loadChatContacts(accountType: AccountType): Promise<ChatContact[]> {
  const out: ChatContact[] = [];
  if (accountType === "pt") {
    const [clients, coaches] = await Promise.all([loadClients(), loadCoaches()]);
    for (const c of clients) out.push({ id: c.id, name: c.name, initials: c.initials, subtitle: c.note || "Client", photoUri: c.photoUri });
    for (const c of coaches) out.push({ id: c.id, name: c.name, initials: c.initials, subtitle: "Coach", photoUri: c.photoUri });
  } else {
    const [primary, others] = await Promise.all([loadAssignedPT(), loadOtherTrainers()]);
    if (primary) out.push({ id: primary.id, name: primary.name, initials: primary.initials, subtitle: "Your trainer", photoUri: primary.photoUri });
    for (const tr of others) out.push({ id: tr.id, name: tr.name, initials: tr.initials, subtitle: "Trainer", photoUri: tr.photoUri });
  }
  const seen = new Set<string>();
  return out.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

// ─── local blob (legacy mock threads) ────────────────────────────────────────

/**
 * The local threads map, stripping any legacy demo-seed messages. Earlier
 * builds injected synthetic `seed_*` inbound messages with Date.now()-relative
 * timestamps; we no longer seed, and leftovers from older builds are pruned
 * here on load so the bogus "Today" messages clean themselves up.
 */
async function loadLocalThreads(): Promise<ChatThreads> {
  const all = await getJSON<ChatThreads>(CHATS_KEY, {});
  let changed = false;
  for (const id of Object.keys(all)) {
    const pruned = all[id].filter(m => !m.id.startsWith("seed_"));
    if (pruned.length !== all[id].length) {
      all[id] = pruned;
      changed = true;
    }
  }
  if (changed) await setJSON(CHATS_KEY, all);
  return all;
}

/** Wipe local chat threads + read state. Called on account delete / switch so
 *  one account's conversations don't leak into the next (see clearLocalUserData).
 *  Cloud threads are untouched — they belong to the account, not the device. */
export async function clearChatData(): Promise<void> {
  await Promise.all([removeKey(CHATS_KEY), removeKey(CHAT_READS_KEY)]);
}

// ─── threads (merged local + cloud) ──────────────────────────────────────────

const byTime = (a: ChatMessage, b: ChatMessage) =>
  new Date(a.sentAtISO).getTime() - new Date(b.sentAtISO).getTime();

/** Interleave a thread's local (pre-0011 / mock) and cloud messages by time.
 *  The id spaces are disjoint, so no dedupe is needed. */
function mergeThreads(local: ChatMessage[] | undefined, cloud: ChatMessage[]): ChatMessage[] {
  if (!local || local.length === 0) return cloud;
  return [...local, ...cloud].sort(byTime);
}

/** Every conversation, contactId → messages oldest → newest. Cloud threads are
 *  merged in when signed in; offline (or signed out) falls back to local only. */
export async function loadAllThreads(): Promise<ChatThreads> {
  const local = await loadLocalThreads();
  const uid = await getMyUid();
  if (!uid) return local;
  try {
    const cloud = await fetchAllCloudThreads(uid);
    const merged: ChatThreads = { ...local };
    for (const [peer, msgs] of Object.entries(cloud)) merged[peer] = mergeThreads(local[peer], msgs);
    return merged;
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load cloud threads", err);
    return local;
  }
}

/** Messages for one contact, oldest → newest ([] if none). */
export async function loadThread(contactId: string): Promise<ChatMessage[]> {
  const local = (await loadLocalThreads())[contactId] ?? [];
  const uid = await getMyUid();
  if (!uid || !isCloudContactId(contactId)) return local;
  try {
    return mergeThreads(local, await fetchCloudThread(uid, contactId));
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load cloud thread", contactId, err);
    return local;
  }
}

// ─── read receipts (unread badges) ───────────────────────────────────────────

/** contactId → ISO time the thread was last opened ({} if none). Cloud stamps
 *  (which survive account switches) are merged in; newest stamp wins. */
export async function loadReads(): Promise<ChatReads> {
  const local = await getJSON<ChatReads>(CHAT_READS_KEY, {});
  const uid = await getMyUid();
  if (!uid) return local;
  try {
    const cloud = await fetchCloudReads(uid);
    const merged: ChatReads = { ...local };
    for (const [peer, iso] of Object.entries(cloud)) {
      const l = merged[peer];
      if (!l || new Date(iso).getTime() > new Date(l).getTime()) merged[peer] = iso;
    }
    return merged;
  } catch (err) {
    if (__DEV__) console.warn("[avenas] load cloud reads", err);
    return local;
  }
}

/**
 * Mark a thread read as of now — opening a conversation clears its unread badge
 * in the messages list. A later inbound message (sentAtISO after this stamp)
 * would surface as unread again. The cloud stamp is best-effort: a failure only
 * costs badge accuracy on the next device, never blocks the UI.
 */
export async function markThreadRead(contactId: string): Promise<void> {
  const local = await getJSON<ChatReads>(CHAT_READS_KEY, {});
  local[contactId] = new Date().toISOString();
  await setJSON(CHAT_READS_KEY, local);
  const uid = await getMyUid();
  if (uid && isCloudContactId(contactId)) {
    markCloudThreadRead(uid, contactId).catch(err => {
      if (__DEV__) console.warn("[avenas] mark cloud read", contactId, err);
    });
  }
}

/**
 * Number of inbound messages newer than the thread's read stamp. Opening the
 * thread (markThreadRead) advances the stamp to now, so this drops to 0 — which
 * is what makes the unread badge disappear once messages are read. With no read
 * stamp yet, every inbound message counts.
 */
export function countUnreadInThread(msgs: ChatMessage[], lastReadISO?: string): number {
  const readMs = lastReadISO ? new Date(lastReadISO).getTime() : 0;
  let n = 0;
  for (const m of msgs) {
    if (m.mine) continue;
    if (new Date(m.sentAtISO).getTime() > readMs) n++;
  }
  return n;
}

// ─── sending ─────────────────────────────────────────────────────────────────

// Collision-proof even within the same millisecond (broadcast loops).
function newId(suffix = ""): string {
  return `chat_${Date.now()}_${Math.floor(Math.random() * 1e6)}${suffix}`;
}

async function appendLocalMessages(contactIds: string[], text: string): Promise<ChatMessage[]> {
  const all = await getJSON<ChatThreads>(CHATS_KEY, {});
  const now = new Date().toISOString();
  const body = text.trim();
  const msgs = contactIds.map((cid, i) => {
    const msg: ChatMessage = { id: newId(contactIds.length > 1 ? `_${i}` : ""), mine: true, text: body, sentAtISO: now };
    all[cid] = [...(all[cid] ?? []), msg];
    return msg;
  });
  await setJSON(CHATS_KEY, all);
  return msgs;
}

/** Send one message; returns the stored message. Real connections go through
 *  the backend and THROW on failure (the screen alerts and restores the draft);
 *  mock contacts append to the local blob as before. */
export async function appendMessage(contactId: string, text: string): Promise<ChatMessage> {
  const uid = await getMyUid();
  if (uid && isCloudContactId(contactId)) {
    return sendCloudMessage(uid, contactId, text.trim());
  }
  const [msg] = await appendLocalMessages([contactId], text);
  return msg;
}

/**
 * Broadcast one message to several contacts' individual threads (a separate
 * entry per thread). Mirrors the "send a program to multiple people" flow in
 * PTHome — it's not a group chat, each conversation stays 1:1. Real connections
 * go in one backend insert (throws on failure); mock contacts stay local.
 */
export async function broadcastMessage(contactIds: string[], text: string): Promise<void> {
  const uid = await getMyUid();
  const cloudIds = uid ? contactIds.filter(isCloudContactId) : [];
  const localIds = contactIds.filter(id => !cloudIds.includes(id));
  if (localIds.length > 0) await appendLocalMessages(localIds, text);
  if (uid && cloudIds.length > 0) await sendCloudBroadcast(uid, cloudIds, text.trim());
}
