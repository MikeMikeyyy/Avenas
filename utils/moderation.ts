// utils/moderation.ts
//
// Client-side moderation for the Trainer hub's user-generated content, built to
// satisfy Apple Guideline 1.2 (Safety — UGC): block abusive users, report
// objectionable content/people, and filter reported messages out of every
// thread. There is no backend yet, so reports are logged on-device and the user
// is pointed to Support for human follow-up; blocking and hiding take effect
// immediately and persist locally.

import { getJSON, setJSON, removeKey } from "./storage";
import {
  loadClients, saveClients,
  loadCoaches, removeCoach,
  loadAssignedPT, saveAssignedPT,
  removeOtherTrainer,
} from "./trainerStore";
import {
  BLOCKED_USERS_KEY, REPORTS_KEY, HIDDEN_MESSAGES_KEY,
  type BlockedUser, type Report, type ReportReason,
} from "../constants/chat";
import {
  COMMUNITY_TERMS_KEY, COMMUNITY_TERMS_VERSION, type CommunityTermsAcceptance,
} from "../constants/community";
import { disconnectByOtherId } from "../lib/connections";
import type { AccountType } from "../contexts/AccountTypeContext";

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

// ─── blocking ─────────────────────────────────────────────────────────────────

export async function loadBlocked(): Promise<BlockedUser[]> {
  return getJSON<BlockedUser[]>(BLOCKED_USERS_KEY, []);
}

/** Wipe local block list / reports / hidden messages on account delete / switch.
 *  The community-terms acceptance gate is intentionally left intact (it's a legal
 *  gate, re-prompted only when COMMUNITY_TERMS_VERSION bumps). */
export async function clearModerationData(): Promise<void> {
  await Promise.all([
    removeKey(BLOCKED_USERS_KEY),
    removeKey(REPORTS_KEY),
    removeKey(HIDDEN_MESSAGES_KEY),
  ]);
}

/** Set of blocked ids — handy for filtering the conversation list. */
export async function loadBlockedIds(): Promise<Set<string>> {
  return new Set((await loadBlocked()).map(b => b.id));
}

export async function blockUser(user: { id: string; name: string; initials: string }): Promise<void> {
  const list = await loadBlocked();
  if (list.some(b => b.id === user.id)) return;
  await setJSON(BLOCKED_USERS_KEY, [
    { id: user.id, name: user.name, initials: user.initials, blockedAtISO: new Date().toISOString() },
    ...list,
  ]);
}

export async function unblockUser(id: string): Promise<void> {
  const list = await loadBlocked();
  await setJSON(BLOCKED_USERS_KEY, list.filter(b => b.id !== id));
}

/**
 * Block a person everywhere, in one call. This is the entry point every "Block"
 * button should use (chat, Connect, etc.) so blocking is consistent no matter
 * where it's triggered:
 *   1. record the block locally (so they can't be silently re-added),
 *   2. drop any local trainer-hub link (clients / coaches / assigned trainer),
 *   3. sever the live account-to-account connection server-side.
 *
 * Returns `{ severed }` so callers can tell the user when the server-side step
 * couldn't run (offline / signed out). The local block always succeeds; the
 * surrounding UI (rosters, lists, the chat-thread guard) filters the blocked
 * contact out on the next focus regardless, so a `false` here means "they're
 * blocked locally but the cloud connection row is still up — it'll sever next
 * time the device is online and the list refreshes."
 */
export async function blockContact(
  contact: { id: string; name: string; initials: string },
  accountType: AccountType,
): Promise<{ severed: boolean }> {
  await blockUser(contact);
  // unaddContact does both the local roster cleanup and the server-side
  // disconnect; the local block above keeps them filtered out of every list
  // even when the sever couldn't run (offline), unlike a plain un-add.
  return unaddContact(contact.id, accountType);
}

// ─── reporting ─────────────────────────────────────────────────────────────────

