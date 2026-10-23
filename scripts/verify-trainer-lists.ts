// The Trainer tab's lists and the Programs page's (utils/trainerLists.ts):
//
//   * the roster: starred clients first, oldest star first, then whoever was
//     active most recently, people with no activity known last;
//   * a review's stage, and every review sent to a trainer (1:1 and group) as
//     one newest-first list;
//   * what a trainer has sent, one entry per send, a coach's program to them
//     left out;
//   * the Programs card's numbers: reviews still waiting, programs sent.
//
// And a gym user's Trainer tab:
//
//   * the Programs page: my programs back reviewed first, then programs to
//     accept, then the ones I've taken; one I've removed on neither page;
//   * the Sent for Review page: still waiting, then the ones I took;
//   * the two tiles' numbers, who the Programs tile says they're from, and the
//     count on the My Trainers pill.
//
// Run:  npx tsx scripts/verify-trainer-lists.ts

import type { Client, SentProgram, SharedProgram } from "../utils/trainerStore";
import {
  batchKeyOf,
  firstName,
  fromLine,
  fromTrainerLists,
  gymTileCounts,
  isReturnedDismissed,
  myTrainersBadge,
  programsSummary,
  receivedReviews,
  returnedKeyOf,
  reviewStage,
  rosterOrder,
  sendBatches,
  sentForReviewList,
  sentKeyOf,
  sortByFavourite,
} from "../utils/trainerLists";
import { groupBatches, groupProgramLists, groupProgramsTile } from "../utils/groupPrograms";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── The roster ──────────────────────────────────────────────────────────────
const client = (id: string, lastActiveISO?: string): Client =>
  ({ id, name: id, initials: id.toUpperCase(), ...(lastActiveISO ? { lastActiveISO } : {}) });
const roster = [
  client("a", "2026-10-20T10:00:00.000Z"),
  client("b"),
  client("c", "2026-10-21T09:00:00.000Z"),
  client("d", "2026-10-19T08:00:00.000Z"),
  client("e"),
];
eq(rosterOrder(roster, []).map(c => c.id), ["c", "a", "d", "b", "e"],
  "roster: most recently active first, no activity known last, in the roster's order");
eq(rosterOrder(roster, ["d", "b"]).map(c => c.id), ["d", "b", "c", "a", "e"],
  "roster: starred first in the order they were starred, then by activity");
eq(rosterOrder([client("x", "not a date"), client("y", "2026-10-01T00:00:00.000Z")], []).map(c => c.id), ["y", "x"],
  "roster: an unreadable date counts as no activity known");
eq(rosterOrder([client("p", "2026-10-02T00:00:00.000Z"), client("q", "2026-10-02T00:00:00.000Z")], []).map(c => c.id), ["p", "q"],
  "roster: a tie keeps the roster's order");
eq(roster.map(c => c.id), ["a", "b", "c", "d", "e"], "roster: the list it was given is left alone");
eq(sortByFavourite([{ id: "1" }, { id: "2" }, { id: "3" }], new Set(["3", "1"])).map(x => x.id), ["3", "1", "2"],
  "favourites: starred in star order, the rest as they came");

// ─── Reviews sent to me ──────────────────────────────────────────────────────
const review = (id: string, sentAtISO: string, extra: Partial<SentProgram> = {}): SentProgram =>
  ({ id, programId: `p_${id}`, programName: id, sentAtISO, status: "sent", ...extra });
eq(reviewStage(review("r1", "2026-10-01T00:00:00.000Z")), "awaiting", "stage: not sent back yet is waiting on me");
eq(reviewStage(review("r2", "2026-10-01T00:00:00.000Z", { status: "returned" })), "returned", "stage: sent back");
eq(reviewStage(review("r3", "2026-10-01T00:00:00.000Z", { status: "returned", appliedAtISO: "2026-10-03T00:00:00.000Z" })), "accepted",
  "stage: sent back and taken up");

