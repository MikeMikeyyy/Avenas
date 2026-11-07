// A review Cara asks for: of Tara (1:1), or of the group (where Tara, its
// owner, and Cole, its other trainer, can both act on it). From then on: a
// trainer edits it in the builder (a draft only they see), sends it back (and
// sends updates), with comments Cara reads on her card or without (user
// request, 2026-11-06), or removes it, for good (a review has no archive: user
// decision, 2026-11-05); Cara withdraws it while it waits, accepts what came
// back into her program or saves it as a new one (user request, 2026-11-06),
// removes that card, deletes / archives / restores her own program, which
// accepting writes over, and restores her backup onto a new phone. One a
// trainer removes before sending it back reads "Not reviewed" to her, on her
// Sent for Review page and on the group's page, until she clears it.

import { on } from "../app";
import { OK, pressed, REFUSED, type Action, type Flow, type View } from "../explore";
import { restoreOntoNewPhone } from "../restore";
import { CARA, CARA_OWN, CODY, COLE, GROUP, resetWorld, TARA, type Person } from "../world";
import type { SentProgram } from "../../../utils/trainerStore";
import { reviewNoteOf, reviewStage } from "../../../utils/trainerLists";
import { groupAlertCounts } from "../../../utils/groupAlerts";
import { archiveProgram, restoreProgram } from "../../../utils/programArchive";
import { getJSON, setJSON } from "../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../constants/programs";

type Kind = "direct" | "group";

export const CARA_PLAN: SavedProgram = {
  id: "program_cara", name: "Cara Plan", totalWeeks: 6, currentWeek: 2, status: "active", startDate: "01 Sep 2026",
  trainingDays: 3, cycleDays: 4, cyclePattern: ["Push", "Pull", "Legs", "Rest"], dayIds: ["d0", "d1", "d2", "d3"], workouts: {},
};
/** Which version a copy of Cara's program holds: every trainer edit adds a week. */
const versionOf = (p: SavedProgram) => p.totalWeeks - CARA_PLAN.totalWeeks;
/** A copy of the changes Cara saved as a new program: not her program, and
 *  not the copy an accept makes in its place once it's gone (which knows what
 *  it stands in for, shareOrigin). */
const savedApart = (p: SavedProgram) => p.name === CARA_PLAN.name && p.id !== CARA_PLAN.id && !p.shareOrigin;
/** Her program as she sends it: shelved (archiving refuses an active one),
 *  with marks from its run, which a copy saved apart mustn't carry. */
const SENT_PLAN: SavedProgram = { ...CARA_PLAN, status: "paused", skippedDates: ["2026-09-10"], pushedDates: ["2026-09-12"] };
/** When Cara asked, as her request stamped it (start). */
let sentAt = "";
const isIt = (s: SentProgram) => s.programId === CARA_PLAN.id && s.sentAtISO === sentAt;
/** A request is refused once it's gone ("no longer available"), or by the
 *  database when it was withdrawn (see returnReview); Got it, once changes
 *  have come back meanwhile (ReviewChangedError). */
const REFUSALS = /no longer available|withdrawn|just sent changes/i;

// â”€â”€â”€ The model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Model = {
  kind: Kind;
  /** Cara hasn't withdrawn it. */
  exists: boolean;
  /** A trainer removed it: off a 1:1 inbox, or out of the group's queue. */
  closed: boolean;
  /** The trainer's unsent working copy's version, or null. */
  draft: number | null;
  /** The version last sent back, or null while it waits. 0 is the one Cara
   *  sent: sent back with no changes, only reviewed (noChanges). */
  returned: number | null;
  /** How many times it's been sent back (each one moves returned_at). */
  returns: number;
  applied: boolean;
  /** Cara removed the card of the return numbered this. */
  removedAt: number | null;
  /** Cara's own program (or the copy an accept made in its place). */
  program: "present" | "archived" | "none";
  programVersion: number;
  /** The versions Cara saved as new programs, one each time. */
  saved: number[];
  /** Her last accept saved the changes apart, recorded on this phone: its View
   *  opens that copy. */
  savedAsHere: boolean;
  /** What the trainer last wrote as they removed it without sending it back
   *  (migration 0053), or null: Cara reads it while it's Not reviewed. */
  note: string | null;
  /** What the trainer wrote as they last sent it back (Send Back's box,
   *  migration 0054), or null for nothing: Cara reads it from then on. */
  comments: string | null;
};

