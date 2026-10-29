// Reviews asked for and sent back, by who asks and who reviews, played out on
// simulated phones against every migration (the verify harness,
// scripts/harness/), with what each person's lists show after each step
// (user request, 2026-10-29). scripts/verify-program-flows.ts explores a gym
// user asking a trainer and asking a group every way it can go; these are the
// other paths:
//
//   1. Back and forth: Cara asks Tara twice about the same program; each comes
//      back, she takes both, and has one program with both rounds of changes.
//   2. A trainer asks one of their trainers (My Trainers' Send for review):
//      Cole asks Tara. It's in her TO REVIEW; on Cole's Programs page it's
//      under SENT FOR REVIEW, then in TO ACCEPT and new on his card once it's
//      back; he takes it and it's Accepted.
//   3. The same, removed without a review: Not reviewed on Cole's page and
//      card, until he clears it.
//   4. A trainer asks a group he's a plain member of: on his own Programs page
//      as well as the group's; back, and taken.
//   5. A gym user the group's owner made a trainer reviews a member's request
//      and sends it back; the member takes it.
//
// Run:  npx tsx scripts/verify-trainer-reviews.ts

import { on, warnings } from "./harness/app";
import { CARA, CODY, COLE, GROUP, TARA, closeWorld, db, resetWorld, setupWorld, type Person } from "./harness/world";
import {
  fromTrainerLists,
  programsSummary,
  receivedReviews,
  reviewStage,
  sentForReviewList,
  trainerProgramLists,
} from "../utils/trainerLists";
import { getJSON } from "../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import type { SentProgram } from "../utils/trainerStore";

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

const plan = (id: string, name: string): SavedProgram => ({
  id, name, totalWeeks: 6, currentWeek: 0, status: "paused", startDate: "",
  trainingDays: 2, cycleDays: 3, cyclePattern: ["A", "B", "Rest"], dayIds: ["d0", "d1", "d2"], workouts: {},
});
const CARA_P = plan("p_cara", "Cara Plan");
const COLE_P = plan("p_cole", "Cole Plan");

/** Ask for a review of `program` as it now stands on the asker's phone. */
async function ask(p: Person, program: SavedProgram, sentAt: string, to: string, groupId?: string) {
  await on(p, async () => {
    const current = (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).find(x => x.id === program.id) ?? program;
    await p.app.appendSentProgram({
      id: `sent_${sentAt}`, programId: program.id, programName: current.name, sentAtISO: sentAt,
      status: "sent", programSnapshot: current, ...(groupId ? { groupId } : {}),
    }, to);
  });
}

/** The review as the trainer's own list draws it (a group's through the group). */
async function reviewOf(t: Person, sentAt: string, groupId?: string): Promise<SentProgram> {
  return on(t, async () => {
    const list = groupId ? await t.app.loadGroupReviewPrograms(groupId) : await t.app.loadSentPrograms();
    const r = list.find(s => s.sentAtISO === sentAt);
    if (!r) throw new Error(`${t.name} can't find the review sent ${sentAt}`);
    return r;
  });
}

/** The trainer edits it in the builder (a week added) and sends it back. */
async function reviewAndReturn(t: Person, sentAt: string, groupId?: string) {
  const r = await reviewOf(t, sentAt, groupId);
  await on(t, async () => {
    const snap = r.programSnapshot!;
    await t.app.updateSentProgram(r.id, { programSnapshot: { ...snap, totalWeeks: snap.totalWeeks + 1 }, programName: snap.name, lastEditedAtISO: new Date().toISOString() });
    await t.app.returnReview(r.id);
  });
}

/** What a request reads as: the program, when it was asked, where it stands. */
const stages = (l: SentProgram[]) => l.map(s => `${s.programName}@${s.sentAtISO.slice(11, 16)}:${reviewStage(s)}`);