export async function loadReports(): Promise<Report[]> {
  return getJSON<Report[]>(REPORTS_KEY, []);
}

/** Log a report of a person. */
export async function reportUser(
  contact: { id: string; name: string },
  reason: ReportReason,
): Promise<void> {
  await appendReport({
    id: newId("report"),
    kind: "user",
    contactId: contact.id,
    contactName: contact.name,
    reason,
    createdAtISO: new Date().toISOString(),
  });
}

/** Log a report of a single message (and hide it everywhere). */
export async function reportMessage(
  contact: { id: string; name: string },
  message: { id: string; text: string },
  reason: ReportReason,
): Promise<void> {
  await appendReport({
    id: newId("report"),
    kind: "message",
    contactId: contact.id,
    contactName: contact.name,
    reason,
    messageId: message.id,
    messageText: message.text,
    createdAtISO: new Date().toISOString(),
  });
  await hideMessage(message.id);
}

async function appendReport(report: Report): Promise<void> {
  const list = await loadReports();
  await setJSON(REPORTS_KEY, [report, ...list]);
}

// ─── hidden messages (filter reported content) ──────────────────────────────────

export async function loadHiddenMessageIds(): Promise<Set<string>> {
  return new Set(await getJSON<string[]>(HIDDEN_MESSAGES_KEY, []));
}

export async function hideMessage(messageId: string): Promise<void> {
  const ids = await getJSON<string[]>(HIDDEN_MESSAGES_KEY, []);
  if (ids.includes(messageId)) return;
  await setJSON(HIDDEN_MESSAGES_KEY, [...ids, messageId]);
}

// ─── un-add (remove the connection) ──────────────────────────────────────────

/**
 * Remove a person from the current account's connections, wherever they live:
 *   - local roster: trainer (pt) → drop from clients and/or coaches;
 *     gym user → clear as primary trainer and/or remove from other trainers
 *   - server: delete the live account-to-account connections row
 * Idempotent — safe to call for an id that isn't actually connected.
 *
 * The server step is what actually removes a REAL connection: the trainer-hub
 * rosters re-merge accepted connections from getMyConnections() on every focus,
 * so a local-only removal silently reappears. Returns `{ severed }` — `false`
 * means the server couldn't be reached (offline / signed out) and the
 * connection is still up; callers should tell the user to retry, because
 * (unlike blockContact) nothing filters the person out in the meantime.
 */
export async function unaddContact(contactId: string, accountType: AccountType): Promise<{ severed: boolean }> {
  if (accountType === "pt") {
    const clients = await loadClients();
    const nextClients = clients.filter(c => c.id !== contactId);
    if (nextClients.length !== clients.length) await saveClients(nextClients);
    if ((await loadCoaches()).some(c => c.id === contactId)) await removeCoach(contactId);
  } else {
    const primary = await loadAssignedPT();
    if (primary?.id === contactId) await saveAssignedPT(null);
    await removeOtherTrainer(contactId);
  }
  try {
    await disconnectByOtherId(contactId);
    return { severed: true };
  } catch (e) {
    if (__DEV__) console.warn("[avenas] unaddContact disconnect", contactId, e);
    return { severed: false };
  }
}

// ─── community guidelines acceptance ─────────────────────────────────────────

export async function loadCommunityTerms(): Promise<CommunityTermsAcceptance | null> {
  return getJSON<CommunityTermsAcceptance | null>(COMMUNITY_TERMS_KEY, null);
}

/** True only when the user accepted the CURRENT guidelines version. */
export async function hasAcceptedCommunityTerms(): Promise<boolean> {
  const t = await loadCommunityTerms();
  return !!t && t.version === COMMUNITY_TERMS_VERSION;
}

export async function acceptCommunityTerms(): Promise<void> {
  await setJSON<CommunityTermsAcceptance>(COMMUNITY_TERMS_KEY, {
    version: COMMUNITY_TERMS_VERSION,
    acceptedAtISO: new Date().toISOString(),
  });
}
