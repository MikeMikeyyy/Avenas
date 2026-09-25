// Archiving, the parts that aren't the database (scripts/verify-db.ts covers
// who may archive a send or a review):
//
//   * utils/programArchive.ts — one of MY programs. Archiving is a flag beside
//     status, never on the active program, and a restore puts it back exactly
//     as it was, which is the whole promise of "archive" over "delete".
//   * utils/removeShare.ts archiveShareChoice — what Remove on a send says when
//     it offers Archive, which has to stay true for one recipient, for
//     everyone, and for the partly-accepted case.
//
// Run:  npx tsx scripts/verify-archive.ts

import type { SavedProgram } from "../constants/programs";
import { archiveProgram, archivedPrograms, canArchive, restoreProgram, unarchivedPrograms } from "../utils/programArchive";
import { archiveShareChoice } from "../utils/removeShare";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

const program = (id: string, status: SavedProgram["status"], extra: Partial<SavedProgram> = {}): SavedProgram => ({
  id,
  name: id,
  totalWeeks: 8,
  currentWeek: 3,
  status,
  startDate: "01 Sep 2026",
  trainingDays: 3,
  cycleDays: 4,
  cyclePattern: ["Push", "Pull", "Legs", "Rest"],
  workouts: {},
  ...extra,
});

// ─── My programs ─────────────────────────────────────────────────────────────
const active = program("active", "active");
const done = program("done", "completed", { completedDate: "20 Oct 2026" });
const shelved = program("shelved", "paused");
const fresh = program("fresh", "created");
const all = [active, done, shelved, fresh];

eq(canArchive(active), false, "the active program can't be archived");
eq([done, shelved, fresh].map(canArchive), [true, true, true], "any other program can");
eq(archiveProgram(all, "active", "2026-09-26"), all, "archiving the active program changes nothing");

const archived = archiveProgram(all, "done", "2026-09-26");
eq(archived.find(p => p.id === "done")?.archivedAt, "2026-09-26", "archiving stamps the day");
eq(archived.find(p => p.id === "done")?.status, "completed", "...and leaves its status alone");
eq(archived.filter(p => p.id !== "done"), all.filter(p => p.id !== "done"), "...and every other program");
eq(unarchivedPrograms(archived).map(p => p.id), ["active", "shelved", "fresh"], "the lists leave it out");
eq(archivedPrograms(archived).map(p => p.id), ["done"], "the archive has it");

const restored = restoreProgram(archived, "done");
eq(restored, all, "restoring puts it back exactly as it was, with no archivedAt key left behind");

const three = archiveProgram(archiveProgram(archiveProgram(all, "fresh", "2026-09-01"), "shelved", "2026-09-20"), "done", "2026-09-20");
eq(archivedPrograms(three).map(p => p.id), ["done", "shelved", "fresh"], "the archive lists the newest first, then by name");

// ─── What Remove on a send says ──────────────────────────────────────────────
const choice = (total: number, accepted: number) =>
  archiveShareChoice({ programName: "Block", recipients: "this group", total, accepted });

eq(choice(5, 5).title, "Remove Program", "everyone accepted: an ordinary prompt");
eq(choice(5, 5).body.includes("They've all accepted it, so their copies stay in their libraries either way."), true,
  "...that says their copies are safe whichever they pick");
eq(choice(1, 1).body.includes("their copy stays in their library either way"), true, "...in the singular for one person");
eq(choice(1, 0).title, "They haven't accepted yet", "one person who hasn't accepted: the warning title");
eq(choice(1, 0).body.endsWith("They haven't accepted it yet."), true, "...and says so");
eq(choice(5, 0).body.endsWith("Nobody has accepted it yet."), true, "nobody of several has accepted");
eq(choice(5, 2).body.endsWith("3 of 5 haven't accepted it yet. The 2 who did keep their copies either way."), true,
  "partly accepted: who hasn't, and that those who did keep theirs");
eq(choice(5, 4).body.includes("1 of 5 hasn't accepted it yet. The 4 who did"), true, "...with the verb agreeing");
eq(choice(3, 3).body.startsWith(`Archive "Block" to take it off your list and hide it from this group until you restore it, or delete it for good.`), true,
  "it names both choices, and who Archive hides it from");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ archive helpers hold");
