// utils/groupAlerts.ts
//
// The number on a group's badge: everything in that group waiting on ME.
//
// Three things can be waiting, and they're deliberately ONE number rather than
// three badges. A group row is a door, and the badge answers "is there anything
// behind it" — which of the three it is becomes obvious the moment you open it,
// and three competing pills on a summary row is a dashboard, not a door.
//
//   unread chat       messages since my last read stamp
//   a program for me  shared into the group and not yet accepted
//   a review to do    posted to the group, open, and I coach there
//
// A program I SENT is not waiting on me, and neither is a review I posted, so
// neither counts: the badge would then never clear for the person who did the
// sending.
//
// Pure: no RN imports, so `scripts/verify-group-alerts.ts` can run it.

import type { SharedProgram, SentProgram } from "./trainerStore";

export type GroupAlertInput = {
  /** groupId → unread message count, from `loadGroupRows`. */
  unreadByGroup: Record<string, number>;
  /** Every share row I can see, both directions. */
  shares: SharedProgram[];
  /** Open group reviews I may act on (already excludes ones I sent). */
  reviews: SentProgram[];
  /** My account id. Null when signed out, which zeroes the program halves. */
  myUid: string | null;
};

/**
 * A program is waiting on me when it was shared INTO this group, addressed to
 * me, and I haven't accepted it. `deletedByRecipientAtISO` means I accepted it
 * once and later deleted my copy, which is an answer, not a pending decision.
 */
function isPendingForMe(s: SharedProgram, groupId: string, myUid: string): boolean {
  return s.groupId === groupId
    && s.clientId === myUid
    && !s.acceptedAtISO
    && !s.deletedByRecipientAtISO;
}

/** groupId → how many things in it are waiting on me. Groups with nothing
 *  waiting are absent rather than zero, so callers can pass `?? 0`. */
export function groupAlertCounts({ unreadByGroup, shares, reviews, myUid }: GroupAlertInput): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (groupId: string | undefined, n: number) => {
    if (!groupId || n <= 0) return;
    out[groupId] = (out[groupId] ?? 0) + n;
  };

  for (const [groupId, n] of Object.entries(unreadByGroup)) add(groupId, n);
  if (myUid) {
    for (const s of shares) {
      if (s.groupId && isPendingForMe(s, s.groupId, myUid)) add(s.groupId, 1);
    }
  }
  for (const r of reviews) add(r.groupId, 1);

  return out;
}
