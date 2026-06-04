// utils/moderation.ts
//
// Client-side moderation for the Trainer hub's user-generated content, built to
// satisfy Apple Guideline 1.2 (Safety — UGC): block abusive users, report
// objectionable content/people, and filter reported messages out of every
// thread. There is no backend yet, so reports are logged on-device and the user
// is pointed to Support for human follow-up; blocking and hiding take effect
// immediately and persist locally.

import { getJSON, setJSON } from "./storage";
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
import type { AccountType } from "../contexts/AccountTypeContext";

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

// ─── blocking ─────────────────────────────────────────────────────────────────

export async function loadBlocked(): Promise<BlockedUser[]> {
  return getJSON<BlockedUser[]>(BLOCKED_USERS_KEY, []);
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
 *   - trainer (pt):  drop them from clients and/or coaches
 *   - gym user:      clear them as primary trainer and/or remove from other trainers
 * Idempotent — safe to call for an id that isn't actually connected.
 */
export async function unaddContact(contactId: string, accountType: AccountType): Promise<void> {
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
