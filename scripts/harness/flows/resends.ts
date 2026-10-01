// A program Tara sends, then sends AGAIN: after archiving and restoring it in
// her My Programs, after editing it, after archiving, deleting or updating the
// earlier send, after taking it back, or while the earlier one is still out.
// Directly (the Trainer tab to Cara and Cody, or Cara's client page to her
// alone) or into the group, where Cole, its other trainer, can archive, restore
// or delete any send of it.
//
// Beside what the single-send flow (./sends.ts) checks, the rule under test:
// a client has ONE copy of the program however many sends of it they accept.
// Each accept updates it, as a Send Update would, so it holds the version they
// accepted last (user decision, 2026-10-01; copyToUpdate in
// utils/trainerStore.ts). And Tara can only send what her picker lists: not
// while the program is archived, and again once it's restored.

import { on } from "../app";
import { OK, pressed, type Action, type Flow, type Outcome, type Press, type View } from "../explore";
import { CARA, CODY, COLE, db, GROUP, resetWorld, TARA, type Person } from "../world";
import { BLOCK } from "./sends";
import type { SharedProgram } from "../../../utils/trainerStore";
import { groupAlertCounts } from "../../../utils/groupAlerts";
import { archiveProgram, restoreProgram, unarchivedPrograms } from "../../../utils/programArchive";
import { getJSON, setJSON } from "../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../constants/programs";

type Kind = "direct" | "group";
const CLIENTS = [CARA, CODY];

/** The first send and up to two more in one run. */
const MAX_SENDS = 3;
/** When the nth send went (0 = the first): fixed, so a run plays again exactly. */
const sentAt = (n: number) => new Date(Date.UTC(2026, 8, 26, 10, n)).toISOString();
const keyOf = (n: number) => `${BLOCK.id}|${sentAt(n)}`;
const SENT_AT = Array.from({ length: MAX_SENDS + 2 }, (_, n) => sentAt(n));
const sendOf = (s: { sentAtISO: string }) => SENT_AT.indexOf(s.sentAtISO);
const ofBlock = (s: SharedProgram) => s.programId === BLOCK.id;
/** "send 1" is the first: what the labels call them. */
const nameOf = (n: number) => `send ${n + 1}`;

/** How many sends have gone this run: the next one's index. Sends are never
 *  pressed at the same instant (one screen), so this counts in model order. */
let sendsMade = 0;

/** The row of send `n` a person has: what a card or page they drew holds. */
async function rowOf(p: Person, n: number): Promise<{ id: string } | undefined> {
  return (await db.query<{ id: string }>(
    `select id from public.shared_programs where recipient_id = $1 and sent_key = $2`, [p.uid, sentAt(n)],
  )).rows[0];
}

// ─── The model ───────────────────────────────────────────────────────────────

type Rec = {
  /** Their row of the send still exists (not deleted, not taken back). */
  row: boolean;
  accepted: boolean;
  /** Their accept of this send landed on the copy they have now. */
  linked: boolean;
  /** They deleted the copy this send was on (deleted_by_recipient_at). */
  deletedCopy: boolean;
  /** The version of the send they removed its card at, or null. */
  removedAt: number | null;
};
type Send = { archived: boolean; version: number; weeks: number; r: Record<string, Rec> };
type Copy = { state: "none" | "present" | "archived"; weeks: number };
type Model = {
  kind: Kind;
  /** Tara's own program: archived in her My Programs, and its length, which
   *  marks each version of it (an edit adds 10 weeks, a Send Update one). */
  block: { archived: boolean; weeks: number };
  sends: Send[];
  copies: Record<string, Copy>;
};

const rows = (s: Send) => Object.values(s.r).filter(r => r.row);
const live = (s: Send) => rows(s).length > 0;
/** A send's card is on a person's list: their row's there, the send isn't
 *  archived, and they haven't removed THIS version of it. */
const cardShows = (s: Send, name: string) => {
  const r = s.r[name];
  return !!r && r.row && !s.archived && !(r.removedAt !== null && r.removedAt >= s.version);
};
const recipientsOf = (kind: Kind, onlyCara: boolean): Person[] =>
  kind === "group" ? [COLE, CARA, CODY] : onlyCara ? [CARA] : [CARA, CODY];