const oldest = review("old", "2026-10-01T00:00:00.000Z");
const middle = review("mid", "2026-10-05T00:00:00.000Z", { status: "returned" });
const newest = review("new", "2026-10-09T00:00:00.000Z", { groupId: "g1" });
eq(receivedReviews([oldest, middle], [newest]).map(r => r.id), ["new", "mid", "old"],
  "reviews: 1:1 and group reviews as one list, newest first");
eq(sentKeyOf(oldest), "p_old|2026-10-01T00:00:00.000Z", "reviews: a review I sent is keyed by program and when");

// ─── What I've sent ──────────────────────────────────────────────────────────
const share = (id: string, programId: string, sentAtISO: string, extra: Partial<SharedProgram> = {}): SharedProgram =>
  ({ id, clientId: `client_${id}`, programId, programName: programId, sentAtISO, ...extra });
const T1 = "2026-10-02T00:00:00.000Z";
const T2 = "2026-10-06T00:00:00.000Z";
const shares = [
  share("s1", "pA", T1),
  share("s2", "pA", T1, { acceptedAtISO: "2026-10-03T00:00:00.000Z" }),
  share("s3", "pB", T2, { acceptedAtISO: "2026-10-07T00:00:00.000Z" }),
  share("s4", "pC", "2026-10-08T00:00:00.000Z", { receivedFromCoachId: "coach_1" }),
];
const batches = sendBatches(shares);
eq(batches.map(b => b.programId), ["pB", "pA"], "sends: one per send, newest first, a coach's program to me left out");
eq([batches[1].total, batches[1].acceptedCount, batches[1].allAccepted], [2, 1, false], "sends: sent to two, one has accepted");
eq(batches[0].allAccepted, true, "sends: everyone it went to has accepted");
eq(batches[1].key, batchKeyOf(shares[0]), "sends: keyed as the stores key a send (batchKeyOf)");
eq(batches[1].entries.map(e => e.id), ["s1", "s2"], "sends: everyone it went to, in the order they came");
eq(shares.map(s => s.id), ["s1", "s2", "s3", "s4"], "sends: the list it was given is left alone");

// ─── The Programs card ───────────────────────────────────────────────────────
const groupWaiting = review("g", "2026-10-04T00:00:00.000Z", { groupId: "g1" });
eq(programsSummary([oldest, middle], [groupWaiting], shares), { toReview: 2, sent: 2 },
  "card: the reviews still waiting (1:1 and group, never one sent back), and the sends");
eq(programsSummary([], [], []), { toReview: 0, sent: 0 }, "card: nothing yet");

// ─── A gym user's Programs and Sent for Review pages ─────────────────────────
const D = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const backOld = review("b1", D(1), { status: "returned", returnedAtISO: D(5) });
const backNew = review("b2", D(2), { status: "returned", returnedAtISO: D(8) });
const backTaken = review("b3", D(3), { status: "returned", returnedAtISO: D(4), appliedAtISO: D(6) });
const backRemoved = review("b4", D(3), { status: "returned", returnedAtISO: D(7) });
const takenRemoved = review("b5", D(2), { status: "returned", returnedAtISO: D(3), appliedAtISO: D(4) });
const askedOld = review("w1", D(1));
const askedNew = review("w2", D(9));
const mySent = [backOld, askedOld, backTaken, backNew, backRemoved, takenRemoved, askedNew];
const removed = new Set([returnedKeyOf(backRemoved), returnedKeyOf(takenRemoved)]);

const gotNew = share("g1", "pX", D(7));
const gotOld = share("g2", "pY", D(2));
const gotTaken = share("g3", "pZ", D(5), { acceptedAtISO: D(6) });
const gotDeletedCopy = share("g4", "pW", D(4), { deletedByRecipientAtISO: D(5) });
const myReceived = [gotOld, gotTaken, gotNew, gotDeletedCopy];