const status = (m: Model) => (m.returns > 0 ? "returned" : "sent");
const listed = (m: Model) => m.exists && !m.closed;
const returnedCard = (m: Model) => m.exists && m.returns > 0 && m.removedAt !== m.returns;
/** To Cara: a trainer removed it without ever sending it back, "Not reviewed". */
const notReviewed = (m: Model) => m.exists && m.returns === 0 && m.closed;
/** Sent back as she sent it, only reviewed (user request, 2026-11-06): Got it
 *  in Accept's place. Once changes come back it never reads so again. */
const noChanges = (m: Model) => m.returns > 0 && m.returned === 0;

function expected(m: Model): View {
  // The trainer's own, on the review screen: what they sent with it.
  const trainerCard = listed(m)
    ? { status: status(m), applied: m.applied, unsentEdits: m.draft !== null, comments: m.comments, noChanges: noChanges(m) }
    : null;
  // What Cara reads from the trainer on her card and its page (reviewNoteOf):
  // why it wasn't reviewed, while it's Not reviewed; else the comments it came
  // back with, before she takes them and after (user decision, 2026-11-06).
  const caraNote = notReviewed(m)
    ? (m.note ? { kind: "removed", note: m.note } : null)
    : m.exists && m.returns > 0 && m.comments ? { kind: "comments", note: m.comments } : null;
  const v: View = {
    caraWaiting: m.exists && m.returns === 0 && !notReviewed(m),
    caraNotReviewed: notReviewed(m),
    caraNote,
    caraReturned: returnedCard(m) ? { applied: m.applied, noChanges: noChanges(m) } : null,
    caraProgram: m.program === "none" ? null : { count: 1, archived: m.program === "archived", version: m.programVersion },
    // Each one new: not started, nothing of her program's run.
    caraSaved: [...m.saved].sort((a, b) => a - b).map(version => ({ version, fresh: true })),
    // An accepted review's View (Open in My Programs): the program with the
    // changes in it. Without a record of a copy kept apart (another phone),
    // her program, and with that gone, nothing to open.
    caraViewOpens: m.exists && m.applied ? (m.savedAsHere ? "saved" : m.program !== "none" ? "program" : "gone") : null,
  };
  if (m.kind === "direct") {
    Object.assign(v, { taraInbox: trainerCard });
  } else {
    const card = trainerCard;
    Object.assign(v, {
      // Her own request stays on the group's page until she removes it: one a
      // coach cleared without a review says so, rather than vanishing.
      caraGroupPage: m.exists && (m.returns > 0 ? m.removedAt !== m.returns : true)
        ? { returned: m.returns > 0, applied: m.applied, notReviewed: notReviewed(m), note: caraNote, noChanges: noChanges(m) } : null,
      // Tara owns the group, so the row is addressed to her: it must still
      // stay out of her 1:1 inbox.
      taraInbox: null,
      hub: { Tara: card, Cole: card },
      groupPage: { Tara: card, Cole: card },
      badges: { Tara: listed(m) && m.returns === 0 ? 1 : 0, Cole: listed(m) && m.returns === 0 ? 1 : 0 },
    });
  }
  return v;
}

const trainerCardOf = (s: SentProgram | undefined) =>
  s ? { status: s.status, applied: !!s.appliedAtISO, unsentEdits: !!s.unsentEdits, comments: s.trainerComments ?? null, noChanges: !!s.noChanges } : null;