function expected(m: Model): View {
  const cards: Record<string, unknown> = {};
  const groupCards: Record<string, unknown> = {};
  const copies: Record<string, unknown> = {};
  const badges: Record<string, number> = {};
  const clientPage: Record<string, unknown> = {};
  for (const c of CLIENTS) {
    const shown = m.sends.flatMap((s, n) => {
      if (!cardShows(s, c.name)) return [];
      const r = s.r[c.name];
      return [{ send: n, accepted: r.accepted, deletedCopy: !r.accepted && r.deletedCopy }];
    });
    cards[c.name] = shown;
    const copy = m.copies[c.name];
    copies[c.name] = copy.state === "none" ? null : { count: 1, archived: copy.state === "archived", weeks: copy.weeks };
    if (m.kind === "group") {
      groupCards[c.name] = shown;
      badges[c.name] = shown.filter(x => !x.accepted && !x.deletedCopy).length;
    } else {
      clientPage[c.name] = m.sends.flatMap((s, n) => {
        const r = s.r[c.name];
        return r && r.row && !s.archived && !r.deletedCopy ? [n] : [];
      });
    }
  }
  const listed = m.sends.flatMap((s, n) => (live(s) && !s.archived
    ? [{ send: n, total: rows(s).length, accepted: rows(s).filter(r => r.accepted).length }] : []));
  const archived = m.sends.flatMap((s, n) => (live(s) && s.archived ? [{ send: n, total: rows(s).length }] : []));
  const v: View = {
    cards, copies, trainerSent: listed, trainerArchive: archived,
    picker: !m.block.archived,
    taraBlock: m.block,
  };
  if (m.kind === "group") {
    Object.assign(v, { groupCards, badges, groupPage: { Tara: listed, Cole: listed }, groupArchive: { Tara: archived, Cole: archived } });
  } else {
    v.clientPage = clientPage;
  }
  return v;
}

/** One summary per send, in send order. */
function bySend<T>(entries: SharedProgram[], summarise: (rows: SharedProgram[], n: number) => T): T[] {
  const groups = new Map<number, SharedProgram[]>();
  for (const s of entries) groups.set(sendOf(s), [...(groups.get(sendOf(s)) ?? []), s]);
  return [...groups.keys()].sort((a, b) => a - b).map(n => summarise(groups.get(n)!, n));
}
const listedSummary = (rs: SharedProgram[], n: number) => ({ send: n, total: rs.length, accepted: rs.filter(s => !!s.acceptedAtISO).length });