eq(returnedKeyOf(backOld), `p_b1|${D(1)}|${D(5)}`, "removed review: keyed by the program, when it was sent and when it came back");
eq(isReturnedDismissed(backOld, new Set([sentKeyOf(backOld)])), true, "removed review: a removal recorded the old way still hides it");
eq(isReturnedDismissed({ ...backRemoved, returnedAtISO: D(9) }, removed), false, "removed review: an update sent back after it shows again");

const from = fromTrainerLists(myReceived, mySent, removed);
eq(from.waiting.map(i => (i.kind === "review" ? i.review.id : i.share.id)), ["b2", "b1", "g1", "g4", "g2"],
  "from: my programs back first (latest back first), then programs to accept, newest first; removed ones and taken reviews left out");
eq(from.added.map(s => s.id), ["g3"], "from: the programs I've accepted");
eq(sentForReviewList(mySent, removed).map(s => s.id), ["w2", "w1", "b3"],
  "sent: still waiting, newest first, then the ones I took the changes from; removed ones left out");
eq(gymTileCounts(myReceived, mySent, removed), { newPrograms: 4, fromTotal: 6, awaiting: 2, sentTotal: 3 },
  "tiles: new leaves out a copy I deleted (nothing new came), totals are what each page lists");
eq(gymTileCounts([], [], new Set()), { newPrograms: 0, fromTotal: 0, awaiting: 0, sentTotal: 0 }, "tiles: nothing yet");
eq(myReceived.map(s => s.id), ["g2", "g3", "g1", "g4"], "from: the lists it was given are left alone");

// ─── Names and the My Trainers pill ──────────────────────────────────────────
eq([firstName("Jordan Lee"), firstName("  Sam  "), firstName("Casey")], ["Jordan", "Sam", "Casey"], "names: the first word");
eq(fromLine(1, { name: "Mikeybeastv" }), "From Mikeybeastv", "programs tile: from the only trainer");
eq(fromLine(1, { name: "Jordan Lee" }), "From Jordan", "programs tile: by their first name");
eq(fromLine(3, { name: "Jordan Lee" }), "From your trainers", "programs tile: several trainers, so any of them");
eq(fromLine(0, null), "From your trainer", "programs tile: no trainer now (programs from one since disconnected)");
eq(myTrainersBadge({ jordan: 2, casey: 1, stranger: 4 }, ["jordan", "casey"], "jordan", 3), 4,
  "pill: other trainers' messages and requests waiting; the tab's own trainer, and anyone not on the page, left out");
eq(myTrainersBadge({ jordan: 2, casey: 1, sam: 5 }, ["jordan", "casey", "sam"], "jordan", 0), 6,
  "pill: someone connected who isn't a trainer counts too (they're on My Trainers)");
eq(myTrainersBadge({ casey: 1 }, ["casey", "casey"], null, 0), 1, "pill: a trainer listed twice counts once");
eq(myTrainersBadge({}, [], null, 0), 0, "pill: nothing waiting");

