// Programs sent between trainers, and to a group from the Trainer tab's Send a
// Program, played out on simulated phones against every migration (the verify
// harness, scripts/harness/), with what each person's lists show after each
// step (user report, 2026-10-29: a program one trainer sent another, or sent
// to a group from the Trainer tab, never showed up for them).
//
//   1. Tara sends a program straight to Cole (both trainer accounts): it's in
//      his TO ACCEPT and new on his Programs card; he accepts it (ADDED, and a
//      copy in My Programs), then removes it from his list (the copy stays).
//   2. Cole sends one to Tara: in her TO ACCEPT the same way, never her SENT.
//   3. Tara picks the group in Send a Program: everyone in it gets a row tagged
//      with it, Cole (a trainer, not her client) included. It's on the group's
//      page, Cara's Programs page and Cole's TO ACCEPT, and one send on Tara's
//      SENT.
//   4. The group, and Cara picked one by one as well: Cara gets it once,
//      straight to her (her own Programs page, not the group's), and the rest
//      of the group through it. And as reported: Cole, who's in Tara's group,
//      picks only Tara, and then Tara and the group: hers comes straight to her
//      both times, never through the group.
//   5. Cole passes Tara's program on to the group, from ADDED (he coaches it).
//   6. Every client: a row each in the database, nothing left on Tara's phone.
//
// The rows are built as the Programs page builds them (utils/trainerLists.ts
// shareEntriesFor) and sent through each phone's own copy of the app.
//
// Run:  npx tsx scripts/verify-trainer-sends.ts

import { on, warnings } from "./harness/app";
import { CARA, CODY, COLE, GROUP, TARA, closeWorld, db, resetWorld, setupWorld, type Person } from "./harness/world";
import { batchKeyOf, programsSummary, sendBatches, shareEntriesFor, trainerReceivedLists, type RecipientChoice } from "../utils/trainerLists";
import { getJSON } from "../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import { SHARED_PROGRAMS_KEY, type SharedProgram } from "../utils/trainerStore";

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

const program = (id: string, name: string): SavedProgram => ({
  id, name, totalWeeks: 4, currentWeek: 0, status: "created", startDate: "",
  trainingDays: 2, cycleDays: 3, cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["d0", "d1", "d2"], workouts: {},
});
const BLOCK = program("program_block", "Block");
const COLES = program("program_cole", "Cole's Block");

/** Every row in the database, as "Sender→Recipient (group): Program". */
async function rows(): Promise<string[]> {
  const res = await db.query<{ sender: string; recipient: string; group_id: string | null; program_name: string }>(`
    select s.name as sender, r.name as recipient, sp.group_id, sp.program_name
      from public.shared_programs sp
      join public.profiles s on s.id = sp.sender_id
      join public.profiles r on r.id = sp.recipient_id
     order by s.name, r.name, sp.program_name`);
  return res.rows.map(r => `${r.sender}→${r.recipient}${r.group_id ? " (group)" : ""}: ${r.program_name}`);
}

/** Send as the Programs page does: the rows for the choice, from the sender's phone. */
async function send(from: Person, p: SavedProgram, choice: RecipientChoice, clientIds: string[], groupMembers: Record<string, string[]> = {}) {
  await on(from, () => from.app.appendSharedPrograms(
    shareEntriesFor(p, choice, { clientIds, groupMembers, myUid: from.uid }, Date.now()),
  ));
}

/** A trainer's Programs page: TO ACCEPT and ADDED, and the card's "new". */
async function inbox(p: Person) {
  return on(p, async () => {
    const shares = await p.app.loadSharedPrograms();
    const lists = trainerReceivedLists(shares);
    return {
      toAccept: lists.waiting.map(s => s.programName),
      added: lists.added.map(s => s.programName),
      newOnCard: programsSummary([], [], shares).newPrograms,
    };
  });
}

/** A trainer's SENT: one per send, where it went and how many have it. */
async function sent(p: Person) {
  return on(p, async () => sendBatches(await p.app.loadSharedPrograms())
    .map(b => ({ program: b.programName, group: !!b.groupId, total: b.total, accepted: b.acceptedCount })));
}

