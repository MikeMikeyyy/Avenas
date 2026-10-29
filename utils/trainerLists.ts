// utils/trainerLists.ts
//
// How a trainer's Trainer tab orders and counts its lists, and how its Programs
// page (app/trainer/programs.tsx) groups what's been sent and received:
//
//   * the roster: starred first, then whoever was active most recently;
//   * what's been sent, one entry per send ("a batch": one program sent at one
//     moment, to one person, several, or a group);
//   * what's been sent to them for review, 1:1 and from groups they coach,
//     newest first, and where each stands;
//   * programs sent to them (TO ACCEPT, ADDED);
//   * the Programs card's three numbers: new programs, reviews waiting,
//     programs sent;
//   * the rows a send writes, for whatever the send sheet picked.
//
// And the same for a gym user's Trainer tab (components/trainer/MyPTHome.tsx):
// what its Programs and Sent for Review pages list, the two tiles' numbers and
// lines, and the count on its My Trainers pill.
//
// Pure (types only from the stores), so scripts/verify-trainer-lists.ts can
// hold it to those rules. sortByFavourite, batchKeyOf, sentKeyOf,
// returnedKeyOf, isReturnedDismissed and reviewStage live here and are
// re-exported where they always were (utils/groupStore.ts,
// utils/trainerStore.ts, ReviewStatusPill).

import type { SavedProgram } from "../constants/programs";
import type { Client, SentProgram, SharedProgram } from "./trainerStore";

/**
 * Starred items first, OLDEST favourite at the top; everything else in the
 * order it arrived.
 *
 * The unstarred half is a stable partition on purpose — `fetchMyGroups` returns
 * newest first and `get_group_members` returns owner, then trainers, then name,
 * and those orders should survive underneath the pinned ones. The starred half
 * is ranked by `favourites`' own iteration order rather than by the incoming
 * list, so a group starred months ago stays above one starred today however new
 * either of them is.
 */
