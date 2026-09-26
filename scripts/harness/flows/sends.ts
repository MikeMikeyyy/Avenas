// A program Tara sends: to Cara and Cody directly, or into the group (where
// Cole, the group's other trainer, gets a row too and can archive or delete
// it). From then on: Tara archives, restores, deletes, sends an update or
// takes it back from one client; Cole does what a group trainer can; Cara
// and Cody accept (from the list or the program's page), remove the card,
// and delete / archive / restore their copy.

import { on } from "../app";
import { OK, pressed, type Action, type Flow, type Outcome, type Press, type View } from "../explore";
import { CARA, CODY, COLE, db, GROUP, resetWorld, TARA, type Person } from "../world";
import type { SharedProgram } from "../../../utils/trainerStore";
import { groupAlertCounts } from "../../../utils/groupAlerts";
import { archiveProgram, restoreProgram } from "../../../utils/programArchive";
import { getJSON, setJSON } from "../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../constants/programs";

type Kind = "direct" | "group";
const CLIENTS = [CARA, CODY];

export const BLOCK: SavedProgram = {
  id: "program_block", name: "Block", totalWeeks: 4, currentWeek: 0, status: "created", startDate: "",
  trainingDays: 2, cycleDays: 3, cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["d0", "d1", "d2"], workouts: {},
};
/** Which version of the program a copy holds: every Send Update adds a week. */
const versionOf = (p: SavedProgram) => p.totalWeeks - BLOCK.totalWeeks;

const SENT_AT = "2026-09-26T10:00:00.000Z";
const KEY = `${BLOCK.id}|${SENT_AT}`;
const inBatch = (s: SharedProgram) => s.programId === BLOCK.id && s.sentAtISO === SENT_AT;
/** Who a send has a row for: a group send goes to every member but its sender. */
const recipientsOf = (kind: Kind) => (kind === "direct" ? [CARA, CODY] : [COLE, CARA, CODY]);

/** The id of a person's row of the send: what a card or page they drew holds. */
async function rowOf(p: Person): Promise<{ id: string } | undefined> {
  return (await db.query<{ id: string }>(`select id from public.shared_programs where recipient_id = $1`, [p.uid])).rows[0];
}

// â”€â”€â”€ The model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type Copy = "none" | "present" | "archived";
type Recipient = {
  /** Their row still exists (not deleted, not taken back from them). */
  row: boolean;
  accepted: boolean;
  /** They accepted once and deleted their copy since (deleted_by_recipient_at). */
  deletedCopy: boolean;
  /** The version they removed the card at, or null. */
  removedAt: number | null;
  copy: Copy;
  copyVersion: number;
};
type Model = { kind: Kind; archived: boolean; version: number; r: Record<string, Recipient> };

const rows = (m: Model) => Object.values(m.r).filter(r => r.row);
const live = (m: Model) => rows(m).length > 0;
/** Their card is on their list: the row's there, it isn't archived, and they
 *  haven't removed THIS version of it (a Send Update brings it back). */
const cardShows = (m: Model, name: string) => {
  const r = m.r[name];
  return r.row && !m.archived && !(r.removedAt !== null && r.removedAt >= m.version);
};

function expected(m: Model): View {
  const cards: Record<string, unknown> = {};
  const groupCards: Record<string, unknown> = {};
  const copies: Record<string, unknown> = {};
  const badges: Record<string, number> = {};
  const clientPage: Record<string, boolean> = {};
  for (const c of CLIENTS) {
    const r = m.r[c.name];
    const card = cardShows(m, c.name) ? { accepted: r.accepted, deletedCopy: !r.accepted && r.deletedCopy } : null;
    cards[c.name] = card;
    copies[c.name] = r.copy === "none" ? null : { count: 1, archived: r.copy === "archived", version: r.copyVersion };
    if (m.kind === "group") {
      groupCards[c.name] = card;
      badges[c.name] = cardShows(m, c.name) && !r.accepted && !r.deletedCopy ? 1 : 0;
    } else {
      clientPage[c.name] = r.row && !m.archived && !r.deletedCopy;
    }
  }
  const present = rows(m);
  const listed = present.length > 0 && !m.archived ? { total: present.length, accepted: present.filter(r => r.accepted).length } : null;
  const archived = present.length > 0 && m.archived ? { total: present.length } : null;
  const v: View = { cards, copies, trainerSent: listed, trainerArchive: archived };
  if (m.kind === "group") {
    Object.assign(v, {
      groupCards, badges,
      groupPage: { Tara: listed, Cole: listed },
      groupArchive: { Tara: archived, Cole: archived },
    });
  } else {
    v.clientPage = clientPage;
  }
  return v;
}