/** What a gym user's Programs page and the group's page list, by name. */
async function gymViews(p: Person) {
  return on(p, async () => ({
    programsPage: p.app.receivedFromTrainers(await p.app.loadSharedPrograms(), p.uid).map(s => s.programName),
    groupPage: (await p.app.loadGroupSharedPrograms(GROUP)).filter(s => s.senderId !== p.uid).map(s => s.programName),
  }));
}

/** A trainer's TO ACCEPT, each with the group it came through (null: straight to them). */
async function receivedThrough(p: Person) {
  return on(p, async () => trainerReceivedLists(await p.app.loadSharedPrograms()).waiting
    .map(s => [s.programName, s.groupId ?? null]));
}

/** What the group's page lists of what's been sent into it, as `p` sees it. */
async function groupPageOf(p: Person) {
  return on(p, async () => (await p.app.loadGroupSharedPrograms(GROUP)).map(s => s.programName));
}

/** The first program in this trainer's TO ACCEPT or ADDED. */
async function firstReceived(p: Person, list: "waiting" | "added"): Promise<SharedProgram> {
  return on(p, async () => trainerReceivedLists(await p.app.loadSharedPrograms())[list][0]);
}

const myPrograms = (p: Person) => on(p, async () => (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).map(x => x.name));

/** Everyone in the group but `p`, as the hub's memberships hold it. */
const groupBut = (p: Person) => ({ [GROUP]: [TARA, COLE, CARA, CODY].filter(x => x !== p).map(x => x.uid) });