async function observe(kind: Kind): Promise<View> {
  const v: View = {};
  await on(CARA, async () => {
    const [sent, dismissed] = await Promise.all([CARA.app.loadSentPrograms(), CARA.app.loadDismissedShareKeys()]);
    const mine = sent.find(isIt);
    // A gym user's program pages: waiting on Sent for Review (or Not reviewed
    // there, once a trainer removed it without sending it back); come back on
    // the From page until its changes are taken, then on Sent for Review as
    // Accepted (utils/trainerLists.ts fromTrainerLists / sentForReviewList).
    v.caraWaiting = !!mine && reviewStage(mine) === "awaiting";
    v.caraNotReviewed = !!mine && reviewStage(mine) === "removed";
    // What the trainer wrote, on the row and the program page (ReviewNote).
    v.caraNote = mine ? reviewNoteOf(mine) : null;
    // Its card: Accept, or Got it when it came back with no changes.
    v.caraReturned = mine && mine.status === "returned" && !CARA.app.isReturnedDismissed(mine, dismissed)
      ? { applied: !!mine.appliedAtISO, noChanges: !!mine.noChanges } : null;
    const all = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const programs = all.filter(p => p.name === CARA_PLAN.name && !savedApart(p));
    v.caraProgram = programs.length === 0 ? null : {
      count: programs.length,
      archived: programs.some(p => !!p.archivedAt),
      version: Math.max(...programs.map(versionOf)),
    };
    v.caraSaved = all.filter(savedApart).sort((a, b) => versionOf(a) - versionOf(b)).map(p => ({
      version: versionOf(p),
      fresh: p.status === "created" && p.currentWeek === 0 && !p.pausedAt && !p.holds?.length && !p.skippedDates?.length
        && !p.pushedDates?.length && !p.pulledDates?.length && !p.runs?.length,
    }));
    if (mine?.appliedAtISO) {
      const id = await CARA.app.acceptedChangesProgramId(mine);
      const opens = all.find(p => p.id === id);
      v.caraViewOpens = !opens ? "gone" : savedApart(opens) ? "saved" : "program";
    } else {
      v.caraViewOpens = null;
    }
    if (kind === "group") {
      const own = (await CARA.app.loadGroupReviewPrograms(GROUP)).find(s => isIt(s) && s.senderId === CARA.uid);
      v.caraGroupPage = own
        ? { returned: own.status === "returned", applied: !!own.appliedAtISO, notReviewed: reviewStage(own) === "removed", note: reviewNoteOf(own), noChanges: !!own.noChanges }
        : null;
    }
  });
  await on(TARA, async () => {
    v.taraInbox = trainerCardOf((await TARA.app.loadSentPrograms()).find(isIt));
  });
  if (kind === "group") {
    const hub: Record<string, unknown> = {};
    const groupPage: Record<string, unknown> = {};
    const badges: Record<string, number> = {};
    for (const t of [TARA, COLE]) {
      await on(t, async () => {
        const toDo = await t.app.loadMyGroupReviews();
        hub[t.name] = trainerCardOf(toDo.find(isIt));
        // The group page's Programs Received: other people's requests.
        groupPage[t.name] = trainerCardOf((await t.app.loadGroupReviewPrograms(GROUP)).find(s => isIt(s) && s.senderId !== t.uid));
        badges[t.name] = groupAlertCounts({ unreadByGroup: {}, shares: [], reviews: toDo, myUid: t.uid })[GROUP] ?? 0;
      });
    }
    Object.assign(v, { hub, groupPage, badges });
  }
  return v;
}

// â”€â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** The request as the person's own list draws it. */
async function drawn(p: Person, kind: Kind): Promise<SentProgram | undefined> {
  return on(p, async () => {
    if (p === CARA) return (await CARA.app.loadSentPrograms()).find(isIt);
    // Programs Received.
    if (kind === "direct") return (await p.app.loadSentPrograms()).find(isIt);
    return (await p.app.loadGroupReviewPrograms(GROUP)).find(isIt);
  });
}

/** The trainer's message, written before a removal from their list as
 *  utils/reviewRemoval.ts removeReviewForTrainer does: always (null for none),
 *  never once it's been sent back, and never holding the removal up. */
async function writeNote(t: Person, entry: SentProgram, note: string | null): Promise<void> {
  if (entry.status === "returned") return;
  await t.app.saveReviewRemovalNote(entry.id, note).catch(() => undefined);
}

