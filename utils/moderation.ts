// utils/moderation.ts
//
// Client-side moderation for the Trainer hub's user-generated content, built to
// satisfy Apple Guideline 1.2 (Safety — UGC): block abusive users, report
// objectionable content/people, and filter reported messages out of every
// thread. Blocking and hiding take effect immediately and persist locally;
// blocks are also recorded server-side (migration 0040, see `blockUser`).
//
// Reports are REAL server-side (migration 0014): every report against a real
// account is delivered to the reports table for operator review. The on-device
// log is kept as the offline fallback (entries that couldn't reach the server
// are marked pendingSync and retried on the next report) and as the only store
// for mock/local contacts, which have no real account to moderate.

import { getJSON, setJSON, removeKey } from "./storage";
import { insertReportRow } from "../lib/reports";
import { isCloudContactId } from "../lib/chat";
import { deleteBlock, fetchMyBlocks, insertBlock, type ServerBlock } from "../lib/blocks";
import {
  loadClients, saveClients,
  loadCoaches, removeCoach,
  loadAssignedPT, saveAssignedPT,
  removeOtherTrainer,
  makeInitials,
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

// Blocks live in two places (migration 0040): this phone's list, which is what
// hides people here, and the server's, which severs, takes them out of the
// blocker's own groups, silences their notifications and carries the block to
// the blocker's other devices. Block, unblock and sync each read the list, talk
// to the server and write it back, so they run one at a time: a sync that
// fetched just before a block landed would otherwise read it as "lifted on
// another device" and drop it.
let blockChain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = blockChain.then(fn, fn);
  blockChain = run.catch(() => {});
  return run;
}

async function markOnServer(ids: Set<string>): Promise<void> {
  if (ids.size === 0) return;
  const list = await loadBlocked();
  await setJSON(BLOCKED_USERS_KEY, list.map(b => (ids.has(b.id) && !b.onServer ? { ...b, onServer: true } : b)));
}

/** Block on this phone at once, then tell the server. Returns whether the
 *  server has it; when it doesn't (offline), the block still holds here and
 *  `syncBlocks` sends it later. A local contact has no account, so there's
 *  nothing to send and that counts as done. */
export function blockUser(user: { id: string; name: string; initials: string }): Promise<boolean> {
  return oneAtATime(async () => {
    const list = await loadBlocked();
    if (!list.some(b => b.id === user.id)) {
      await setJSON(BLOCKED_USERS_KEY, [
        { id: user.id, name: user.name, initials: user.initials, blockedAtISO: new Date().toISOString() },
        ...list,
      ]);
    }
    if (!isCloudContactId(user.id)) return true;
    try {
      await insertBlock(user.id, user.name);
    } catch (e) {
      if (__DEV__) console.warn("[avenas] record block", e);
      return false;
    }
    await markOnServer(new Set([user.id]));
    return true;
  });
}

/** Lift a block. The server goes first and a failure throws, with the block
 *  still in place: lifted here but not there, the next sync would read the
 *  server's row as a block from another device and put it straight back. */
export function unblockUser(id: string): Promise<void> {
  return oneAtATime(async () => {
    if (isCloudContactId(id)) await deleteBlock(id);
    const list = await loadBlocked();
    await setJSON(BLOCKED_USERS_KEY, list.filter(b => b.id !== id));
  });
}

/**
 * Bring this phone's blocks and the server's into line. Run after startup and
 * on coming back online (hooks/useTrainerHubPrefetch.ts):
 *   - a block the server hasn't heard of (made offline, or before 0040) is sent,
 *     which is also when it severs and leaves the blocker's groups;
 *   - a block the server has and this phone doesn't (made on another device)
 *     is added;
 *   - a block this phone knows the server HAD, and the server no longer has,
 *     was lifted on another device, and goes.
 * Nothing changes when the server can't be asked, and local contacts (no
 * account) are never touched.
 */
export function syncBlocks(): Promise<void> {
  return oneAtATime(async () => {
    let server: ServerBlock[];
    try {
      server = await fetchMyBlocks();
    } catch (e) {
      if (__DEV__) console.warn("[avenas] sync blocks", e);
      return;
    }
    const onServer = new Map(server.map(b => [b.id, b]));
    const local = await loadBlocked();

    const sent = new Set<string>();
    for (const b of local) {
      if (!isCloudContactId(b.id) || b.onServer || onServer.has(b.id)) continue;
      try {
        await insertBlock(b.id, b.name);
        sent.add(b.id);
      } catch (e) {
        // Waits for the next sync. Not a break: one the server refuses (their
        // account is gone) mustn't hold up the rest.
        if (__DEV__) console.warn("[avenas] send block", b.id, e);
      }
    }

    const liftedElsewhere = (b: BlockedUser) => b.onServer && isCloudContactId(b.id) && !onServer.has(b.id);
    const known = new Set(local.map(b => b.id));
    const next: BlockedUser[] = [
      ...local
        .filter(b => !liftedElsewhere(b))
        .map(b => (!b.onServer && (onServer.has(b.id) || sent.has(b.id)) ? { ...b, onServer: true } : b)),
      ...server
        .filter(s => !known.has(s.id))
        .map(s => {
          const name = s.name || "User";
          return { id: s.id, name, initials: makeInitials(name), blockedAtISO: s.blockedAtISO, onServer: true };
        }),
    ];
    await setJSON(BLOCKED_USERS_KEY, next);
  });
}