async function observe(kind: Kind): Promise<View> {
  const cards: Record<string, unknown> = {};
  const groupCards: Record<string, unknown> = {};
  const copies: Record<string, unknown> = {};
  const badges: Record<string, number> = {};
  const clientPage: Record<string, unknown> = {};
  for (const c of CLIENTS) {
    await on(c, async () => {
      const shares = await c.app.loadSharedPrograms();
      cards[c.name] = c.app.receivedFromTrainers(shares, c.uid).filter(ofBlock)
        .map(s => ({ send: sendOf(s), accepted: !!s.acceptedAtISO, deletedCopy: !s.acceptedAtISO && !!s.deletedByRecipientAtISO }))
        .sort((a, b) => a.send - b.send);
      const mine = (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).filter(p => p.name === BLOCK.name);
      copies[c.name] = mine.length === 0 ? null : {
        count: mine.length,
        archived: mine.some(p => !!p.archivedAt),
        weeks: Math.max(...mine.map(p => p.totalWeeks)),
      };
      if (kind === "group") {
        // The group page's Group Programs, as a member sees it.
        const sent = (await c.app.loadGroupSharedPrograms(GROUP)).filter(s => ofBlock(s) && s.senderId !== c.uid);
        groupCards[c.name] = bySend(sent, (rs, n) => {
          const own = rs.find(s => s.clientId === c.uid);
          return { send: n, accepted: !!own?.acceptedAtISO, deletedCopy: !own?.acceptedAtISO && !!own?.deletedByRecipientAtISO };
        });
        badges[c.name] = groupAlertCounts({ unreadByGroup: {}, shares, reviews: await c.app.loadMyGroupReviews(), myUid: c.uid })[GROUP] ?? 0;
      }
    });
  }
  const v: View = { cards, copies };
  await on(TARA, async () => {
    // PTHome's Programs Sent: my sends, one card per send.
    const mine = (await TARA.app.loadSharedPrograms()).filter(s => ofBlock(s) && !s.receivedFromCoachId);
    v.trainerSent = bySend(mine, listedSummary);
    v.trainerArchive = bySend((await TARA.app.loadTrainerArchive())?.sends.filter(ofBlock) ?? [], (rs, n) => ({ send: n, total: rs.length }));
    if (kind === "direct") {
      // A client's page, as app/trainer/client/[id].tsx filters it.
      for (const c of CLIENTS) {
        clientPage[c.name] = [...new Set(mine.filter(s => s.clientId === c.uid && !s.deletedByRecipientAtISO).map(sendOf))].sort((a, b) => a - b);
      }
    }
    // The send sheet's picker (ProgramPickerSheet), and the program itself.
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    v.picker = unarchivedPrograms(programs).some(p => p.id === BLOCK.id);
    const own = programs.find(p => p.id === BLOCK.id);
    v.taraBlock = own ? { archived: !!own.archivedAt, weeks: own.totalWeeks } : null;
  });
  if (kind === "group") {
    const groupPage: Record<string, unknown> = {};
    const groupArchive: Record<string, unknown> = {};
    for (const t of [TARA, COLE]) {
      await on(t, async () => {
        groupPage[t.name] = bySend((await t.app.loadGroupSharedPrograms(GROUP)).filter(ofBlock), listedSummary);
        groupArchive[t.name] = bySend((await t.app.loadGroupArchive(GROUP))?.sends.filter(ofBlock) ?? [], (rs, n) => ({ send: n, total: rs.length }));
      });
    }
    Object.assign(v, { groupCards, badges, groupPage, groupArchive });
  } else {
    v.clientPage = clientPage;
  }
  return v;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const simple = (p: Person, fn: () => Promise<unknown>) => async (): Promise<Press> =>
  () => on(p, async () => { await fn(); return OK; });

/** Tara's own copy of the program, as My Programs holds it. */
async function taraPrograms(): Promise<SavedProgram[]> {
  return getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
}

/** A send as the send sheets build it (PTHome, the client page, the group
 *  page): one row per recipient, one time between them. */
async function sendNow(kind: Kind, onlyCara: boolean, program: SavedProgram): Promise<void> {
  const n = sendsMade++;
  await TARA.app.appendSharedPrograms(recipientsOf(kind, onlyCara).map((r, i) => ({
    id: `share_${n}_${i}`,
    clientId: r.uid,
    programId: program.id,
    programName: program.name,
    sentAtISO: sentAt(n),
    programSnapshot: program,
    ...(kind === "group" ? { groupId: GROUP } : {}),
  })));
}

function newSend(kind: Kind, onlyCara: boolean, weeks: number): Send {
  const r: Record<string, Rec> = {};
  for (const p of recipientsOf(kind, onlyCara)) r[p.name] = { row: true, accepted: false, linked: false, deletedCopy: false, removedAt: null };
  return { archived: false, version: 0, weeks, r };
}

const programActions: Action<Model>[] = [
  {
    label: "Tara archives Block (My Programs)",
    screen: "Tara:programs",
    kinds: ["direct", "group"],
    enabled: m => !m.block.archived,
    draw: simple(TARA, async () => setJSON(PROGRAMS_KEY, archiveProgram(await taraPrograms(), BLOCK.id))),
    apply: m => { m.block.archived = true; return OK; },
  },
  {
    label: "Tara restores Block (My Programs archive)",
    screen: "Tara:programs",
    kinds: ["direct", "group"],
    enabled: m => m.block.archived,
    draw: simple(TARA, async () => setJSON(PROGRAMS_KEY, restoreProgram(await taraPrograms(), BLOCK.id))),
    apply: m => { m.block.archived = false; return OK; },
  },
  {
    // The builder's save of her own program: sends already out don't change.
    label: "Tara edits Block (builder)",
    screen: "Tara:programs",
    kinds: ["direct", "group"],
    enabled: m => !m.block.archived,
    draw: simple(TARA, async () => setJSON(PROGRAMS_KEY,
      (await taraPrograms()).map(p => (p.id === BLOCK.id ? { ...p, totalWeeks: p.totalWeeks + 10 } : p)))),
    apply: m => { m.block.weeks += 10; return OK; },
  },
];

function sendActions(kind: Kind): Action<Model>[] {
  const ways: [string, boolean][] = kind === "group"
    ? [["Tara sends it to the group", false]]
    : [["Tara sends it to Cara and Cody (Trainer tab)", false], ["Tara sends it to Cara (her client page)", true]];
  return ways.map(([label, onlyCara]): Action<Model> => ({
    label,
    screen: "Tara:send",
    kinds: [kind],
    // Only what the picker lists can be picked.
    enabled: m => !m.block.archived && m.sends.length < MAX_SENDS,
    draw: async () => {
      const picked = await on(TARA, async () => unarchivedPrograms(await taraPrograms()).find(p => p.id === BLOCK.id));
      return () => on(TARA, async () => { if (picked) await sendNow(kind, onlyCara, picked); return OK; });
    },
    // It sends the program as the picker drew it.
    apply: (m, drawn) => { m.sends.push(newSend(kind, onlyCara, drawn.block.weeks)); return OK; },
  }));
}

function perSendActions(n: number): Action<Model>[] {
  const s = (m: Model): Send | undefined => m.sends[n];
  const send = nameOf(n);
  const archiveTo = (archived: boolean) => (m: Model): Outcome => {
    const x = s(m);
    if (x && live(x)) x.archived = archived;
    return OK;
  };
  const deleteAll = (m: Model): Outcome => {
    for (const r of Object.values(s(m)?.r ?? {})) r.row = false;
    return OK;
  };
  const trainer: Action<Model>[] = [
    {
      label: `Tara archives ${send} (Trainer tab)`,
      kinds: ["direct", "group"],
      enabled: m => !!s(m) && live(s(m)!) && !s(m)!.archived,
      draw: simple(TARA, () => TARA.app.setSendBatchArchived(keyOf(n), true)),
      apply: archiveTo(true),
    },
    {
      label: `Tara restores ${send} (Trainer tab archive)`,
      kinds: ["direct", "group"],
      enabled: m => !!s(m) && live(s(m)!) && s(m)!.archived,
      draw: simple(TARA, () => TARA.app.setSendBatchArchived(keyOf(n), false)),
      apply: archiveTo(false),
    },
    {
      label: `Tara deletes ${send} (Trainer tab)`,
      kinds: ["direct", "group"],
      enabled: m => !!s(m) && live(s(m)!),
      draw: simple(TARA, () => TARA.app.removeSharedProgramBatch(keyOf(n))),
      apply: deleteAll,
    },
    {
      label: `Tara sends an update to ${send}`,
      kinds: ["direct", "group"],
      enabled: m => !!s(m) && live(s(m)!) && !s(m)!.archived,
      notTwiceAtOnce: true,
      // The shared-edit builder, opened on the send as it was drawn, adds a week.
      draw: async () => {
        const target = await on(TARA, async () => (await TARA.app.loadSharedPrograms()).find(x => ofBlock(x) && sendOf(x) === n));
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
        const x = s(m);
        if (!x || !live(x)) return OK;
        x.version += 1;
        x.weeks += 1;
        for (const r of Object.values(x.r)) if (r.row) r.accepted = false;
        return OK;
      },
    },
    ...CLIENTS.map((c): Action<Model> => ({
      label: `Tara takes ${send} back from ${c.name} (client page)`,
      kinds: ["direct"],
      enabled: m => { const r = s(m)?.r[c.name]; return !!r && r.row && !s(m)!.archived && !r.deletedCopy; },
      draw: async () => {
        const row = await rowOf(c, n);
        return () => on(TARA, async () => { if (row) await TARA.app.removeSharedProgram(row.id); return OK; });
      },
      apply: m => { const r = s(m)?.r[c.name]; if (r) r.row = false; return OK; },
    })),
    {
      label: `Cole archives ${send} (group page)`,
      kinds: ["group"],
      enabled: m => !!s(m) && live(s(m)!) && !s(m)!.archived,
      draw: simple(COLE, () => COLE.app.setSendBatchArchived(keyOf(n), true, GROUP)),
      apply: archiveTo(true),
    },
    {
      label: `Cole restores ${send} (group archive)`,
      kinds: ["group"],
      enabled: m => !!s(m) && live(s(m)!) && s(m)!.archived,
      draw: simple(COLE, () => COLE.app.setSendBatchArchived(keyOf(n), false, GROUP)),
      apply: archiveTo(false),
    },
    {
      label: `Cole deletes ${send} (group page)`,
      kinds: ["group"],
      enabled: m => !!s(m) && live(s(m)!),
      draw: simple(COLE, () => COLE.app.removeGroupSharedProgramBatch(GROUP, keyOf(n))),
      apply: deleteAll,
    },
  ];

  const client = CLIENTS.flatMap((c): Action<Model>[] => {
    const accept = (m: Model): Outcome => {
      const x = s(m);
      const r = x?.r[c.name];
      if (!x || !r || !r.row || x.archived) return "refused";
      r.accepted = true;
      r.deletedCopy = false;
      r.linked = true;
      // One copy: made by the first accept, updated (and back from the
      // archive) by every one after.
      m.copies[c.name] = { state: "present", weeks: x.weeks };
      return OK;
    };
    const acceptable = (m: Model) => !!s(m) && cardShows(s(m)!, c.name) && !s(m)!.r[c.name].accepted;
    return [
      {
        label: `${c.name} accepts ${send}`,
        kinds: ["direct", "group"],
        enabled: acceptable,
        draw: async () => () => on(c, () => pressed(() => c.app.acceptSharedProgramBatch(keyOf(n)))),
        apply: accept,
      },
      {
        label: `${c.name} accepts ${send} on its page`,
        kinds: ["direct", "group"],
        enabled: acceptable,
        draw: async () => {
          const row = await rowOf(c, n);
          return () => on(c, () => pressed(() => c.app.acceptSharedProgram(row!.id)));
        },
        apply: accept,
      },
      {
        label: `${c.name} removes ${send}'s card`,
        kinds: ["direct", "group"],
        enabled: m => !!s(m) && cardShows(s(m)!, c.name),
        draw: async () => {
          const card = await on(c, async () => (await c.app.loadSharedPrograms()).find(x => ofBlock(x) && sendOf(x) === n && x.clientId === c.uid));
          return () => on(c, async () => { if (card) await c.app.dismissSharedBatch(c.app.dismissKeyOf(card)); return OK; });
        },
        // It hides the version the card showed; a newer one still comes back.
        apply: (m, drawn) => { const r = s(m)?.r[c.name]; if (r) r.removedAt = drawn.sends[n]?.version ?? 0; return OK; },
      },
    ];
  });

  return [...trainer, ...client];
}

/** A client's actions on their one copy, in My Programs. */
function copyActions(c: Person): Action<Model>[] {
  const findCopy = async () => {
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    return { programs, copy: programs.find(p => p.name === BLOCK.name) };
  };
  return [
    {
      label: `${c.name} deletes their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => m.copies[c.name].state !== "none",
      draw: async () => () => on(c, async () => {
        // app/programs.tsx's Delete (the program archive's does the same).
        const { programs, copy } = await findCopy();
        if (!copy) return OK;
        await setJSON(PROGRAMS_KEY, programs.filter(p => p.id !== copy.id));
        await c.app.removeSharedProgramByLocalId(copy.id);
        return OK;
      }),
      apply: m => {
        if (m.copies[c.name].state === "none") return OK; // gone already (another screen)
        m.copies[c.name] = { state: "none", weeks: 0 };
        // Every send whose accept landed on it hears it was deleted.
        for (const x of m.sends) {
          const r = x.r[c.name];
          if (!r?.linked) continue;
          if (r.row) { r.deletedCopy = true; r.accepted = false; }
          r.linked = false;
        }
        return OK;
      },
    },
    {
      label: `${c.name} archives their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => m.copies[c.name].state === "present",
      draw: async () => () => on(c, async () => {
        const { programs, copy } = await findCopy();
        if (copy) await setJSON(PROGRAMS_KEY, archiveProgram(programs, copy.id));
        return OK;
      }),
      apply: m => { if (m.copies[c.name].state === "present") m.copies[c.name].state = "archived"; return OK; },
    },
    {
      label: `${c.name} restores their copy`,
      screen: `${c.name}:programs`,
      kinds: ["direct", "group"],
      enabled: m => m.copies[c.name].state === "archived",
      draw: async () => () => on(c, async () => {
        const { programs, copy } = await findCopy();
        if (copy) await setJSON(PROGRAMS_KEY, restoreProgram(programs, copy.id));
        return OK;
      }),
      apply: m => { if (m.copies[c.name].state === "archived") m.copies[c.name].state = "present"; return OK; },
    },
  ];
}

export function resendFlow(kind: Kind): Flow<Model> {
  const sendBoth = kind === "group" ? "Tara sends it to the group" : "Tara sends it to Cara and Cody (Trainer tab)";
  const sendCara = kind === "group" ? "Tara sends it to the group" : "Tara sends it to Cara (her client page)";
  return {
    name: `${kind} re-send`,
    kind,
    start: async () => {
      TARA.programs = [BLOCK];
      CARA.programs = [];
      CODY.programs = [];
      await resetWorld();
      sendsMade = 0;
      // Send 1 is already out: the Trainer tab to both, or the group.
      await on(TARA, () => sendNow(kind, false, BLOCK));
    },
    fresh: () => ({
      kind,
      block: { archived: false, weeks: BLOCK.totalWeeks },
      sends: [newSend(kind, false, BLOCK.totalWeeks)],
      copies: { Cara: { state: "none", weeks: 0 }, Cody: { state: "none", weeks: 0 } },
    }),
    expected,
    observe: () => observe(kind),
    actions: [
      ...programActions,
      ...sendActions(kind),
      ...Array.from({ length: MAX_SENDS }, (_, n) => perSendActions(n)).flat(),
      ...CLIENTS.flatMap(copyActions),
    ],
    stories: [
      // Archived in My Programs, restored, sent again, and both accepted onto
      // the one copy (the reported worry: can it still be sent?).
      ["Cara accepts send 1", "Tara archives Block (My Programs)", "Tara restores Block (My Programs archive)",
        "Tara edits Block (builder)", sendBoth, "Cara accepts send 2", "Cody accepts send 2", "Cody accepts send 1"],
      // The first send archived and restored, then sent again.
      ["Tara archives send 1 (Trainer tab)", "Tara restores send 1 (Trainer tab archive)", sendBoth,
        "Cara accepts send 1", "Cara accepts send 2 on its page", "Tara archives send 2 (Trainer tab)", "Tara restores send 2 (Trainer tab archive)"],
      // The first send deleted after it was accepted: the next lands on the same copy.
      ["Cara accepts send 1", "Tara deletes send 1 (Trainer tab)", "Tara edits Block (builder)", sendCara, "Cara accepts send 2"],
      // Her copy archived, then a new send brings it back, updated.
      ["Cara accepts send 1", "Cara archives their copy", "Tara edits Block (builder)", sendCara, "Cara accepts send 2"],
      // Her copy deleted between the two: the next accept makes one again,
      // and accepting the first send after that lands on it too.
      ["Cara accepts send 1", sendCara, "Cara deletes their copy", "Cara accepts send 2", "Cara accepts send 1 on its page"],
      // An update to the OLD send after the new one was accepted: the copy
      // takes whichever she accepted last.
      ["Cara accepts send 1", "Tara edits Block (builder)", sendCara, "Cara accepts send 2",
        "Tara sends an update to send 1", "Cara accepts send 1"],
      // A removed card doesn't hide the next send.
      ["Cara removes send 1's card", sendCara, "Cara accepts send 2"],
      ...(kind === "direct" ? [
        // Taken back from her, then sent to her alone.
        ["Cara accepts send 1", "Tara takes send 1 back from Cara (client page)", sendCara, "Cara accepts send 2", "Cara deletes their copy"],
      ] : [
        // Two trainers of the group taking turns across two sends.
        ["Cara accepts send 1", "Cole archives send 1 (group page)", sendBoth, "Cara accepts send 2",
          "Cole deletes send 2 (group page)", "Cole restores send 1 (group archive)", "Cody accepts send 1"],
      ]),
    ],
  };
}