function trainerActions(t: Person, kind: Kind): Action<Model>[] {
  const at = kind === "direct" ? "" : ` (${t.name})`;
  const reason = `${t.name}: no time for reviews this month`;
  // Send Back / Send Update / Send a Comment (SendBackSheet), with what's in
  // its box: blank, or comments, typed with stray spaces that the server trims.
  // With no edit to send, the first is a review with no changes and a later one
  // is comments alone (user request, 2026-11-06).
  const sendBack = (comments: string): Action<Model> => ({
    label: `${t.name} sends it back${comments ? " with comments" : ""}${at}`,
    kinds: [kind],
    enabled: listed,
    draw: async () => {
      const entry = await drawn(t, kind);
      return () => on(t, () => pressed(() => t.app.returnReview(entry!.id, comments), REFUSALS));
    },
    apply: m => {
      if (!m.exists) return REFUSED;
      // A new version (an edit sent), or the first send-back, reopens her
      // Accept; comments alone on the version she has keep it (0054).
      if (m.draft !== null || m.returns === 0) m.applied = false;
      m.returned = m.draft ?? m.returned ?? 0;
      m.draft = null;
      m.returns += 1;
      // An update sends what's in the box, so a blank one takes the last
      // version's comments off.
      m.comments = comments.trim() || null;
      return OK;
    },
  });
  // Programs Received's Remove, for good (RemoveReviewSheet, so a message).
  const remove = (note: string | null): Action<Model> => ({
    label: `${t.name} removes it${note ? " with a reason" : ""}${at}`,
    kinds: [kind],
    enabled: listed,
    draw: async () => {
      const entry = await drawn(t, kind);
      return () => on(t, async () => {
        await writeNote(t, entry!, note);
        if (kind === "group") await t.app.setGroupReviewDone(entry!.id, true);
        else await t.app.dismissReceivedReview(entry!.id);
        return OK;
      });
    },
    apply: m => {
      if (!m.exists) return OK;
      m.closed = true;
      // Sent back meanwhile: the server refuses the message (nothing to explain).
      if (m.returns === 0) m.note = note;
      return OK;
    },
  });
  return [
    {
      label: `${t.name} edits it in the builder${at}`,
      kinds: [kind],
      enabled: listed,
      notTwiceAtOnce: true,
      // new-program.tsx in review mode: opens the trainer's working copy and
      // saves it back with a week added.
      draw: async () => {
        const entry = await drawn(t, kind);
        return () => on(t, () => pressed(async () => {
          const snap = entry!.programSnapshot!;
          await t.app.updateSentProgram(entry!.id, {
            programSnapshot: { ...snap, totalWeeks: snap.totalWeeks + 1 },
            programName: snap.name,
            lastEditedAtISO: new Date().toISOString(),
          });
        }, REFUSALS));
      },
      apply: m => {
        if (!m.exists) return REFUSED;
        m.draft = (m.draft ?? m.returned ?? 0) + 1;
        return OK;
      },
    },
    sendBack(""),
    sendBack(`  ${t.name}: kept your rest days, more volume on legs  `),
    remove(null),
    remove(reason),
  ];
}

async function caraPrograms() {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  return { programs, plan: programs.find(p => p.name === CARA_PLAN.name && !savedApart(p)) };
}

