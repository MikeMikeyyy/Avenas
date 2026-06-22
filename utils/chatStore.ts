// utils/chatStore.ts
//
// Mock chat data layer (local AsyncStorage only — see constants/chat.ts). Built
// on utils/storage.ts and the trainerStore people-loaders. All threads live in
// one CHATS_KEY blob (contactId → messages); few contacts/messages, so a single
// read/write is the simplest robust store and swaps cleanly to a backend later.

import { getJSON, setJSON, removeKey } from "./storage";
import { loadClients, loadCoaches, loadAssignedPT, loadOtherTrainers } from "./trainerStore";
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
    for (const c of clients) out.push({ id: c.id, name: c.name, initials: c.initials, subtitle: c.note || "Client" });
    for (const c of coaches) out.push({ id: c.id, name: c.name, initials: c.initials, subtitle: "Coach" });
  } else {
    const [primary, others] = await Promise.all([loadAssignedPT(), loadOtherTrainers()]);
    if (primary) out.push({ id: primary.id, name: primary.name, initials: primary.initials, subtitle: "Your trainer" });
    for (const tr of others) out.push({ id: tr.id, name: tr.name, initials: tr.initials, subtitle: "Trainer" });
  }
  const seen = new Set<string>();
  return out.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

// ─── threads ─────────────────────────────────────────────────────────────────

export async function loadAllChats(): Promise<ChatThreads> {
  return getJSON<ChatThreads>(CHATS_KEY, {});
}

/** Wipe local chat threads + read state. Called on account delete / switch so
 *  one account's conversations don't leak into the next (see clearLocalUserData). */
export async function clearChatData(): Promise<void> {
  await Promise.all([removeKey(CHATS_KEY), removeKey(CHAT_READS_KEY)]);
}

/** Messages for one contact, oldest → newest ([] if none). */
export async function loadThread(contactId: string): Promise<ChatMessage[]> {
  const all = await loadAllChats();
  return all[contactId] ?? [];
}

// ─── read receipts (unread badges) ───────────────────────────────────────────

/** contactId → ISO time the thread was last opened ({} if none). */
export async function loadReads(): Promise<ChatReads> {
  return getJSON<ChatReads>(CHAT_READS_KEY, {});
}

/**
 * Mark a thread read as of now — opening a conversation clears its unread badge
 * in the messages list. A later inbound message (sentAtISO after this stamp)
 * would surface as unread again.
 */
export async function markThreadRead(contactId: string): Promise<void> {
  const reads = await loadReads();
  reads[contactId] = new Date().toISOString();
  await setJSON(CHAT_READS_KEY, reads);
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

// Collision-proof even within the same millisecond (broadcast loops).
function newId(suffix = ""): string {
  return `chat_${Date.now()}_${Math.floor(Math.random() * 1e6)}${suffix}`;
}

/** Append the user's message to one thread; returns the stored message. */
export async function appendMessage(contactId: string, text: string): Promise<ChatMessage> {
  const all = await loadAllChats();
  const msg: ChatMessage = { id: newId(), mine: true, text: text.trim(), sentAtISO: new Date().toISOString() };
  all[contactId] = [...(all[contactId] ?? []), msg];
  await setJSON(CHATS_KEY, all);
  return msg;
}

/**
 * Broadcast one message to several contacts' individual threads (a separate
 * entry per thread). Mirrors the "send a program to multiple people" flow in
 * PTHome — it's not a group chat, each conversation stays 1:1.
 */
export async function broadcastMessage(contactIds: string[], text: string): Promise<void> {
  const all = await loadAllChats();
  const now = new Date().toISOString();
  const body = text.trim();
  contactIds.forEach((cid, i) => {
    const msg: ChatMessage = { id: newId(`_${i}`), mine: true, text: body, sentAtISO: now };
    all[cid] = [...(all[cid] ?? []), msg];
  });
  await setJSON(CHATS_KEY, all);
}

// ─── threads map (with legacy demo-seed cleanup) ─────────────────────────────

/**
 * Returns the full chat-threads map, stripping any legacy demo-seed messages.
 *
 * Earlier builds injected a couple of synthetic "inbound" messages for any
 * contact that had no thread yet, to make conversations look alive. Those
 * carried a seed-time (Date.now()-relative) timestamp, so they always rendered
 * as "Today" and — worse — were regenerated whenever a contact appeared under a
 * new id (e.g. a real connection merged into the messages list), fabricating
 * fresh "Today" messages from real people. We no longer seed: a thread only ever
 * holds messages that were actually sent (which carry an accurate sentAtISO).
 * Any leftover `seed_*` messages from older builds are pruned here on load, so
 * the bogus "Today" trial messages clean themselves up.
 *
 * `_contacts` is unused now but kept so callers can keep passing the list they
 * are about to render.
 */
export async function ensureSeededContacts(_contacts: ChatContact[]): Promise<ChatThreads> {
  const all = await loadAllChats();
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
