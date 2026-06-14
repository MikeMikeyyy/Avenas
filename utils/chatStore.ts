// utils/chatStore.ts
//
// Mock chat data layer (local AsyncStorage only — see constants/chat.ts). Built
// on utils/storage.ts and the trainerStore people-loaders. All threads live in
// one CHATS_KEY blob (contactId → messages); few contacts/messages, so a single
// read/write is the simplest robust store and swaps cleanly to a backend later.

import { getJSON, setJSON } from "./storage";
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

// ─── seeding (demo realism) ──────────────────────────────────────────────────

const SEED_LINES = [
  "Hey! How's your training going? 💪",
  "Let me know if you want me to tweak anything in your program.",
];

/**
 * Give any contact that has no thread yet a couple of inbound demo messages so
 * conversations look alive (there's no backend to deliver real ones). Idempotent
 * and per-contact: only seeds threads that don't exist, so contacts added later
 * still get seeded, and real/sent messages are never clobbered. Returns the
 * (possibly updated) full threads map so callers can render previews in one read.
 */
export async function ensureSeededContacts(contacts: ChatContact[]): Promise<ChatThreads> {
  const all = await loadAllChats();
  let changed = false;
  const base = Date.now() - 3 * 60 * 60 * 1000; // a few hours ago
  contacts.forEach((c, ci) => {
    if (all[c.id]) return; // already has a thread (seeded, sent, or received)
    all[c.id] = SEED_LINES.map((line, li) => ({
      id: `seed_${c.id}_${li}`,
      mine: false,
      text: line,
      sentAtISO: new Date(base + (ci * 2 + li) * 60000).toISOString(),
    }));
    changed = true;
  });
  if (changed) await setJSON(CHATS_KEY, all);
  return all;
}