/** A trainer's TO REVIEW and REVIEWED (Programs page), 1:1 and group. */
async function trainerReviews(t: Person) {
  return on(t, async () => stages(receivedReviews(await t.app.loadSentPrograms(), await t.app.loadMyGroupReviews())));
}

/** A trainer's own requests on their Programs page, and the card's counts. */
async function trainerRequests(t: Person) {
  return on(t, async () => {
    const [shares, mine, dismissed] = await Promise.all([t.app.loadSharedPrograms(), t.app.loadMyReviewRequests(), t.app.loadDismissedShareKeys()]);
    const lists = trainerProgramLists(shares, mine ?? [], dismissed);
    const card = programsSummary([], [], shares, mine ?? [], dismissed);
    return {
      toAccept: lists.toAccept.map(i => (i.kind === "review" ? `${i.review.programName}:back` : `${i.share.programName}:program`)),
      sentForReview: stages(lists.sentForReview),
      card: { newPrograms: card.newPrograms, notReviewed: card.notReviewed },
    };
  });
}

/** A gym user's From page (what's waiting on them) and Sent for Review page. */
async function gymReviews(p: Person) {
  return on(p, async () => {
    const [sent, dismissed] = await Promise.all([p.app.loadSentPrograms(), p.app.loadDismissedShareKeys()]);
    return {
      waiting: fromTrainerLists([], sent, dismissed).waiting.map(i => (i.kind === "review" ? `${i.review.programName}:back` : "program")),
      sentForReview: stages(sentForReviewList(sent, dismissed)),
    };
  });
}

const programsOf = (p: Person) => on(p, async () => (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).map(x => `${x.name} (${x.totalWeeks}w)`));

