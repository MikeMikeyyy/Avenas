// A review Cara asks for: of Tara (1:1), or of the group (where Tara, its
// owner, and Cole, its other trainer, can both act on it). From then on: a
// trainer edits it in the builder (a draft only they see), sends it back (and
// sends updates), archives, restores or deletes it; Cara withdraws it while
// it waits, accepts what came back, removes that card, and deletes / archives
// / restores her own program, which accepting writes over.

import { on } from "../app";
import { OK, pressed, REFUSED, type Action, type Flow, type View } from "../explore";
import { CARA, CODY, COLE, GROUP, resetWorld, TARA, type Person } from "../world";
import type { SentProgram } from "../../../utils/trainerStore";
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
const SENT_AT = "2026-09-26T11:00:00.000Z";
const isIt = (s: SentProgram) => s.programId === CARA_PLAN.id && s.sentAtISO === SENT_AT;
/** A request is refused once it's gone ("no longer available"), or by the
 *  database when it was withdrawn (see returnReview). */
const REFUSALS = /no longer available|withdrawn/i;

// â”€â”€â”€ The model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Model = {
  kind: Kind;
  /** Cara hasn't withdrawn it. */
  exists: boolean;
  archived: boolean;
  /** A trainer deleted it: off a 1:1 inbox, or out of the group's queue. */
  closed: boolean;
  /** The trainer's unsent working copy's version, or null. */
  draft: number | null;
  /** The version last sent back, or null while it waits. */
  returned: number | null;
  /** How many times it's been sent back (each one moves returned_at). */
  returns: number;
  applied: boolean;
  /** Cara removed the card of the return numbered this. */
  removedAt: number | null;
  /** Cara's own program. */
  program: "present" | "archived" | "none";
  programVersion: number;
};

const status = (m: Model) => (m.returns > 0 ? "returned" : "sent");
const listed = (m: Model) => m.exists && !m.closed && !m.archived;
const inArchive = (m: Model) => m.exists && m.archived && !m.closed;
const returnedCard = (m: Model) => m.exists && m.returns > 0 && m.removedAt !== m.returns;

function expected(m: Model): View {
  const trainerCard = listed(m) ? { status: status(m), applied: m.applied, unsentEdits: m.draft !== null } : null;
  const archived = inArchive(m) ? { status: status(m) } : null;
  const v: View = {
    caraWaiting: m.exists && m.returns === 0,
    caraReturned: returnedCard(m) ? { applied: m.applied } : null,
    caraProgram: m.program === "none" ? null : { count: 1, archived: m.program === "archived", version: m.programVersion },
  };
  if (m.kind === "direct") {
    Object.assign(v, { taraInbox: trainerCard, taraArchive: archived });
  } else {
    const card = trainerCard;
    Object.assign(v, {
      caraGroupPage: m.exists && (m.returns > 0 ? m.removedAt !== m.returns : !m.closed)
        ? { returned: m.returns > 0, applied: m.applied } : null,
      // Tara owns the group, so the row is addressed to her: it must still
      // stay out of her 1:1 inbox.
      taraInbox: null,
      hub: { Tara: card, Cole: card },
      groupPage: { Tara: card, Cole: card },
      groupArchive: { Tara: archived, Cole: archived },
      trainerArchive: { Tara: archived, Cole: archived },
      badges: { Tara: listed(m) && m.returns === 0 ? 1 : 0, Cole: listed(m) && m.returns === 0 ? 1 : 0 },
    });
  }
  return v;
}

const trainerCardOf = (s: SentProgram | undefined) =>
  s ? { status: s.status, applied: !!s.appliedAtISO, unsentEdits: !!s.unsentEdits } : null;