function caraActions(kind: Kind): Action<Model>[] {
  return [
    {
      label: "Cara withdraws it (Sent to Trainer)",
      kinds: [kind],
      enabled: m => m.exists && m.returns === 0,
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, async () => { await CARA.app.removeSentProgram(entry!.id); return OK; });
      },
      apply: m => { m.exists = false; return OK; },
    },
    {
      // Accept's Update My Program (utils/reviewAccept.ts), and Accept with
      // her program gone, which makes it again without asking. Only on changes:
      // one sent back with none has Got it instead.
      label: "Cara accepts the changes",
      kinds: [kind],
      enabled: m => returnedCard(m) && !m.applied && !noChanges(m),
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, () => pressed(() => CARA.app.applyReturnedProgram(entry!.id, "update"), REFUSALS));
      },
      apply: m => {
        if (!m.exists || m.returned === null) return REFUSED;
        // Taken already, on a screen drawn before: the app finds it accepted
        // and leaves it.
        if (m.applied) return OK;
        m.applied = true;
        m.program = "present";
        m.programVersion = m.returned;
        m.savedAsHere = false;
        return OK;
      },
    },
    {
      // Accept's Save as New Program: offered while there's a program of hers
      // to update instead.
      label: "Cara saves the changes as a new program",
      kinds: [kind],
      enabled: m => returnedCard(m) && !m.applied && m.program !== "none" && !noChanges(m),
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, () => pressed(() => CARA.app.applyReturnedProgram(entry!.id, "new"), REFUSALS));
      },
      apply: m => {
        if (!m.exists || m.returned === null) return REFUSED;
        if (m.applied) return OK; // as above
        m.applied = true;
        m.saved.push(m.returned);
        m.savedAsHere = true;
        return OK;
      },
    },
    {
      // Got it, on one sent back with no changes (user decision, 2026-11-06):
      // seen, and nothing taken into any program.
      label: "Cara taps Got it",
      kinds: [kind],
      enabled: m => returnedCard(m) && !m.applied && noChanges(m),
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, () => pressed(() => CARA.app.acknowledgeReview(entry!.id), REFUSALS));
      },
      apply: m => {
        if (!m.exists || m.returned === null) return REFUSED;
        if (m.applied) return OK; // seen already, on a screen drawn before
        // Changes came back meanwhile: those are for Accept, after a look.
        if (!noChanges(m)) return REFUSED;
        m.applied = true;
        return OK;
      },
    },
    {
      label: "Cara removes the card",
      kinds: [kind],
      enabled: returnedCard,
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, async () => { await CARA.app.dismissSharedBatch(CARA.app.returnedKeyOf(entry!)); return OK; });
      },
      // It hides the send-back the card showed; a newer one still comes back.
      apply: (m, drawn) => { m.removedAt = drawn.returns; return OK; },
    },
    {
      label: "Cara deletes her program",
      screen: "Cara:programs",
      kinds: [kind],
      enabled: m => m.program !== "none",
      draw: async () => () => on(CARA, async () => {
        const { programs, plan } = await caraPrograms();
        if (!plan) return OK;
        await setJSON(PROGRAMS_KEY, programs.filter(p => p.id !== plan.id));
        await CARA.app.removeSharedProgramByLocalId(plan.id);
        return OK;
      }),
      apply: m => { m.program = "none"; return OK; }, // (already gone: still none)
    },
    {
      label: "Cara archives her program",
      screen: "Cara:programs",
      kinds: [kind],
      enabled: m => m.program === "present",
      draw: async () => () => on(CARA, async () => {
        const { programs, plan } = await caraPrograms();
        if (plan) await setJSON(PROGRAMS_KEY, archiveProgram(programs, plan.id));
        return OK;
      }),
      apply: m => { if (m.program === "present") m.program = "archived"; return OK; },
    },
    {
      label: "Cara restores her program",
      screen: "Cara:programs",
      kinds: [kind],
      enabled: m => m.program === "archived",
      draw: async () => () => on(CARA, async () => {
        const { programs, plan } = await caraPrograms();
        if (plan) await setJSON(PROGRAMS_KEY, restoreProgram(programs, plan.id));
        return OK;
      }),
      apply: m => { if (m.program === "archived") m.program = "present"; return OK; },
    },
    {
      // A new phone, or the app deleted and installed again
      // (scripts/harness/restore.ts). Her program comes back under its own id,
      // and so does a copy accepting the changes made in its place, so the
      // next accept still lands on the one program. The card she removed was
      // this phone's alone, and so was the record of a copy saved apart (the
      // copy itself comes back, as any program does).
      label: "Cara restores onto a new phone",
      kinds: [kind],
      enabled: () => true,
      alone: true,
      draw: async () => async () => { await restoreOntoNewPhone(CARA); return OK; },
      apply: m => { m.removedAt = null; m.savedAsHere = false; return OK; },
    },
  ];
}