// ─── A group's programs (its Programs page and the tile on its page) ─────────
{
  const g = (id: string, clientId: string, programId: string, sentAtISO: string, extra: Partial<SharedProgram> = {}): SharedProgram =>
    ({ id, clientId, programId, programName: programId, sentAtISO, groupId: "g", senderId: "coach", ...extra });
  const shares = [
    // Summer: to me and to Priya; Priya has taken it.
    g("s1", "me", "summer", "2026-10-10T00:00:00.000Z"),
    g("s2", "priya", "summer", "2026-10-10T00:00:00.000Z", { acceptedAtISO: "2026-10-11T00:00:00.000Z" }),
    // Mobility: to me, taken.
    g("m1", "me", "mobility", "2026-09-20T00:00:00.000Z", { acceptedAtISO: "2026-09-21T00:00:00.000Z" }),
    // One I sent myself, as a trainer here once, to Priya.
    g("o1", "priya", "old", "2026-08-01T00:00:00.000Z", { senderId: "me" }),
  ];
  const reviews = [
    review("theirs", "2026-10-12T00:00:00.000Z", { groupId: "g", senderId: "priya" }),
    review("theirsBack", "2026-10-02T00:00:00.000Z", { groupId: "g", senderId: "sam", status: "returned" }),
    review("mineWaiting", "2026-10-13T00:00:00.000Z", { groupId: "g", senderId: "me" }),
    review("mineBack", "2026-10-08T00:00:00.000Z", { groupId: "g", senderId: "me", status: "returned" }),
    review("mineTaken", "2026-09-01T00:00:00.000Z", { groupId: "g", senderId: "me", status: "returned", appliedAtISO: "2026-09-03T00:00:00.000Z" }),
  ];

  const coach = groupProgramLists({ groupShares: shares, groupReviews: reviews, iCoachGroup: true, myUid: "me" });
  eq(coach.toReview.map(r => r.id), ["theirs"], "group, coach: To Review is other people's requests still waiting");
  eq(coach.toAccept.map(x => (x.kind === "batch" ? x.batch.programName : x.review.id)), ["mineBack", "summer"],
    "group, coach: To Accept is my request back first, then a send to me not yet taken");
  eq(coach.reviewed.map(r => r.id), ["theirsBack"], "group, coach: Reviewed is other people's, sent back");
  eq(coach.sent.map(b => b.programName), ["mobility", "old"], "group, coach: Group Programs is the rest of the group's sends, newest first");
  eq(coach.added, [], "group, coach: nothing under Added");
  eq(coach.sentForReview.map(r => r.id), ["mineWaiting", "mineTaken"], "group, coach: my own requests, waiting or taken, never my To Review");
  eq(groupProgramsTile(coach, true), { line: "1 to review", tone: "waiting" }, "group tile, coach: reviews waiting come first, in orange");

  const member = groupProgramLists({ groupShares: shares.filter(s => s.clientId === "me" || s.senderId === "me"), groupReviews: reviews.filter(r => r.senderId === "me"), iCoachGroup: false, myUid: "me" });
  eq(member.toReview, [], "group, member: never anything to review");
  eq(member.toAccept.map(x => (x.kind === "batch" ? x.batch.programName : x.review.id)), ["mineBack", "summer"],
    "group, member: To Accept as a gym user's Programs page orders it");
  eq(member.added.map(b => b.programName), ["mobility"], "group, member: Added; my own old send to the group stays out of my view");
  eq(member.sent, [], "group, member: no Group Programs section");
  eq(groupProgramsTile(member, false), { line: "2 new programs", tone: "new" }, "group tile, member: what's waiting on me, in periwinkle");

  const quiet = groupProgramLists({ groupShares: [], groupReviews: [review("w", "2026-10-13T00:00:00.000Z", { groupId: "g", senderId: "me" })], iCoachGroup: false, myUid: "me" });
  eq(groupProgramsTile(quiet, false), { line: "1 awaiting review", tone: "quiet" }, "group tile, member: a request still out");
  const none = groupProgramLists({ groupShares: [], groupReviews: [], iCoachGroup: true, myUid: "me" });
  eq(groupProgramsTile(none, true), { line: "Send one to the group", tone: "quiet" }, "group tile, coach: nothing yet");
  const sentOnly = groupProgramLists({ groupShares: [g("x", "priya", "x", "2026-10-01T00:00:00.000Z", { senderId: "me" })], groupReviews: [], iCoachGroup: true, myUid: "me" });
  eq(groupProgramsTile(sentOnly, true), { line: "1 sent", tone: "quiet" }, "group tile, coach: what's been sent, quietly");
  eq(groupBatches(shares, true, "me").map(b => [b.programName, b.entries.length, b.acceptedCount]),
    [["summer", 2, 1], ["mobility", 1, 1], ["old", 1, 0]], "group sends: one per send, with how many have taken it");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
