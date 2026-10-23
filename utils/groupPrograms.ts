// utils/groupPrograms.ts
//
// A group's programs, in the sections its Programs page lists them under
// (app/trainer/group/[id]/programs.tsx), and the line its tile on the group's
// own page shows, read off the same sections so the two can't disagree (user
// decisions, 2026-10-22, the Group Page canvas, option B).
//
// From where the reader stands:
//
//   TO REVIEW        a coach's: other people's requests still waiting on one.
//   TO ACCEPT        my own requests a trainer has sent back, then the group's
//                    programs sent to me that I haven't accepted, as a gym
//                    user's Programs page orders them.
//   REVIEWED         a coach's: other people's requests sent back or taken up.
//   GROUP PROGRAMS   a coach's: everything sent to the group, but what's
//                    waiting on them under To Accept.
//   ADDED            a member's: the group's programs they've accepted.
//   SENT FOR REVIEW  my own requests, still waiting or taken up.
//
// Nobody reviews their own request, so a trainer's own ask is in their Sent
// for Review and never their To Review. Pure: no RN imports, so
// scripts/verify-trainer-lists.ts can run it.

import type { SentProgram, SharedProgram } from "./trainerStore";
import { batchKeyOf, reviewStage } from "./trainerLists";

/** One send to the group: one `shared_programs` row per member it went to,
 *  collapsed onto the batch key they share (the Trainer tab's own key). */
export type GroupBatch = {
  key: string;
  programName: string;
  sentAtISO: string;
  entries: SharedProgram[];
  acceptedCount: number;
};

/** Something waiting on me to accept: a group program sent to me, or my own
 *  request back from a trainer. */
export type GroupToAccept =
  | { kind: "batch"; batch: GroupBatch }
  | { kind: "returned"; review: SentProgram };

export type GroupProgramLists = {
  toReview: SentProgram[];
  toAccept: GroupToAccept[];
  reviewed: SentProgram[];
  /** A coach's Group Programs. Empty for a member. */
  sent: GroupBatch[];
  /** A member's accepted programs. Empty for a coach. */
  added: GroupBatch[];
  sentForReview: SentProgram[];
};

/**
 * The group's sends, one per send rather than per member, newest first. A
 * member's are what the group's trainers sent them, so their own sends (from a
 * time they held the trainer role) stay out of their view: those stay in the
 * group for everyone else, and in its coaches' Group Programs.
 */
export function groupBatches(shares: readonly SharedProgram[], iCoachGroup: boolean, myUid: string | null): GroupBatch[] {
  const byKey = new Map<string, SharedProgram[]>();
  for (const s of shares) {
    if (!iCoachGroup && myUid && s.senderId === myUid) continue;
    const k = batchKeyOf(s);
    const list = byKey.get(k);
    if (list) list.push(s); else byKey.set(k, [s]);
  }
  return Array.from(byKey.entries())
    .map(([key, entries]) => ({
      key,
      programName: entries[0].programName,
      sentAtISO: entries[0].sentAtISO,
      entries,
      acceptedCount: entries.filter(e => e.acceptedAtISO).length,
    }))
    .sort((a, b) => (a.sentAtISO < b.sentAtISO ? 1 : -1));
}

/** My own entry in a send: what Accept acts on. A coach who sent it has none. */
export function myEntry(batch: GroupBatch, myUid: string | null): SharedProgram | undefined {
  return batch.entries.find(e => e.clientId === myUid);
}

export function groupProgramLists({ groupShares, groupReviews, iCoachGroup, myUid }: {
  groupShares: readonly SharedProgram[];
  groupReviews: readonly SentProgram[];
  iCoachGroup: boolean;
  myUid: string | null;
}): GroupProgramLists {
  const mine = (r: SentProgram) => !iCoachGroup || r.senderId === myUid;
  const others = iCoachGroup ? groupReviews.filter(r => r.senderId !== myUid) : [];
  const myRequests = groupReviews.filter(mine);
  const backToMe = myRequests.filter(r => reviewStage(r) === "returned");

  const batches = groupBatches(groupShares, iCoachGroup, myUid);
  const waitingOnMe = (b: GroupBatch) => {
    const e = myEntry(b, myUid);
    return !!e && !e.acceptedAtISO;
  };

  return {
    toReview: others.filter(r => reviewStage(r) === "awaiting"),
    toAccept: [
      ...backToMe.map(review => ({ kind: "returned" as const, review })),
      ...batches.filter(waitingOnMe).map(batch => ({ kind: "batch" as const, batch })),
    ],
    reviewed: others.filter(r => reviewStage(r) !== "awaiting"),
    sent: iCoachGroup ? batches.filter(b => !waitingOnMe(b)) : [],
    added: iCoachGroup ? [] : batches.filter(b => !waitingOnMe(b)),
    sentForReview: myRequests.filter(r => reviewStage(r) !== "returned"),
  };
}

/** What the Programs tile on the group's page says, and in which colour:
 *  `tone` "waiting" (orange: reviews waiting on a coach), "new" (periwinkle:
 *  something for me to accept) or "quiet" (grey). */
export function groupProgramsTile(lists: GroupProgramLists, iCoachGroup: boolean): { line: string; tone: "waiting" | "new" | "quiet" } {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (iCoachGroup && lists.toReview.length > 0) return { line: `${lists.toReview.length} to review`, tone: "waiting" };
  if (lists.toAccept.length > 0) return { line: `${plural(lists.toAccept.length, "new program")}`, tone: "new" };
  const awaiting = lists.sentForReview.filter(r => reviewStage(r) === "awaiting").length;
  if (!iCoachGroup && awaiting > 0) return { line: `${awaiting} awaiting review`, tone: "quiet" };
  const total = iCoachGroup ? lists.sent.length : lists.added.length;
  if (total > 0) return { line: iCoachGroup ? `${total} sent` : plural(total, "program"), tone: "quiet" };
  return { line: iCoachGroup ? "Send one to the group" : "None yet", tone: "quiet" };
}