async function observe(kind: Kind): Promise<View> {
  const v: View = {};
  await on(CARA, async () => {
    const [sent, dismissed] = await Promise.all([CARA.app.loadSentPrograms(), CARA.app.loadDismissedShareKeys()]);
    const mine = sent.find(isIt);
    // MyPTHome: waiting under Sent to Trainer, or come back under From Your Trainer.
    v.caraWaiting = !!mine && mine.status !== "returned";
    v.caraReturned = mine && mine.status === "returned" && !CARA.app.isReturnedDismissed(mine, dismissed)
      ? { applied: !!mine.appliedAtISO } : null;
    const programs = (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).filter(p => p.name === CARA_PLAN.name);
    v.caraProgram = programs.length === 0 ? null : {
      count: programs.length,
      archived: programs.some(p => !!p.archivedAt),
      version: Math.max(...programs.map(versionOf)),
    };
    if (kind === "group") {
      const own = (await CARA.app.loadGroupReviewPrograms(GROUP)).find(s => isIt(s) && s.senderId === CARA.uid);
      v.caraGroupPage = own ? { returned: own.status === "returned", applied: !!own.appliedAtISO } : null;
    }
  });
  await on(TARA, async () => {
    v.taraInbox = trainerCardOf((await TARA.app.loadSentPrograms()).find(isIt));
    if (kind === "direct") {
      const arch = (await TARA.app.loadTrainerArchive())?.reviews.find(isIt);
      v.taraArchive = arch ? { status: arch.status } : null;
    }
  });
  if (kind === "group") {
    const hub: Record<string, unknown> = {};
    const groupPage: Record<string, unknown> = {};
    const groupArchive: Record<string, unknown> = {};
    const trainerArchive: Record<string, unknown> = {};
    const badges: Record<string, number> = {};
    for (const t of [TARA, COLE]) {
      await on(t, async () => {
        const toDo = await t.app.loadMyGroupReviews();
        hub[t.name] = trainerCardOf(toDo.find(isIt));
        // The group page's Programs Received: other people's requests.
        groupPage[t.name] = trainerCardOf((await t.app.loadGroupReviewPrograms(GROUP)).find(s => isIt(s) && s.senderId !== t.uid));
        const ga = (await t.app.loadGroupArchive(GROUP))?.reviews.find(isIt);
        groupArchive[t.name] = ga ? { status: ga.status } : null;
        const ta = (await t.app.loadTrainerArchive())?.reviews.find(isIt);
        trainerArchive[t.name] = ta ? { status: ta.status } : null;
        badges[t.name] = groupAlertCounts({ unreadByGroup: {}, shares: [], reviews: toDo, myUid: t.uid })[GROUP] ?? 0;
      });
    }
    Object.assign(v, { hub, groupPage, groupArchive, trainerArchive, badges });
  }
  return v;
}

// â”€â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** The request as the person's own list draws it. */
async function drawn(p: Person, kind: Kind): Promise<SentProgram | undefined> {
  return on(p, async () => {
    if (p === CARA) return (await CARA.app.loadSentPrograms()).find(isIt);
    // Programs Received, or the archive when it's been archived.
    if (kind === "direct") {
      return (await p.app.loadSentPrograms()).find(isIt)
        ?? (await p.app.loadTrainerArchive())?.reviews.find(isIt);
    }
    return (await p.app.loadGroupReviewPrograms(GROUP)).find(isIt)
      ?? (await p.app.loadGroupArchive(GROUP))?.reviews.find(isIt);
  });
}