async function main() {
  await setupWorld();
  TARA.programs = [BLOCK];
  COLE.programs = [COLES];
  const taraClients = [COLE.uid, CARA.uid, CODY.uid];

  // ── 1. Tara → Cole, straight ──
  await resetWorld();
  await send(TARA, BLOCK, { all: false, groupIds: [], clientIds: [COLE.uid] }, taraClients);
  eq(await rows(), ["Tara→Cole: Block"], "1: Tara's program to Cole is in the database");
  eq(await inbox(COLE), { toAccept: ["Block"], added: [], newOnCard: 1 }, "1: it's in Cole's TO ACCEPT, new on his Programs card");
  eq(await sent(TARA), [{ program: "Block", group: false, total: 1, accepted: 0 }], "1: one send on Tara's SENT");
  await on(COLE, async () => COLE.app.acceptSharedProgramBatch(batchKeyOf(await firstReceived(COLE, "waiting"))));
  eq(await inbox(COLE), { toAccept: [], added: ["Block"], newOnCard: 0 }, "1: accepted, it's under ADDED and new no longer");
  eq(await myPrograms(COLE), ["Cole's Block", "Block"], "1: and a copy of it is in Cole's programs");
  eq(await sent(TARA), [{ program: "Block", group: false, total: 1, accepted: 1 }], "1: Tara sees him take it");
  await on(COLE, async () => COLE.app.dismissSharedBatch(COLE.app.dismissKeyOf(await firstReceived(COLE, "added"))));
  eq(await inbox(COLE), { toAccept: [], added: [], newOnCard: 0 }, "1: removed from his list");
  eq(await myPrograms(COLE), ["Cole's Block", "Block"], "1: his copy stays");

  // ── 2. Cole → Tara, straight ──
  await resetWorld();
  await send(COLE, COLES, { all: false, groupIds: [], clientIds: [TARA.uid] }, [TARA.uid]);
  eq(await inbox(TARA), { toAccept: ["Cole's Block"], added: [], newOnCard: 1 }, "2: Cole's program is in Tara's TO ACCEPT");
  eq(await sent(TARA), [], "2: and not on her SENT");
  eq(await sent(COLE), [{ program: "Cole's Block", group: false, total: 1, accepted: 0 }], "2: it's on Cole's SENT");

  // ── 3. Tara picks the group in Send a Program ──
  await resetWorld();
  await send(TARA, BLOCK, { all: false, groupIds: [GROUP], clientIds: [] }, taraClients, groupBut(TARA));
  eq(await rows(), ["Tara→Cara (group): Block", "Tara→Cody (group): Block", "Tara→Cole (group): Block"],
    "3: everyone in the group gets a row tagged with it");
  eq(await inbox(COLE), { toAccept: ["Block"], added: [], newOnCard: 1 }, "3: Cole, a trainer in it, has it in TO ACCEPT");
  eq(await gymViews(CARA), { programsPage: ["Block"], groupPage: ["Block"] }, "3: Cara has it on her Programs page and the group's page");
  eq(await sent(TARA), [{ program: "Block", group: true, total: 3, accepted: 0 }], "3: one send to the group on Tara's SENT");

  // ── 4. The group, and Cara one by one too ──
  await resetWorld();
  await send(TARA, BLOCK, { all: false, groupIds: [GROUP], clientIds: [CARA.uid] }, taraClients, groupBut(TARA));
  eq(await rows(), ["Tara→Cara: Block", "Tara→Cody (group): Block", "Tara→Cole (group): Block"],
    "4: Cara, picked one by one, gets it once and straight to her; the rest of the group through it");
  eq(await gymViews(CARA), { programsPage: ["Block"], groupPage: [] }, "4: on Cara's own Programs page, not the group's");

  // ── 4b. As reported: Cole, in Tara's group, picks only Tara ──
  await resetWorld();
  await send(COLE, COLES, { all: false, groupIds: [], clientIds: [TARA.uid] }, [TARA.uid], groupBut(COLE));
  eq(await rows(), ["Cole→Tara: Cole's Block"], "4b: Tara alone, straight to her, though they share a group");
  eq(await receivedThrough(TARA), [["Cole's Block", null]], "4b: in Tara's TO ACCEPT as from Cole, through no group");
  eq(await groupPageOf(TARA), [], "4b: and nothing on the group's page");

  // ── 4c. Cole picks Tara and the group they share ──
  await resetWorld();
  await send(COLE, COLES, { all: false, groupIds: [GROUP], clientIds: [TARA.uid] }, [TARA.uid], groupBut(COLE));
  eq(await rows(), ["Cole→Cara (group): Cole's Block", "Cole→Cody (group): Cole's Block", "Cole→Tara: Cole's Block"],
    "4c: Tara, picked one by one, gets it straight; the rest of the group through it");
  eq(await receivedThrough(TARA), [["Cole's Block", null]], "4c: Tara's is from Cole, not from the group");

  // ── 5. Cole passes Tara's program on to the group ──
  await resetWorld();
  await send(TARA, BLOCK, { all: false, groupIds: [], clientIds: [COLE.uid] }, taraClients);
  await on(COLE, async () => COLE.app.acceptSharedProgramBatch(batchKeyOf(await firstReceived(COLE, "waiting"))));
  const copy = await on(COLE, async () => (await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])).find(p => p.name === "Block"));
  if (!copy) throw new Error("5: Cole has no copy to pass on");
  await send(COLE, copy, { all: false, groupIds: [GROUP], clientIds: [] }, [TARA.uid], groupBut(COLE));
  eq(await rows(), ["Cole→Cara (group): Block", "Cole→Cody (group): Block", "Cole→Tara (group): Block", "Tara→Cole: Block"],
    "5: Cole's copy goes to everyone in the group but him");
  eq(await gymViews(CODY), { programsPage: ["Block"], groupPage: ["Block"] }, "5: Cody has it from Cole");

  // ── 6. Every client ──
  await resetWorld();
  await send(TARA, BLOCK, { all: true, groupIds: [], clientIds: [] }, [CARA.uid, CODY.uid]);
  eq(await rows(), ["Tara→Cara: Block", "Tara→Cody: Block"], "6: every client gets a row in the database");
  eq(await on(TARA, async () => getJSON<unknown[]>(SHARED_PROGRAMS_KEY, [])), [], "6: nothing is left on Tara's phone alone");

  eq(warnings, [], "no phone logged a swallowed error");
  await closeWorld();
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