export function reviewFlow(kind: Kind): Flow<Model> {
  const trainers = kind === "direct" ? [TARA] : [TARA, COLE];
  return {
    name: `${kind} review`,
    kind,
    start: async () => {
      CARA.programs = [SENT_PLAN, CARA_OWN];
      TARA.programs = [];
      CODY.programs = [];
      await resetWorld();
      // Asked the way every screen asks (utils/reviewRequest.ts): My Programs'
      // Send for Review, the Trainer tab's, or a group's page's.
      const sent = await on(CARA, () => CARA.app.requestReview(
        SENT_PLAN,
        kind === "group"
          ? { kind: "group", group: { id: GROUP, name: "Mon Strength", ownerId: TARA.uid } }
          : { kind: "trainer", trainer: { id: TARA.uid, name: TARA.name, initials: "T" } },
      ));
      sentAt = sent.sentAtISO;
    },
    fresh: () => ({
      kind, exists: true, closed: false, draft: null, returned: null, returns: 0,
      applied: false, removedAt: null, program: "present", programVersion: 0, saved: [], savedAsHere: false, note: null,
      comments: null,
    }),
    expected,
    observe: () => observe(kind),
    actions: [...trainers.flatMap(t => trainerActions(t, kind)), ...caraActions(kind)],
    stories: (() => {
      const t = (label: string, who = "Tara") => (kind === "direct" ? label : `${label} (${who})`);
      return [
        // Accepting twice with the original deleted: the second lands on the
        // copy the first made, not a new one.
        ["Cara deletes her program", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes",
          t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // Sent back, removed by Cara, an update brings it back, and the trainer
        // removes it once she's taken it.
        [t("Tara edits it in the builder"), t("Tara sends it back"),
          "Cara removes the card", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara archives her program",
          "Cara accepts the changes", t("Tara removes it")],
        // Restored onto a new phone before the changes come back: they land on
        // her program, not a second one beside it.
        ["Cara restores onto a new phone", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // The original deleted, the changes accepted onto a copy in its place,
        // then restored: the next accept still lands on that copy.
        ["Cara deletes her program", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes",
          "Cara restores onto a new phone", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // A card removed on the old phone is back on the new one.
        [t("Tara edits it in the builder"), t("Tara sends it back"), "Cara removes the card", "Cara restores onto a new phone",
          "Cara accepts the changes"],
        // Saved as a new program (user request, 2026-11-06): hers is left as it
        // was, and the next accept goes into hers, never the copy kept apart.
        [t("Tara edits it in the builder"), t("Tara sends it back"), "Cara saves the changes as a new program",
          t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // Hers deleted after: the next accept makes it again, beside the copy.
        [t("Tara edits it in the builder"), t("Tara sends it back"), "Cara saves the changes as a new program",
          "Cara deletes her program", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // Restored: the copy comes back, and saving again adds a second.
        [t("Tara edits it in the builder"), t("Tara sends it back"), "Cara saves the changes as a new program",
          "Cara restores onto a new phone", t("Tara edits it in the builder"), t("Tara sends it back"),
          "Cara saves the changes as a new program"],
        // Reviewed with no changes, comments only (user request, 2026-11-06: an
        // answer that isn't removing it): Got it, her program as it was; a
        // comment after it keeps it seen; changes after that are for Accept.
        [t("Tara sends it back with comments"), "Cara taps Got it", t("Tara sends it back with comments"),
          t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // A comment on changes she's taken: they stay taken, the comment read.
        [t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes",
          t("Tara sends it back with comments"), "Cara restores onto a new phone"],
        // Reviewed with no changes and taken off the trainer's list: Got it
        // still there for her.
        [t("Tara sends it back"), t("Tara removes it"), "Cara taps Got it"],
        // Removed without a review: Not reviewed to Cara for good, and gone
        // when she clears it (user request, 2026-10-29).
        [t("Tara removes it"), "Cara withdraws it (Sent to Trainer)"],
        // With a reason (user request, 2026-11-05): Cara reads it while it's
        // Not reviewed, until she clears it.
        [t("Tara removes it with a reason"), "Cara withdraws it (Sent to Trainer)"],
        // Sent back after all: a later removal can't write one.
        [t("Tara sends it back"), t("Tara removes it with a reason")],
        // Comments with it (user request, 2026-11-06): on Cara's card, kept
        // once she's taken it (user decision), and an update with a blank box
        // takes them off rather than leaving them on a version they weren't
        // written for.
        [t("Tara edits it in the builder"), t("Tara sends it back with comments"), "Cara accepts the changes",
          t("Tara edits it in the builder"), t("Tara sends it back"), t("Tara edits it in the builder"),
          t("Tara sends it back with comments")],
        // Taken off the trainer's list once sent back: Cara still reads them.
        [t("Tara sends it back with comments"), t("Tara removes it with a reason"), "Cara restores onto a new phone"],
        ...(kind === "group" ? [
          // Either trainer removes it for both.
          [t("Cole removes it with a reason", "Cole"), "Cara withdraws it (Sent to Trainer)"],
          [t("Cole edits it in the builder", "Cole"), t("Tara sends it back"), "Cara accepts the changes",
            t("Cole removes it", "Cole")],
          // Either trainer's comments reach her, and the other's update
          // replaces them.
          [t("Cole sends it back with comments", "Cole"), t("Tara edits it in the builder"), t("Tara sends it back with comments")],
        ] : []),
      ];
    })(),
  };
}