function trainerActions(t: Person, kind: Kind): Action<Model>[] {
  const at = kind === "direct" ? "" : ` (${t.name})`;
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
    {
      label: `${t.name} sends it back${at}`,
      kinds: [kind],
      enabled: listed,
      draw: async () => {
        const entry = await drawn(t, kind);
        return () => on(t, () => pressed(() => t.app.returnReview(entry!.id), REFUSALS));
      },
      apply: m => {
        if (!m.exists) return REFUSED;
        m.returned = m.draft ?? m.returned ?? 0;
        m.draft = null;
        m.returns += 1;
        m.applied = false;
        return OK;
      },
    },
    {
      label: `${t.name} archives it${at}`,
      kinds: [kind],
      enabled: listed,
      draw: async () => {
        const entry = await drawn(t, kind);
        return () => on(t, async () => { await t.app.setReviewArchived(entry!.id, true); return OK; });
      },
      apply: m => { if (m.exists) m.archived = true; return OK; },
    },
    {
      label: `${t.name} restores it${at}`,
      kinds: [kind],
      enabled: inArchive,
      draw: async () => {
        const entry = await drawn(t, kind);
        return () => on(t, async () => { await t.app.setReviewArchived(entry!.id, false); return OK; });
      },
      apply: m => { if (m.exists) m.archived = false; return OK; },
    },
    {
      // Programs Received's Delete, or the archive's: the same call.
      label: `${t.name} deletes it${at}`,
      kinds: [kind],
      enabled: m => listed(m) || inArchive(m),
      draw: async () => {
        const entry = await drawn(t, kind);
        return () => on(t, async () => {
          if (kind === "group") await t.app.setGroupReviewDone(entry!.id, true);
          else await t.app.dismissReceivedReview(entry!.id);
          return OK;
        });
      },
      apply: m => { if (m.exists) m.closed = true; return OK; },
    },
  ];
}

async function caraPrograms() {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  return { programs, plan: programs.find(p => p.name === CARA_PLAN.name) };
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
      label: "Cara accepts the changes",
      kinds: [kind],
      enabled: m => returnedCard(m) && !m.applied,
      draw: async () => {
        const entry = await drawn(CARA, kind);
        return () => on(CARA, () => pressed(() => CARA.app.applyReturnedProgram(entry!.id), REFUSALS));
      },
      apply: m => {
        if (!m.exists || m.returned === null) return REFUSED;
        m.applied = true;
        m.program = "present";
        m.programVersion = m.returned;
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
  ];
}

export function reviewFlow(kind: Kind): Flow<Model> {
  const trainers = kind === "direct" ? [TARA] : [TARA, COLE];
  return {
    name: `${kind} review`,
    kind,
    start: async () => {
      // Cara's program is "active", which archiving refuses; a shelved one can be.
      CARA.programs = [{ ...CARA_PLAN, status: "paused" }];
      TARA.programs = [];
      CODY.programs = [];
      await resetWorld();
      await on(CARA, () => CARA.app.appendSentProgram({
        id: "sent_1",
        programId: CARA_PLAN.id,
        programName: CARA_PLAN.name,
        sentAtISO: SENT_AT,
        status: "sent",
        programSnapshot: { ...CARA_PLAN, status: "paused" },
        ...(kind === "group" ? { groupId: GROUP } : {}),
      }, TARA.uid));
    },
    fresh: () => ({
      kind, exists: true, archived: false, closed: false, draft: null, returned: null, returns: 0,
      applied: false, removedAt: null, program: "present", programVersion: 0,
    }),
    expected,
    observe: () => observe(kind),
    actions: [...trainers.flatMap(t => trainerActions(t, kind)), ...caraActions(kind)],
    stories: (() => {
      const t = (label: string, who = "Tara") => (kind === "direct" ? label : `${label} (${who})`);
      return [
        // Accepting twice with the original deleted: the second lands on the
        // copy the first made, not a new one.
        ["Cara deletes her program", t("Tara sends it back"), "Cara accepts the changes",
          t("Tara edits it in the builder"), t("Tara sends it back"), "Cara accepts the changes"],
        // Archived by the trainer mid-review, restored, sent back, removed by
        // Cara, and an update brings it back.
        [t("Tara edits it in the builder"), t("Tara archives it"), t("Tara restores it"), t("Tara sends it back"),
          "Cara removes the card", t("Tara edits it in the builder"), t("Tara sends it back"), "Cara archives her program",
          "Cara accepts the changes", t("Tara deletes it")],
        ...(kind === "group" ? [
          [t("Cole edits it in the builder", "Cole"), t("Tara sends it back"), t("Cole archives it", "Cole"),
            "Cara accepts the changes", t("Tara restores it"), t("Cole deletes it", "Cole")],
        ] : []),
      ];
    })(),
  };
}