async function observe(kind: Kind): Promise<View> {
  const cards: Record<string, unknown> = {};
  const groupCards: Record<string, unknown> = {};
  const copies: Record<string, unknown> = {};
  const badges: Record<string, number> = {};
  const clientPage: Record<string, boolean> = {};
  for (const c of CLIENTS) {
    await on(c, async () => {
      const shares = await c.app.loadSharedPrograms();
      const card = c.app.receivedFromTrainers(shares, c.uid).find(inBatch);
      cards[c.name] = card ? { accepted: !!card.acceptedAtISO, deletedCopy: !card.acceptedAtISO && !!card.deletedByRecipientAtISO } : null;
      const mine = (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).filter(p => p.name === BLOCK.name);
      copies[c.name] = mine.length === 0 ? null : {
        count: mine.length,
        archived: mine.some(p => !!p.archivedAt),
        version: Math.max(...mine.map(versionOf)),
      };
      if (kind === "group") {
        // The group page's Group Programs, as a member sees it.
        const sent = (await c.app.loadGroupSharedPrograms(GROUP)).filter(s => inBatch(s) && s.senderId !== c.uid);
        const own = sent.find(s => s.clientId === c.uid);
        groupCards[c.name] = sent.length === 0 ? null
          : { accepted: !!own?.acceptedAtISO, deletedCopy: !own?.acceptedAtISO && !!own?.deletedByRecipientAtISO };
        badges[c.name] = groupAlertCounts({ unreadByGroup: {}, shares, reviews: await c.app.loadMyGroupReviews(), myUid: c.uid })[GROUP] ?? 0;
      }
    });
  }
  const v: View = { cards, copies };
  await on(TARA, async () => {
    // PTHome's Programs Sent: my sends, one card per batch.
    const mine = (await TARA.app.loadSharedPrograms()).filter(s => inBatch(s) && !s.receivedFromCoachId);
    v.trainerSent = mine.length ? { total: mine.length, accepted: mine.filter(s => s.acceptedAtISO).length } : null;
    const arch = (await TARA.app.loadTrainerArchive())?.sends.filter(inBatch) ?? [];
    v.trainerArchive = arch.length ? { total: arch.length } : null;
    if (kind === "direct") {
      // A client's page, as app/trainer/client/[id].tsx filters it.
      for (const c of CLIENTS) clientPage[c.name] = mine.some(s => s.clientId === c.uid && !s.deletedByRecipientAtISO);
    }
  });
  if (kind === "group") {
    const groupPage: Record<string, unknown> = {};
    const groupArchive: Record<string, unknown> = {};
    for (const t of [TARA, COLE]) {
      await on(t, async () => {
        const page = (await t.app.loadGroupSharedPrograms(GROUP)).filter(inBatch);
        groupPage[t.name] = page.length ? { total: page.length, accepted: page.filter(s => s.acceptedAtISO).length } : null;
        const arch = (await t.app.loadGroupArchive(GROUP))?.sends.filter(inBatch) ?? [];
        groupArchive[t.name] = arch.length ? { total: arch.length } : null;
      });
    }
    Object.assign(v, { groupCards, badges, groupPage, groupArchive });
  } else {
    v.clientPage = clientPage;
  }
  return v;
}

// â”€â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function myCopy(): Promise<{ programs: SavedProgram[]; copy: SavedProgram | undefined }> {
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  return { programs, copy: programs.find(p => p.name === BLOCK.name) };
}