/**
 * Block a person everywhere, in one call. This is the entry point every "Block"
 * button should use (chat, Connect, etc.) so blocking is consistent no matter
 * where it's triggered:
 *   1. record the block locally (so they can't be silently re-added), and on
 *      the server (0040), which also takes them out of every group I OWN and
 *      stops their notifications reaching me,
 *   2. drop any local trainer-hub link (clients / coaches / assigned trainer),
 *   3. sever the live account-to-account connection server-side.
 *
 * Returns `{ severed, recorded }` so callers can tell the user when the
 * server-side steps couldn't run (offline / signed out). The local block always
 * succeeds; the surrounding UI (rosters, lists, the chat-thread guard) filters
 * the blocked contact out on the next focus regardless. `recorded: false` means
 * the server hasn't got the block yet: `syncBlocks` sends it when the phone is
 * back online, and the sever and the group removal happen then.
 */
export async function blockContact(
  contact: { id: string; name: string; initials: string },
  accountType: AccountType,
): Promise<{ severed: boolean; recorded: boolean }> {
  const recorded = await blockUser(contact);
  // unaddContact does both the local roster cleanup and the server-side
  // disconnect; the local block above keeps them filtered out of every list
  // even when the sever couldn't run (offline), unlike a plain un-add. A
  // recorded block has severed already (0040's trigger), so that counts.
  const { severed } = await unaddContact(contact.id, accountType);
  return { severed: severed || recorded, recorded };
}

// ─── reporting ─────────────────────────────────────────────────────────────────

export async function loadReports(): Promise<Report[]> {
  return getJSON<Report[]>(REPORTS_KEY, []);
}

/** Report a person: logged on-device, and delivered to the server when they're
 *  a real account. */
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

/**
 * Report someone's display name and/or profile photo.
 *
 * Distinct from reportUser because the evidence is perishable: `name` and
 * `avatar_url` are live profile fields the reported account can change the
 * instant they're reported, so what the reporter saw is snapshotted into the
 * report itself (migration 0018). Without that, an operator reviewing an
 * "inappropriate photo" report a day later just sees whatever is there now.
 */
export async function reportProfile(
  contact: { id: string; name: string; photoUri?: string },
  reason: ReportReason,
): Promise<void> {
  await appendReport({
    id: newId("report"),
    kind: "profile",
    contactId: contact.id,
    contactName: contact.name,
    reason,
    reportedName: contact.name,
    reportedAvatarUrl: contact.photoUri,
    createdAtISO: new Date().toISOString(),
  });
}

/**
 * The entry point every "report this person" button should use. Files a
 * 'profile' report (with the perishable name/photo snapshot) when that's what
 * the reporter picked, and a plain 'user' report otherwise — so an operator can
 * tell from `kind` alone whether to review the profile or the conversation.
 */
export async function reportPerson(
  contact: { id: string; name: string; photoUri?: string },
  reason: ReportReason,
): Promise<void> {
  if (reason === "Inappropriate name or photo") return reportProfile(contact, reason);
  return reportUser(contact, reason);
}

/** Report a single message (and hide it everywhere). Delivered server-side for
 *  real accounts, like reportUser. */
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
  // Real account → deliver to the operator (migration 0014); a failed delivery
  // (offline) marks the local entry for retry. Mock contacts stay local-only.
  let pendingSync = false;
  if (isCloudContactId(report.contactId)) {
    try {
      await insertReportRow(report);
    } catch (e) {
      if (__DEV__) console.warn("[avenas] report sync", e);
      pendingSync = true;
    }
  }
  const list = await loadReports();
  await setJSON(REPORTS_KEY, [{ ...report, ...(pendingSync ? { pendingSync } : {}) }, ...list]);
  // Piggyback: whenever a report goes through, retry any queued ones.
  if (!pendingSync) void flushPendingReports();
}

/** Retry delivery of reports filed while offline. Safe to call any time. */
export async function flushPendingReports(): Promise<void> {
  const list = await loadReports();
  const pending = list.filter(r => r.pendingSync);
  if (pending.length === 0) return;
  const delivered = new Set<string>();
  for (const r of pending) {
    try {
      await insertReportRow(r);
      delivered.add(r.id);
    } catch {
      break; // still offline — keep the rest queued
    }
  }
  if (delivered.size > 0) {
    await setJSON(
      REPORTS_KEY,
      (await loadReports()).map(r => delivered.has(r.id) ? { ...r, pendingSync: undefined } : r),
    );
  }
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