export function sortByFavourite<T extends { id: string }>(items: T[], favourites: Set<string>): T[] {
  const rank = new Map<string, number>();
  let i = 0;
  for (const id of favourites) rank.set(id, i++);
  const starred = items
    .filter(x => rank.has(x.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...starred, ...items.filter(x => !rank.has(x.id))];
}

/**
 * The roster as the Trainer tab lists it: starred clients first (oldest star
 * first, as everywhere), then the rest by when they were last active, most
 * recent first, so the people you're working with lead a long list. Someone
 * with no activity known (a local roster entry, or sharing turned off) goes
 * last, and ties keep the roster's own order.
 *
 * Ordered by the activity the page LOADED with, never by live presence, so a
 * client coming online doesn't make the list jump under your finger.
 */
export function rosterOrder(clients: Client[], favouriteIds: string[]): Client[] {
  const at = (c: Client) => {
    const ms = c.lastActiveISO ? Date.parse(c.lastActiveISO) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  const byActivity = clients
    .map((c, i) => ({ c, i, at: at(c) }))
    .sort((a, b) => (b.at - a.at) || (a.i - b.i))
    .map(x => x.c);
  return sortByFavourite(byActivity, new Set(favouriteIds));
}

/** Stable grouping key — every entry created in a single send call shares the same sentAtISO. */
export function batchKeyOf(s: SharedProgram): string {
  return `${s.programId}|${s.sentAtISO}`;
}

/** A review I sent, by the same programId|sentAtISO form as batchKeyOf. */
export function sentKeyOf(s: SentProgram): string {
  return `${s.programId}|${s.sentAtISO}`;
}

/**
 * The key that removing a review that's come back to me writes into the
 * dismissed list (DISMISSED_SHARES_KEY), the same list as a program a trainer
 * sent me.
 *
 * It carries the send-back time, so it hides THAT version: when the trainer
 * sends an update, returnedAtISO moves and the card comes back with Accept on
 * it. Keyed on sentKeyOf alone, a removed review stayed hidden through every
 * update, so the update never reached anyone who'd tidied their list.
 */
export function returnedKeyOf(s: SentProgram): string {
  return `${sentKeyOf(s)}|${s.returnedAtISO ?? ""}`;
}

/** Whether I've removed this returned review from my lists. A bare sentKeyOf
 *  still counts: that's how a removal was recorded before returnedKeyOf, and
 *  showing all of those again would undo what the user tidied away. */
export function isReturnedDismissed(s: SentProgram, dismissed: Set<string>): boolean {
  return dismissed.has(returnedKeyOf(s)) || dismissed.has(sentKeyOf(s));
}

export type ReviewStage = "awaiting" | "returned" | "accepted" | "removed";

/** Where a review stands: waiting on a trainer, sent back, or taken up. Or,
 *  to the person who asked only, taken off the trainer's list without being
 *  sent back (removedUnreviewedAtISO: "Not reviewed"). */
export function reviewStage(r: SentProgram): ReviewStage {
  if (r.status !== "returned") return r.removedUnreviewedAtISO ? "removed" : "awaiting";
  return r.appliedAtISO ? "accepted" : "returned";
}

/** One send: everyone a program went to at one moment, and who's taken it. */
export type SendBatch = {
  key: string;
  programId: string;
  programName: string;
  sentAtISO: string;
  programSnapshot?: SavedProgram;
  /** The group it went to; undefined for a send to people picked one by one. */
  groupId?: string;
  entries: SharedProgram[];
  acceptedCount: number;
  total: number;
  allAccepted: boolean;
};

/**
 * Everything this trainer has sent, one entry per send, newest first. A
 * program someone sent ME isn't mine to list here: it's in TO ACCEPT or ADDED
 * (trainerReceivedLists).
 */
export function sendBatches(sharedOut: SharedProgram[]): SendBatch[] {
  const byKey = new Map<string, SharedProgram[]>();
  for (const s of sharedOut) {
    if (s.receivedFromCoachId) continue;
    const k = batchKeyOf(s);
    const arr = byKey.get(k);
    if (arr) arr.push(s);
    else byKey.set(k, [s]);
  }
  const batches = Array.from(byKey.entries()).map(([key, entries]) => {
    const head = entries[0];
    const acceptedCount = entries.filter(e => !!e.acceptedAtISO).length;
    return {
      key,
      programId: head.programId,
      programName: head.programName,
      sentAtISO: head.sentAtISO,
      programSnapshot: head.programSnapshot,
      // Every entry in a batch came from the same send, so the head's group is
      // the batch's group.
      groupId: head.groupId,
      entries,
      acceptedCount,
      total: entries.length,
      allAccepted: entries.length > 0 && acceptedCount === entries.length,
    };
  });
  return batches.sort((a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0));
}

/** Everything sent to this trainer for review: 1:1 and from the groups they
 *  coach, as one newest-first list. Which route a review came by is a fact
 *  about the database, not about the job: someone is waiting on them either way. */
export function receivedReviews(reviews: SentProgram[], groupReviews: SentProgram[]): SentProgram[] {
  return [...reviews, ...groupReviews].sort(
    (a, b) => (a.sentAtISO < b.sentAtISO ? 1 : a.sentAtISO > b.sentAtISO ? -1 : 0),
  );
}

/**
 * Programs sent to this trainer, for their Programs page (user decision,
 * 2026-10-29): TO ACCEPT, the ones not taken yet (newest first; one accepted
 * once and deleted from My Programs since is here too, and Accept adds it
 * back), and ADDED, the ones taken. From anyone, 1:1 or through a group, one
 * per send. They used to be only at the foot of My Trainers, with nothing
 * anywhere to say one had come, so a program sent to a trainer seemed never to
 * arrive. The load layer has already left out the ones I've removed.
 */
export function trainerReceivedLists(sharedOut: SharedProgram[]): { waiting: SharedProgram[]; added: SharedProgram[] } {
  const seen = new Set<string>();
  const mine: SharedProgram[] = [];
  for (const s of sharedOut) {
    if (!s.receivedFromCoachId) continue;
    const k = batchKeyOf(s);
    if (seen.has(k)) continue;
    seen.add(k);
    mine.push(s);
  }
  mine.sort((a, b) => newestFirst(a.sentAtISO, b.sentAtISO));
  return { waiting: mine.filter(s => !s.acceptedAtISO), added: mine.filter(s => !!s.acceptedAtISO) };
}

/**
 * A trainer's Programs page, the parts about programs coming TO them, as a gym
 * user's two pages list them (fromTrainerLists, sentForReviewList): TO ACCEPT,
 * their own requests sent back first, then programs sent to them not taken
 * yet; ADDED; and SENT FOR REVIEW, their own requests still waiting, removed
 * without a review, or taken up (user report, 2026-10-29: a trainer's own
 * requests were on a group's page at best, and nothing on their Trainer tab
 * said one had come back).
 */
export function trainerProgramLists(
  sharedOut: SharedProgram[],
  myRequests: SentProgram[],
  dismissed: Set<string>,
): { toAccept: FromTrainerItem[]; added: SharedProgram[]; sentForReview: SentProgram[] } {
  const received = trainerReceivedLists(sharedOut);
  const from = fromTrainerLists([...received.waiting, ...received.added], myRequests, dismissed);
  return { toAccept: from.waiting, added: from.added, sentForReview: sentForReviewList(myRequests, dismissed) };
}

/** The Programs card's numbers: what's new to this trainer (programs sent to
 *  them not taken yet, and their own requests sent back), their requests
 *  removed without a review, reviews still waiting on them, and programs
 *  they've sent (one per send). A program taken once and deleted since isn't
 *  new: nothing new came, as on a gym user's tile. */
export function programsSummary(
  reviews: SentProgram[],
  groupReviews: SentProgram[],
  sharedOut: SharedProgram[],
  myRequests: SentProgram[] = [],
  dismissed: Set<string> = new Set(),
): { newPrograms: number; notReviewed: number; toReview: number; sent: number } {
  const mine = trainerProgramLists(sharedOut, myRequests, dismissed);
  return {
    newPrograms: mine.toAccept.filter(i => i.kind === "review" || !i.share.deletedByRecipientAtISO).length,
    notReviewed: mine.sentForReview.filter(r => reviewStage(r) === "removed").length,
    toReview: receivedReviews(reviews, groupReviews).filter(r => reviewStage(r) === "awaiting").length,
    sent: sendBatches(sharedOut).length,
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/** Who a send goes to, as the send sheet (components/trainer/RecipientPickerSheet.tsx)
 *  answers it: every client, or the groups and the clients picked. */
export type RecipientChoice = { all: boolean; groupIds: string[]; clientIds: string[] };

/**
 * The rows a send writes (appendSharedPrograms), one per person.
 *
 *   * every client: one each, as a send to people picked one by one;
 *   * clients picked one by one: one each, straight to them, so it's on their
 *     own Trainer tab and on no group's page, whatever groups are picked too
 *     (user report, 2026-10-29: someone picked one by one who was also in a
 *     group picked got the group's copy, which put it on the group's page);
 *   * a group: everyone else in it but me (invites still to be answered too),
 *     tagged with the group, as the group's own page sends it, so it shows on
 *     the group's Programs page and reaches a fellow trainer or anyone else in
 *     it who isn't my client (user report, 2026-10-29: a group picked here
 *     ticked only the people in it who were my clients and sent to them one by
 *     one).
 *
 * Everyone gets it once: someone picked one by one gets it straight even when a
 * group picked has them, and someone in two of the groups gets the first's.
 * Each group's rows, and the one-by-one rows, are a send of their own (their
 * own sent time, so their own batch key), so the Programs page lists each
 * where it went, as if sent from there.
 */
export function shareEntriesFor(
  program: SavedProgram,
  choice: RecipientChoice,
  people: { clientIds: string[]; groupMembers: Record<string, string[]>; myUid: string | null },
  nowMs: number,
): SharedProgram[] {
  const entries: SharedProgram[] = [];
  const covered = new Set<string>(people.myUid ? [people.myUid] : []);
  const add = (clientId: string, sentAtMs: number, groupId?: string) => {
    if (covered.has(clientId)) return;
    covered.add(clientId);
    entries.push({
      id: `share_${nowMs}_${entries.length}`,
      clientId,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date(sentAtMs).toISOString(),
      programSnapshot: program,
      ...(groupId ? { groupId } : {}),
    });
  };
  if (choice.all) {
    for (const id of people.clientIds) add(id, nowMs);
    return entries;
  }
  // The ones picked one by one first: theirs is straight to them.
  for (const id of choice.clientIds) add(id, nowMs);
  choice.groupIds.forEach((groupId, i) => {
    for (const id of people.groupMembers[groupId] ?? []) add(id, nowMs + i + 1, groupId);
  });
  return entries;
}

/** Where a send went, for "Program Sent": "Mon Strength and 2 clients". */
export function sentToSummary(groupNames: string[], clientCount: number): string {
  const parts = [...groupNames, ...(clientCount > 0 ? [`${clientCount} client${clientCount === 1 ? "" : "s"}`] : [])];
  if (parts.length <= 1) return parts[0] ?? "no one";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ─── A gym user's Trainer tab ────────────────────────────────────────────────

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** One thing on a gym user's Programs page: a program a trainer sent me, or my
 *  own program, sent back reviewed. */
export type FromTrainerItem =
  | { kind: "program"; share: SharedProgram }
  | { kind: "review"; review: SentProgram };

/**
 * What a gym user's Programs page lists (app/trainer/received.tsx; user
 * decisions, 2026-10-21, the Trainer Page canvas):
 *
 *   * waiting: what a trainer has handed me that I haven't taken up. My own
 *     programs back with changes I haven't added lead, sent back most recently
 *     first, then programs sent to me I haven't accepted, newest first. One I
 *     accepted and later deleted from My Programs is here too: Accept adds it
 *     back.
 *   * added: programs sent to me that I've accepted, newest first.
 *
 * A review whose changes I've added has done its job here and is on Sent for
 * Review instead, as "Accepted". One I've removed is on neither page. The programs
 * arrive already without the ones I've removed (the load layer applies the
 * same dismissed list); my own reviews don't, so they're filtered here.
 */
export function fromTrainerLists(
  received: SharedProgram[],
  sent: SentProgram[],
  dismissed: Set<string>,
): { waiting: FromTrainerItem[]; added: SharedProgram[] } {
  const back = sent
    .filter(s => reviewStage(s) === "returned" && !isReturnedDismissed(s, dismissed))
    .sort((a, b) => newestFirst(a.returnedAtISO ?? a.sentAtISO, b.returnedAtISO ?? b.sentAtISO));
  const programs = [...received].sort((a, b) => newestFirst(a.sentAtISO, b.sentAtISO));
  return {
    waiting: [
      ...back.map(review => ({ kind: "review" as const, review })),
      ...programs.filter(p => !p.acceptedAtISO).map(share => ({ kind: "program" as const, share })),
    ],
    added: programs.filter(p => !!p.acceptedAtISO),
  };
}

/**
 * What the Sent for Review page lists (app/trainer/sent-reviews.tsx): my
 * requests still waiting on a trainer, newest first; then the ones a trainer
 * removed without sending back ("Not reviewed"), most recently removed first;
 * then the ones I've taken the changes from ("Accepted"), most recently taken
 * first. One sent back that I haven't taken up is on the Programs page, since
 * it's waiting on me now rather than on them; one I've removed is on neither.
 */
export function sentForReviewList(sent: SentProgram[], dismissed: Set<string>): SentProgram[] {
  const waiting = sent
    .filter(s => reviewStage(s) === "awaiting")
    .sort((a, b) => newestFirst(a.sentAtISO, b.sentAtISO));
  const notReviewed = sent
    .filter(s => reviewStage(s) === "removed")
    .sort((a, b) => newestFirst(a.removedUnreviewedAtISO ?? "", b.removedUnreviewedAtISO ?? ""));
  const accepted = sent
    .filter(s => reviewStage(s) === "accepted" && !isReturnedDismissed(s, dismissed))
    .sort((a, b) => newestFirst(a.appliedAtISO ?? "", b.appliedAtISO ?? ""));
  return [...waiting, ...notReviewed, ...accepted];
}

/** The numbers on a gym user's two tiles: what's new from their trainers and
 *  everything on that page; and on the Sent for Review page, what's still
 *  waiting on a trainer, what one removed without a review, what's been taken
 *  up, and everything. */
export function gymTileCounts(
  received: SharedProgram[],
  sent: SentProgram[],
  dismissed: Set<string>,
): { newPrograms: number; fromTotal: number; awaiting: number; notReviewed: number; accepted: number; sentTotal: number } {
  const from = fromTrainerLists(received, sent, dismissed);
  const asked = sentForReviewList(sent, dismissed);
  return {
    // Not a program accepted once and deleted since: nothing new came, and it
    // would count as new for as long as it stays on the list.
    newPrograms: from.waiting.filter(i => i.kind === "review" || !i.share.deletedByRecipientAtISO).length,
    fromTotal: from.waiting.length + from.added.length,
    awaiting: asked.filter(s => reviewStage(s) === "awaiting").length,
    notReviewed: asked.filter(s => reviewStage(s) === "removed").length,
    accepted: asked.filter(s => reviewStage(s) === "accepted").length,
    sentTotal: asked.length,
  };
}

/** The first word of someone's name, for "From Jordan · 2d ago". */
export function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}

/**
 * Who the programs on the Programs tile are from, for its line once nothing's
 * new: the trainer when they're the only one (their first name), "your
 * trainers" when there are several, since the page lists what any of them
 * sent. Decided by how many trainers there are rather than by who sent what,
 * so it doesn't change as programs arrive.
 */
export function fromLine(trainerCount: number, featured: { name: string } | null): string {
  if (trainerCount > 1) return "From your trainers";
  return featured ? `From ${firstName(featured.name)}` : "From your trainer";
}

/**
 * The red count on a gym user's My Trainers pill: unread messages from each
 * person on the My Trainers page (their trainers, and anyone else they're
 * connected with) but the trainer on the tab (theirs is on its Message
 * button), and the connection requests waiting behind the page's connect
 * button (user decision, 2026-10-21: no Messages button on a gym user's tab).
 */
export function myTrainersBadge(
  unreadByPerson: Record<string, number>,
  peopleIds: string[],
  featuredId: string | null,
  pendingRequests: number,
): number {
  let n = pendingRequests;
  for (const id of new Set(peopleIds)) if (id !== featuredId) n += unreadByPerson[id] ?? 0;
  return n;
}