function clientActions(c: Person): Action<Model>[] {
  const me = (m: Model) => m.r[c.name];
  const accept = (m: Model): Outcome => {
    const r = me(m);
    if (!r.row || m.archived) return "refused";
    r.accepted = true;
    r.deletedCopy = false;
    r.copy = "present";
    r.copyVersion = m.version;
    return OK;
  };
  const acceptable = (m: Model) => cardShows(m, c.name) && !me(m).accepted;
  return [
    {
      // The hub's and the group page's Accept both call this.
      label: `${c.name} accepts`,
      kinds: ["direct", "group"],
      enabled: acceptable,
      draw: async () => () => on(c, () => pressed(() => c.app.acceptSharedProgramBatch(KEY))),
      apply: accept,
    },
    {
      label: `${c.name} accepts on the program's page`,
      kinds: ["direct", "group"],
      enabled: acceptable,
      draw: async () => {
        const row = await rowOf(c);
        return () => on(c, () => pressed(() => c.app.acceptSharedProgram(row!.id)));
      },
      apply: accept,
    },
    {
      label: `${c.name} removes the card`,
      kinds: ["direct", "group"],
      enabled: m => cardShows(m, c.name),
      draw: async () => {
        // The card on screen, as the list drew it: it holds the version it
        // was drawn at, and that's what its Remove hides.
        const card = await on(c, async () => (await c.app.loadSharedPrograms()).find(s => inBatch(s) && s.clientId === c.uid));
        return () => on(c, async () => { if (card) await c.app.dismissSharedBatch(c.app.dismissKeyOf(card)); return OK; });
      },
      // It hides the version the card showed; a newer one still comes back.
      apply: (m, drawn) => { me(m).removedAt = drawn.version; return OK; },
    },
    {
      label: `${c.name} deletes their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => me(m).copy !== "none",
      draw: async () => () => on(c, async () => {
        // app/programs.tsx's Delete (the program archive's does the same).
        const { programs, copy } = await myCopy();
        if (!copy) return OK;
        await setJSON(PROGRAMS_KEY, programs.filter(p => p.id !== copy.id));
        await c.app.removeSharedProgramByLocalId(copy.id);
        return OK;
      }),
      apply: m => {
        const r = me(m);
        if (r.copy === "none") return OK; // gone already (another screen)
        r.copy = "none";
        if (r.row) { r.deletedCopy = true; r.accepted = false; }
        return OK;
      },
    },
    {
      label: `${c.name} archives their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => me(m).copy === "present",
      draw: async () => () => on(c, async () => {
        const { programs, copy } = await myCopy();
        if (copy) await setJSON(PROGRAMS_KEY, archiveProgram(programs, copy.id));
        return OK;
      }),
      apply: m => { if (me(m).copy === "present") me(m).copy = "archived"; return OK; },
    },
    {
      label: `${c.name} restores their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => me(m).copy === "archived",
      draw: async () => () => on(c, async () => {
        const { programs, copy } = await myCopy();
        if (copy) await setJSON(PROGRAMS_KEY, restoreProgram(programs, copy.id));
        return OK;
      }),
      apply: m => { if (me(m).copy === "archived") me(m).copy = "present"; return OK; },
    },
  ];
}

const archiveTo = (archived: boolean) => (m: Model): Outcome => {
  if (live(m)) m.archived = archived;
  return OK;
};
const deleteAll = (m: Model): Outcome => {
  for (const r of Object.values(m.r)) r.row = false;
  return OK;
};
const simple = (p: Person, fn: () => Promise<unknown>) => async (): Promise<Press> =>
  () => on(p, async () => { await fn(); return OK; });

const trainerActions: Action<Model>[] = [
  {
    label: "Tara archives it (Trainer tab)",
    kinds: ["direct", "group"],
    enabled: m => live(m) && !m.archived,
    draw: simple(TARA, () => TARA.app.setSendBatchArchived(KEY, true)),
    apply: archiveTo(true),
  },
  {
    label: "Tara restores it (Trainer tab archive)",
    kinds: ["direct", "group"],
    enabled: m => live(m) && m.archived,
    draw: simple(TARA, () => TARA.app.setSendBatchArchived(KEY, false)),
    apply: archiveTo(false),
  },
  {
    label: "Tara deletes it (Trainer tab, or its archive)",
    kinds: ["direct", "group"],
    enabled: m => live(m),
    draw: simple(TARA, () => TARA.app.removeSharedProgramBatch(KEY)),
    apply: deleteAll,
  },
  {
    label: "Tara sends an update",
    kinds: ["direct", "group"],
    enabled: m => live(m) && !m.archived,
    notTwiceAtOnce: true,
    // new-program.tsx's shared-edit save: the builder opened on the program as
    // it was drawn, and adds a week.
    draw: async () => {
      const target = await on(TARA, async () => (await TARA.app.loadSharedPrograms()).find(inBatch));
      return () => on(TARA, async () => {
        if (!target?.programSnapshot) return OK;
        const snap = target.programSnapshot;
        await TARA.app.updateSharedProgramBatch(TARA.app.batchKeyOf(target), {
          programSnapshot: { ...snap, totalWeeks: snap.totalWeeks + 1 },
          programName: snap.name,
          lastEditedAtISO: new Date().toISOString(),
          acceptedAtISO: undefined,
        });
        return OK;
      });
    },
    apply: m => {
      if (!live(m)) return OK;
      m.version += 1;
      for (const r of Object.values(m.r)) if (r.row) r.accepted = false;
      return OK;
    },
  },
  ...CLIENTS.map((c): Action<Model> => ({
    label: `Tara takes it back from ${c.name} (client page)`,
    kinds: ["direct"],
    enabled: m => m.r[c.name].row && !m.archived && !m.r[c.name].deletedCopy,
    draw: async () => {
      const row = await rowOf(c);
      return () => on(TARA, async () => { await TARA.app.removeSharedProgram(row!.id); return OK; });
    },
    apply: m => { m.r[c.name].row = false; return OK; },
  })),
  ...[TARA, COLE].flatMap((t): Action<Model>[] => [
    {
      label: `${t.name} archives it (group page)`,
      kinds: ["group"],
      enabled: m => live(m) && !m.archived,
      draw: simple(t, () => t.app.setSendBatchArchived(KEY, true, GROUP)),
      apply: archiveTo(true),
    },
    {
      label: `${t.name} restores it (group archive)`,
      kinds: ["group"],
      enabled: m => live(m) && m.archived,
      draw: simple(t, () => t.app.setSendBatchArchived(KEY, false, GROUP)),
      apply: archiveTo(false),
    },
    {
      label: `${t.name} deletes it (group page, or its archive)`,
      kinds: ["group"],
      enabled: m => live(m),
      draw: simple(t, () => t.app.removeGroupSharedProgramBatch(GROUP, KEY)),
      apply: deleteAll,
    },
  ]),
];

export function sendFlow(kind: Kind): Flow<Model> {
  return {
    name: `${kind} send`,
    kind,
    start: async () => {
      TARA.programs = [BLOCK];
      CARA.programs = [];
      CODY.programs = [];
      await resetWorld();
      await on(TARA, () => TARA.app.appendSharedPrograms(recipientsOf(kind).map((r, i) => ({
        id: `share_${i}`,
        clientId: r.uid,
        programId: BLOCK.id,
        programName: BLOCK.name,
        sentAtISO: SENT_AT,
        programSnapshot: BLOCK,
        ...(kind === "group" ? { groupId: GROUP } : {}),
      }))));
    },
    fresh: () => {
      const r: Record<string, Recipient> = {};
      for (const p of recipientsOf(kind)) r[p.name] = { row: true, accepted: false, deletedCopy: false, removedAt: null, copy: "none", copyVersion: 0 };
      return { kind, archived: false, version: 0, r };
    },
    expected,
    observe: () => observe(kind),
    actions: [...trainerActions, ...CLIENTS.flatMap(clientActions)],
    stories: [
      // Archive it, bring it back, and the client takes it off their list.
      ["Tara archives it (Trainer tab)", "Tara restores it (Trainer tab archive)", "Cara removes the card"],
      // The same after accepting, then an update brings the card back to
      // accept again, over the same copy.
      ["Cara accepts", "Tara archives it (Trainer tab)", "Tara restores it (Trainer tab archive)", "Cara removes the card",
        "Tara sends an update", "Cara accepts", "Cara archives their copy", "Tara sends an update", "Cara accepts on the program's page"],
      // A client deletes their copy while it's archived, it comes back
      // showing that, and accepting again makes one new copy.
      ["Cody accepts", "Tara archives it (Trainer tab)", "Cody deletes their copy", "Tara restores it (Trainer tab archive)",
        "Cody accepts", "Tara deletes it (Trainer tab, or its archive)", "Cody deletes their copy"],
      ...(kind === "group" ? [
        // Two trainers of the group taking turns.
        ["Cole archives it (group page)", "Tara restores it (group archive)", "Cara accepts", "Tara archives it (Trainer tab)",
          "Cole restores it (group archive)", "Cody removes the card", "Cole deletes it (group page, or its archive)"],
      ] : []),
    ],
  };
}