async function main() {
  await setupWorld();
  const T1 = "2026-10-29T09:00:00.000Z";
  const T2 = "2026-10-29T10:00:00.000Z";

  // ── 1. Back and forth, 1:1 ──
  CARA.programs = [CARA_P]; COLE.programs = []; TARA.programs = [];
  await resetWorld();
  await ask(CARA, CARA_P, T1, TARA.uid);
  await reviewAndReturn(TARA, T1);
  eq(await gymReviews(CARA), { waiting: ["Cara Plan:back"], sentForReview: [] }, "1: back with Tara's changes, on Cara's Programs page");
  await on(CARA, async () => CARA.app.applyReturnedProgram((await reviewOf(CARA, T1)).id));
  await ask(CARA, CARA_P, T2, TARA.uid);
  eq(await trainerReviews(TARA), ["Cara Plan@10:00:awaiting", "Cara Plan@09:00:accepted"], "1: Tara has the second to review, the first taken");
  await reviewAndReturn(TARA, T2);
  await on(CARA, async () => CARA.app.applyReturnedProgram((await reviewOf(CARA, T2)).id));
  eq(await gymReviews(CARA), { waiting: [], sentForReview: ["Cara Plan@10:00:accepted", "Cara Plan@09:00:accepted"] }, "1: both taken");
  eq(await programsOf(CARA), ["Cara Plan (8w)"], "1: one program, with both rounds of changes");

  // ── 2. A trainer asks one of their trainers ──
  CARA.programs = []; COLE.programs = [COLE_P];
  await resetWorld();
  await ask(COLE, COLE_P, T1, TARA.uid);
  eq(await trainerReviews(TARA), ["Cole Plan@09:00:awaiting"], "2: in Tara's TO REVIEW");
  eq(await trainerRequests(COLE), { toAccept: [], sentForReview: ["Cole Plan@09:00:awaiting"], card: { newPrograms: 0, notReviewed: 0 } },
    "2: on Cole's Programs page, under SENT FOR REVIEW");
  eq(await trainerRequests(TARA), { toAccept: [], sentForReview: [], card: { newPrograms: 0, notReviewed: 0 } },
    "2: never among Tara's own requests");
  await reviewAndReturn(TARA, T1);
  eq(await trainerRequests(COLE), { toAccept: ["Cole Plan:back"], sentForReview: [], card: { newPrograms: 1, notReviewed: 0 } },
    "2: back: in Cole's TO ACCEPT, new on his card");
  await on(COLE, async () => {
    const mine = await COLE.app.loadMyReviewRequests();
    await COLE.app.applyReturnedProgram(mine!.find(s => s.sentAtISO === T1)!.id);
  });
  eq(await trainerRequests(COLE), { toAccept: [], sentForReview: ["Cole Plan@09:00:accepted"], card: { newPrograms: 0, notReviewed: 0 } },
    "2: taken: Accepted under SENT FOR REVIEW");
  eq(await programsOf(COLE), ["Cole Plan (7w)"], "2: and Cole's program has Tara's changes");

  // ── 3. The same, removed without a review ──
  await resetWorld();
  await ask(COLE, COLE_P, T1, TARA.uid);
  await on(TARA, async () => TARA.app.dismissReceivedReview((await reviewOf(TARA, T1)).id));
  eq(await trainerRequests(COLE), { toAccept: [], sentForReview: ["Cole Plan@09:00:removed"], card: { newPrograms: 0, notReviewed: 1 } },
    "3: Not reviewed on Cole's page, in red on his card");
  await on(COLE, async () => {
    const mine = await COLE.app.loadMyReviewRequests();
    await COLE.app.removeSentProgram(mine!.find(s => s.sentAtISO === T1)!.id);
  });
  eq(await trainerRequests(COLE), { toAccept: [], sentForReview: [], card: { newPrograms: 0, notReviewed: 0 } }, "3: cleared");

  // ── 4. A trainer asks a group he's a plain member of ──
  await db.query(`update public.group_members set role = 'member' where group_id = $1 and user_id = $2`, [GROUP, COLE.uid]);
  await resetWorld();
  await ask(COLE, COLE_P, T1, TARA.uid, GROUP);
  eq(await trainerRequests(COLE), { toAccept: [], sentForReview: ["Cole Plan@09:00:awaiting"], card: { newPrograms: 0, notReviewed: 0 } },
    "4: on Cole's own Programs page, not only the group's");
  await reviewAndReturn(TARA, T1, GROUP);
  eq(await trainerRequests(COLE), { toAccept: ["Cole Plan:back"], sentForReview: [], card: { newPrograms: 1, notReviewed: 0 } },
    "4: back, in his TO ACCEPT");
  await on(COLE, async () => COLE.app.applyReturnedProgram((await reviewOf(COLE, T1, GROUP)).id));
  eq(await programsOf(COLE), ["Cole Plan (7w)"], "4: taken");
  await db.query(`update public.group_members set role = 'trainer' where group_id = $1 and user_id = $2`, [GROUP, COLE.uid]);

  // ── 5. A gym user the owner made a trainer reviews a member's request ──
  await db.query(`update public.group_members set role = 'trainer' where group_id = $1 and user_id = $2`, [GROUP, CODY.uid]);
  CARA.programs = [CARA_P]; COLE.programs = [];
  await resetWorld();
  await ask(CARA, CARA_P, T1, TARA.uid, GROUP);
  eq(await on(CODY, async () => stages(await CODY.app.loadMyGroupReviews())), ["Cara Plan@09:00:awaiting"], "5: Cody has it to review");
  await reviewAndReturn(CODY, T1, GROUP);
  eq(await gymReviews(CARA), { waiting: ["Cara Plan:back"], sentForReview: [] }, "5: back with Cody's changes, on Cara's Programs page");
  await on(CARA, async () => CARA.app.applyReturnedProgram((await reviewOf(CARA, T1, GROUP)).id));
  eq(await programsOf(CARA), ["Cara Plan (7w)"], "5: taken");
  await db.query(`update public.group_members set role = 'member' where group_id = $1 and user_id = $2`, [GROUP, CODY.uid]);

  eq(warnings, [], "no phone logged a swallowed error");
  await closeWorld();
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
