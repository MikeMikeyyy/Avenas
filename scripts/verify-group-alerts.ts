// scripts/verify-group-alerts.ts
//
// What the badge on a group counts, and what it must never count.
//
// Run: npx tsx scripts/verify-group-alerts.ts

import { groupAlertCounts } from "../utils/groupAlerts";
import type { SharedProgram, SentProgram } from "../utils/trainerStore";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${what}\n    expected ${b}\n    actual   ${a}`);
}

const ME = "me";
const THEM = "them";
const G = "group-1";

const share = (over: Partial<SharedProgram>): SharedProgram => ({
  id: `s_${Math.random()}`,
  clientId: ME,
  programId: "p1",
  programName: "Push Pull Legs",
  sentAtISO: "2026-09-01T10:00:00.000Z",
  groupId: G,
  senderId: THEM,
  ...over,
});

const review = (over: Partial<SentProgram> = {}): SentProgram => ({
  id: `r_${Math.random()}`,
  programId: "p2",
  programName: "Upper Lower",
  sentAtISO: "2026-09-02T10:00:00.000Z",
  status: "sent",
  groupId: G,
  senderId: THEM,
  ...over,
});

const count = (input: Partial<Parameters<typeof groupAlertCounts>[0]>) =>
  groupAlertCounts({ unreadByGroup: {}, shares: [], reviews: [], myUid: ME, ...input });

// ─── unread messages ─────────────────────────────────────────────────────────
eq(count({ unreadByGroup: { [G]: 3 } })[G], 3, "unread messages carry straight through");
eq(count({ unreadByGroup: { [G]: 0 } })[G], undefined, "a read thread leaves no entry");
eq(count({})[G], undefined, "nothing waiting → no entry at all (callers use ?? 0)");

// ─── a program sent to me ────────────────────────────────────────────────────
eq(count({ shares: [share({})] })[G], 1, "a group program addressed to me and unaccepted counts");
eq(
  count({ shares: [share({ acceptedAtISO: "2026-09-02T10:00:00.000Z" })] })[G],
  undefined,
  "once accepted it stops counting",
);
eq(
  count({ shares: [share({ deletedByRecipientAtISO: "2026-09-03T10:00:00.000Z" })] })[G],
  undefined,
  "accepted-then-deleted is an answer, not a pending decision",
);
eq(
  count({ shares: [share({ clientId: THEM })] })[G],
  undefined,
  "a copy addressed to someone ELSE in the group is not mine to act on",
);
eq(
  count({ shares: [share({ groupId: undefined })] })[G],
  undefined,
  "a direct send carries no groupId and belongs to no group's badge",
);
eq(
  count({ shares: [share({ clientId: THEM, senderId: ME })] })[G],
  undefined,
  "MY OWN send never badges the group I sent it to",
);
eq(
  count({ shares: [share({}), share({}), share({ clientId: THEM })] })[G],
  2,
  "two of mine and one of theirs counts two",
);

// ─── a review waiting for a coach ────────────────────────────────────────────
eq(count({ reviews: [review()] })[G], 1, "an open group review counts");
eq(count({ reviews: [review(), review()] })[G], 2, "two reviews count two");
eq(
  count({ reviews: [{ ...review(), groupId: undefined }] })[G],
  undefined,
  "a 1:1 review has no group to badge",
);
eq(
  count({ reviews: [review({ status: "returned", returnedAtISO: "2026-09-03T10:00:00.000Z" })] })[G],
  undefined,
  "a review I've sent back is waiting on them, not me",
);
eq(
  count({ reviews: [review({ status: "returned", returnedAtISO: "2026-09-03T10:00:00.000Z", appliedAtISO: "2026-09-04T10:00:00.000Z" })] })[G],
  undefined,
  "...and so is one they've accepted",
);
eq(
  count({ reviews: [review(), review({ status: "returned", returnedAtISO: "2026-09-03T10:00:00.000Z" })] })[G],
  1,
  "one waiting and one sent back counts one",
);

// ─── the three add up, per group ─────────────────────────────────────────────
eq(
  count({ unreadByGroup: { [G]: 2, "group-2": 1 }, shares: [share({})], reviews: [review()] }),
  { [G]: 4, "group-2": 1 },
  "unread + a program + a review, each group counted separately",
);

// ─── signed out ──────────────────────────────────────────────────────────────
eq(
  count({ myUid: null, unreadByGroup: { [G]: 2 }, shares: [share({})] })[G],
  2,
  "with no uid, 'addressed to me' can't be answered, so only unread counts",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ group alert badge counts hold");
