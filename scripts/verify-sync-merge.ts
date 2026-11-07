// scripts/verify-sync-merge.ts
//
// Two phones on one account, merged (utils/syncMerge.ts; user decision,
// 2026-11-07): what each phone added is kept, a delete on either is gone on
// both, an edit on one reaches the other, the later of two edits to one thing
// wins (a program part by part), a copy held under another id is one item and
// not two, nothing is ever dropped for being missing, and writing a merge on
// the phone leaves alone what changed meanwhile.
//
// Run: npx tsx scripts/verify-sync-merge.ts

import {
  PROGRAM_PARTS, applyChanges, baseOf, baseOfInSlices, datesAfter, droppedWithoutDelete, hashText, idOfKey, itemId, mergeSnapshots,
  mergeTombstones, naturalKey, programColumns, sameBase, sameSnapshot, undoStaleAutoPause,
  type MergeInput, type SyncSnapshot, type Tombstone,
} from "../utils/syncMerge";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${what}\n    expected ${b}\n    actual   ${a}`);
}
// ─── Fixtures ────────────────────────────────────────────────────────────────

const program = (id: string, over: Partial<SavedProgram> = {}): SavedProgram => ({
  id, name: `Program ${id}`, totalWeeks: 6, currentWeek: 1, status: "active", startDate: "01 Nov 2026",
  trainingDays: 2, cycleDays: 3, cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["d0", "d1", "d2"],
  workouts: { "0:Upper": [{ id: "e1", name: "Bench Press", sets: [{ type: "working", reps: "5" }] }] },
  ...over,
});
const workout = (id: string, date: string, over: Partial<CompletedWorkout> = {}): CompletedWorkout => ({
  id, date, completedAt: `${date}T08:00:00.000Z`, workoutName: "Upper", durationSeconds: 1800,
  exercises: [{ name: "Bench Press", notes: "", sets: [{ type: "working", weight: "80", reps: "5", done: true }] }],
  programId: "P", dayId: "d0",
  ...over,
});
const entry = (id: string, createdAt: string, over: Partial<JournalEntry> = {}): JournalEntry =>
  ({ id, title: id, body: "", createdAt, ...over });
const custom = (name: string, over: Partial<CustomExercise> = {}): CustomExercise => ({ name, muscles: ["Back"], ...over });

const snap = (s: Partial<SyncSnapshot> = {}): SyncSnapshot => ({ programs: [], workouts: [], journal: [], custom: [], ...s });

const BASE = snap({
  programs: [program("P")],
  workouts: [workout("w1", "2026-11-01"), workout("w2", "2026-11-02")],
  journal: [entry("j1", "2026-11-01T07:00:00.000Z")],
  custom: [custom("Band Pull-Apart", { id: "cx1" })],
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Merge `local` and `remote` against BASE (or `base`), the remote's change
 *  later unless said otherwise. */
function merge(local: SyncSnapshot, remote: SyncSnapshot, o: Partial<MergeInput> = {}) {
  return mergeSnapshots({
    local, remote, base: o.base === undefined ? baseOf(BASE) : o.base,
    localDeleted: o.localDeleted ?? [], remoteDeleted: o.remoteDeleted ?? [],
    localChangedAt: o.localChangedAt ?? 1000, remoteChangedAt: o.remoteChangedAt ?? 2000,
    remoteFromOlderApp: o.remoteFromOlderApp,
    now: Date.parse("2026-11-07T12:00:00.000Z"),
  });
}
const ids = (items: { id?: string; name?: string }[]) => items.map(i => i.id ?? i.name);
const sortedIds = (items: { id?: string; name?: string }[]) => ids(items).sort();
const tomb = (k: Tombstone["k"], id: string, at = "2026-11-07T10:00:00.000Z", key?: string): Tombstone =>
  key ? { k, id, key, at } : { k, id, at };

// ─── 1. Every part of a program is merged ────────────────────────────────────

{
  const full: Required<SavedProgram> = {
    id: "p", name: "n", totalWeeks: 1, currentWeek: 1, status: "active", startDate: "01 Nov 2026", completedDate: "02 Nov 2026",
    cycleOffset: 1, pausedAt: "2026-11-02", holds: [{ from: "2026-11-01", to: "2026-11-02", shift: 1, offsetShift: 0 }],
    archivedAt: "2026-11-03", shareOrigin: "a|b", runs: [], trainingDays: 1, cycleDays: 1, cyclePattern: ["A"], dayIds: ["d0"],
    skippedDates: ["2026-11-01"], pushedDates: ["2026-11-01"], pulledDates: ["2026-11-02"], workouts: {}, extraWorkouts: ["X"],
  };
  const fields = Object.values(PROGRAM_PARTS).flatMap(p => p.fields).sort();
  eq(fields, Object.keys(full).filter(k => k !== "id").sort(), "parts: every program field is in exactly one part (a new field must be given one)");
  const columns = Object.values(PROGRAM_PARTS).flatMap(p => p.columns).sort();
  eq(columns, programColumns(full).sort(), "parts: and every column of its backup row");
  eq(new Set(columns).size, columns.length, "parts: none in two");
}

// ─── 2. What a trip through the database can't tell apart hashes the same ────

{
  const w = workout("w", "2026-11-01");
  const back = { ...clone(w), completedAt: "2026-11-01T08:00:00+00:00" };
  eq(sameSnapshot(snap({ workouts: [w] }), snap({ workouts: [back] })), true, "hash: a timestamp as the database writes it is the same moment");
  const reordered = Object.fromEntries(Object.entries(w).reverse()) as CompletedWorkout;
  eq(sameSnapshot(snap({ workouts: [w] }), snap({ workouts: [reordered] })), true, "hash: key order means nothing");
  const p = program("P");
  eq(sameSnapshot(snap({ programs: [p] }), snap({ programs: [{ ...p, extraWorkouts: [], skippedDates: [] }] })), true,
    "hash: an empty list and none are the same");
  eq(sameSnapshot(snap({ custom: [custom("X")] }), snap({ custom: [custom("X", { muted: false })] })), true, "hash: false and none are the same");
  eq(sameSnapshot(snap({ workouts: [w] }), snap({ workouts: [{ ...w, sessionNotes: "felt good" }] })), false, "hash: a real change isn't");
  eq(sameSnapshot(snap({ programs: [p] }), snap({ programs: [{ ...p, currentWeek: 2 }] })), false, "hash: nor a number moved on");
  eq(hashText("a") !== hashText("b"), true, "hash: two texts, two hashes");
  // A session's program counts only when the copy holds it: the backup can't
  // point at a program it doesn't have, and gives the session back free.
  const orphan = { ...w, programId: "gone" };
  eq(sameSnapshot(snap({ workouts: [orphan] }), snap({ workouts: [{ ...orphan, programId: "" }] })), true,
    "hash: a session of a program the copy doesn't hold reads as the free session it comes back as");
}

// ─── 3. Added on either phone: kept ──────────────────────────────────────────

{
  const local = clone(BASE);
  local.workouts.unshift(workout("wA", "2026-11-05"));
  local.journal.unshift(entry("jA", "2026-11-05T07:00:00.000Z"));
  const remote = clone(BASE);
  remote.workouts.unshift(workout("wB", "2026-11-06"));
  remote.programs.push(program("Q", { status: "created" }));
  remote.custom.push(custom("Face Pull", { id: "cx2" }));
  const r = merge(local, remote);
  eq(sortedIds(r.merged.workouts), ["w1", "w2", "wA", "wB"], "added: a session from each phone, both kept");
  eq(ids(r.merged.programs), ["P", "Q"], "added: the other phone's program, after this phone's");
  eq(ids(r.merged.journal), ["jA", "j1"], "added: this phone's entry kept");
  eq(ids(r.merged.custom), ["cx1", "cx2"], "added: the other phone's exercise");
  eq(r.merged.workouts[0].id, "wB", "added: the other phone's session goes in newest first, as the phone keeps them");
  eq([r.changes.workouts.put.has("wB"), r.changes.workouts.was.has("wB")], [true, false], "added: written on the phone as an addition");
  eq(r.conflicts, 0, "added: nothing both changed");
}

// ─── 4. Deleted on either phone: gone ────────────────────────────────────────

{
  const local = clone(BASE);
  local.workouts = local.workouts.filter(w => w.id !== "w1");
  const r = merge(local, clone(BASE), { localDeleted: [tomb("workouts", "w1")] });
  eq(sortedIds(r.merged.workouts), ["w2"], "deleted here: stays deleted though the backup still has it");
  eq(r.changedHere, false, "deleted here: nothing to write on the phone");
  eq(r.deleted.map(t => t.id), ["w1"], "deleted here: the deletion goes up with the backup");

  const remote = clone(BASE);
  remote.programs = [];
  const r2 = merge(clone(BASE), remote, { remoteDeleted: [tomb("programs", "P")] });
  eq(r2.merged.programs.length, 0, "deleted there: the program goes from this phone too");
  eq([...r2.changes.programs.drop], ["P"], "deleted there: dropped on the phone");

  // An edit made since doesn't bring it back: deleting is the last word.
  const edited = clone(BASE);
  edited.workouts[0].sessionNotes = "edited here";
  const r3 = merge(edited, clone(BASE), { remoteDeleted: [tomb("workouts", "w1")] });
  eq(sortedIds(r3.merged.workouts), ["w2"], "deleted there, edited here: deleted");
  const remoteEdited = clone(BASE);
  remoteEdited.workouts[0].sessionNotes = "edited there";
  const local3 = clone(BASE);
  local3.workouts.shift();
  const r4 = merge(local3, remoteEdited, { localDeleted: [tomb("workouts", "w1")] });
  eq(sortedIds(r4.merged.workouts), ["w2"], "deleted here, edited there: deleted");

  // A screen writing back an old list re-adds what was deleted: the deletion
  // this phone itself knows of still wins.
  const r5 = merge(clone(BASE), snap({ ...clone(BASE), programs: [] }), { localDeleted: [tomb("programs", "P")], remoteDeleted: [tomb("programs", "P")] });
  eq(r5.merged.programs.length, 0, "deleted, then written back by an old list: still deleted");
}

// ─── 5. Missing without a delete: kept, whichever side lost it ───────────────

{
  const local = clone(BASE);
  local.programs = []; // a screen wrote back a list read before the merge
  const r = merge(local, clone(BASE));
  eq(ids(r.merged.programs), ["P"], "dropped here with no delete: the backup's copy comes back");
  eq([...r.changes.programs.put.keys()], ["P"], "dropped here: written back on the phone");
  eq(droppedWithoutDelete(local, baseOf(BASE), []), 1, "dropped here: counted, so the next backup merges first");
  eq(droppedWithoutDelete(local, baseOf(BASE), [tomb("programs", "P")]), 0, "...but not one a delete explains");

  const remote = clone(BASE);
  remote.workouts = []; // an older app's backup without them
  const r2 = merge(clone(BASE), remote);
  eq(sortedIds(r2.merged.workouts), ["w1", "w2"], "missing from the backup with no delete: this phone's kept");
}

// ─── 6. Changed on one phone: that phone's version ───────────────────────────

{
  const remote = clone(BASE);
  remote.workouts[1].sessionNotes = "from the other phone";
  remote.journal[0].body = "rewritten there";
  const r = merge(clone(BASE), remote, { localChangedAt: 9999 });
  eq(r.merged.workouts.find(w => w.id === "w2")?.sessionNotes, "from the other phone", "edited there: the edit comes here, however recent this phone's last change");
  eq(r.merged.journal[0].body, "rewritten there", "edited there: an entry too");
  eq(r.conflicts, 0, "edited there: no conflict");

  const local = clone(BASE);
  local.workouts[1].sessionNotes = "from this phone";
  const r2 = merge(local, clone(BASE), { remoteChangedAt: 9999 });
  eq(r2.merged.workouts.find(w => w.id === "w2")?.sessionNotes, "from this phone", "edited here: this phone's stays, however recent the other's");
  eq(r2.changedHere, false, "edited here: nothing to write on the phone");
}

// ─── 7. Changed on both: the later change ────────────────────────────────────

{
  const local = clone(BASE);
  local.workouts[0].sessionNotes = "here";
  const remote = clone(BASE);
  remote.workouts[0].sessionNotes = "there";
  eq(merge(local, remote, { localChangedAt: 1000, remoteChangedAt: 2000 }).merged.workouts.find(w => w.id === "w1")?.sessionNotes, "there",
    "both edited: the other phone's, changed later");
  eq(merge(local, remote, { localChangedAt: 3000, remoteChangedAt: 2000 }).merged.workouts.find(w => w.id === "w1")?.sessionNotes, "here",
    "both edited: this phone's, changed later");
  eq(merge(local, remote, { localChangedAt: 2000, remoteChangedAt: 2000 }).merged.workouts.find(w => w.id === "w1")?.sessionNotes, "here",
    "both edited at once: this phone's");
  eq(merge(local, remote).conflicts, 1, "both edited: counted");
}

// ─── 7b. A backup from an older app ──────────────────────────────────────────

{
  // An app from before 0057 never takes this phone's changes in: what it holds
  // differently is its old copy, not an edit.
  const local = clone(BASE);
  local.programs[0].name = "Renamed here";
  local.programs[0].status = "completed";
  const old = clone(BASE);
  old.workouts[1].sessionNotes = "its old notes";
  old.workouts.unshift(workout("wOld", "2026-11-06"));
  const r = merge(local, old, { remoteFromOlderApp: true, localChangedAt: 0, remoteChangedAt: 99999 });
  eq([r.merged.programs[0].name, r.merged.programs[0].status], ["Renamed here", "completed"], "older app: its old program doesn't undo this phone's");
  eq(r.merged.workouts.find(w => w.id === "w2")?.sessionNotes, undefined, "older app: nor its old version of a session");
  eq(sortedIds(r.merged.workouts), ["w1", "w2", "wOld"], "older app: what it adds comes in");
}

// ─── 8. A program, part by part ──────────────────────────────────────────────

{
  const local = clone(BASE);
  local.programs[0].workouts = { "0:Upper": [{ id: "e1", name: "Incline Bench Press", sets: [{ type: "working", reps: "8" }] }] };
  const remote = clone(BASE);
  remote.programs[0].pausedAt = "2026-11-06";
  remote.programs[0].currentWeek = 2;
  const r = merge(local, remote);
  const p = r.merged.programs[0];
  eq([p.workouts["0:Upper"][0].name, p.pausedAt, p.currentWeek], ["Incline Bench Press", "2026-11-06", 2],
    "program: an exercise changed here and a pause there both stay");
  eq(r.conflicts, 0, "program: two parts, no conflict");

  const renamedHere = clone(BASE);
  renamedHere.programs[0].name = "Mine";
  const renamedThere = clone(BASE);
  renamedThere.programs[0].name = "Theirs";
  renamedThere.programs[0].archivedAt = "2026-11-06";
  const r2 = merge(renamedHere, renamedThere, { localChangedAt: 5000, remoteChangedAt: 2000 });
  eq([r2.merged.programs[0].name, r2.merged.programs[0].archivedAt], ["Mine", "2026-11-06"],
    "program: one part both changed goes to the later change, another the other phone changed alone comes in");
  eq(r2.conflicts, 1, "program: one part in conflict");

  // A part's fields move together: a plan is never half one version.
  const planHere = clone(BASE);
  planHere.programs[0].cyclePattern = ["Push", "Pull", "Rest"];
  planHere.programs[0].workouts = { "0:Push": [] };
  const planThere = clone(BASE);
  planThere.programs[0].cyclePattern = ["Full", "Rest", "Rest"];
  planThere.programs[0].workouts = { "0:Full": [] };
  const r3 = merge(planHere, planThere, { localChangedAt: 1000, remoteChangedAt: 2000 });
  eq([r3.merged.programs[0].cyclePattern[0], Object.keys(r3.merged.programs[0].workouts)], ["Full", ["0:Full"]],
    "program: both changed the plan: the later plan whole");

  // A field the other phone cleared is cleared here too.
  const unpaused = clone(BASE);
  unpaused.programs[0].pausedAt = "2026-11-03";
  const resumedThere = clone(BASE);
  const r4 = merge(clone(unpaused), resumedThere, { base: baseOf(unpaused) });
  eq(r4.merged.programs[0].pausedAt, undefined, "program: a hold taken off on the other phone is off here");
}

// ─── 9. A phone's first merge: everything either holds ───────────────────────

{
  const local = clone(BASE);
  local.workouts[0].sessionNotes = "this phone's";
  local.workouts.unshift(workout("wA", "2026-11-05"));
  const remote = clone(BASE);
  remote.workouts[0].sessionNotes = "the backup's";
  remote.workouts.unshift(workout("wB", "2026-11-06"));
  const r = merge(local, remote, { base: null, localChangedAt: 0, remoteChangedAt: 99999 });
  eq(sortedIds(r.merged.workouts), ["w1", "w2", "wA", "wB"], "first merge: everything either holds");
  eq(r.merged.workouts.find(w => w.id === "w1")?.sessionNotes, "this phone's", "first merge: one held differently is this phone's");
  eq(sortedIds(merge(local, remote, { base: null, remoteDeleted: [tomb("workouts", "wA")] }).merged.workouts), ["w1", "w2", "wB"],
    "first merge: a deletion from the other phone still counts");
}

// ─── 10. One item under two ids is one item ──────────────────────────────────

{
  // The backup came from an older app, which minted new ids: matched by day,
  // finish and name, and kept under this phone's id.
  const remote = clone(BASE);
  remote.workouts = remote.workouts.map((w, i) => ({ ...w, id: `row-uuid-${i}` }));
  remote.journal = remote.journal.map(j => ({ ...j, id: "row-uuid-j" }));
  remote.custom = [custom("Band Pull-Apart", { id: "cx-other" })];
  const r = merge(clone(BASE), remote);
  eq(sortedIds(r.merged.workouts), ["w1", "w2"], "same session, another id: one session, under this phone's id");
  eq(ids(r.merged.journal), ["j1"], "same entry, another id: one entry");
  eq(ids(r.merged.custom), ["cx1"], "same live exercise, another id: one exercise (live names are unique)");
  eq(r.changedHere, false, "same items under other ids: nothing to write");

  // Changed there under its other id: the change comes in, the id stays.
  const remoteEdited = clone(remote);
  remoteEdited.workouts[0].sessionNotes = "edited on the other phone";
  const r2 = merge(clone(BASE), remoteEdited);
  const w1 = r2.merged.workouts.find(w => w.id === "w1");
  eq(w1?.sessionNotes, "edited on the other phone", "another id, edited there: the edit comes in");
  eq(r2.merged.workouts.length, 2, "another id, edited there: still one of it");

  // A session deleted here, held by the backup under another id: deleted.
  const local = clone(BASE);
  local.workouts = local.workouts.filter(w => w.id !== "w1");
  const deleted = tomb("workouts", "w1", undefined, naturalKey("workouts", BASE.workouts[0]));
  eq(sortedIds(merge(local, remote, { localDeleted: [deleted] }).merged.workouts), ["w2"],
    "another id, deleted here: matched to the deletion by what it is");

  // Two different sessions that happen to share nothing but a day: two.
  const sameDay = clone(BASE);
  sameDay.workouts.push(workout("w3", "2026-11-01", { completedAt: "2026-11-01T18:00:00.000Z" }));
  eq(merge(clone(BASE), sameDay).merged.workouts.length, 3, "two sessions on one day: both kept");
}

// ─── 11. Two items of one id: both kept ──────────────────────────────────────

{
  const twins = clone(BASE);
  twins.workouts.push({ ...workout("w1", "2026-11-03"), id: "w1" });
  const r = merge(twins, clone(BASE), { base: baseOf(twins) });
  eq(r.merged.workouts.filter(w => w.id === "w1").length, 2, "one id twice on the phone: neither lost");
  eq(idOfKey(`w1${"\u0001"}2`), "w1", "one id twice: the second's key names the id");
  eq(itemId("custom", custom("Cable Fly")), "name|cable fly", "an exercise from before ids is known by its name");
}

// ─── 12. Writing it on the phone ─────────────────────────────────────────────

{
  const remote = clone(BASE);
  remote.workouts[1].sessionNotes = "there";
  remote.workouts.unshift(workout("wB", "2026-11-06"));
  remote.programs = [];
  const r = merge(clone(BASE), remote, { remoteDeleted: [tomb("programs", "P")] });

  const now = clone(BASE);
  eq(sortedIds(applyChanges("workouts", now.workouts, r.changes.workouts)), ["w1", "w2", "wB"], "write: adds what came in");
  eq(applyChanges("workouts", now.workouts, r.changes.workouts)[0].id, "wB", "write: a session added first");
  eq(applyChanges("workouts", now.workouts, r.changes.workouts).find(w => w.id === "w2")?.sessionNotes, "there", "write: replaces what changed there");
  eq(applyChanges("programs", now.programs, r.changes.programs).length, 0, "write: drops what was deleted there");

  // Changed on the phone while the backup downloaded: left as it is now.
  const meanwhile = clone(BASE);
  meanwhile.workouts[1].sessionNotes = "typed meanwhile";
  meanwhile.programs[0].name = "Renamed meanwhile";
  meanwhile.workouts.unshift(workout("wNew", "2026-11-07"));
  const written = applyChanges("workouts", meanwhile.workouts, r.changes.workouts);
  eq(written.find(w => w.id === "w2")?.sessionNotes, "typed meanwhile", "write: an edit made meanwhile isn't overwritten");
  eq(sortedIds(written), ["w1", "w2", "wB", "wNew"], "write: a session finished meanwhile isn't lost");
  eq(applyChanges("programs", meanwhile.programs, r.changes.programs).map(p => p.name), ["Renamed meanwhile"],
    "write: a program changed meanwhile isn't dropped (the next merge decides it)");
  eq(applyChanges("journal", now.journal, r.changes.journal), now.journal, "write: a list nothing changed is left as it is");

  eq(datesAfter(["2026-11-01", "2026-11-02"], now.workouts, written), ["2026-11-01", "2026-11-02", "2026-11-06", "2026-11-07"],
    "write: the days trained gain the sessions' days");
  eq(datesAfter(["2026-11-01", "2026-11-02", "2026-10-30"], now.workouts, [now.workouts[1]]), ["2026-11-02", "2026-10-30"],
    "write: and lose a day only a dropped session had (a day with no session kept as it was)");
}

// ─── 13. Merging what's merged changes nothing ───────────────────────────────

{
  const local = clone(BASE);
  local.workouts.unshift(workout("wA", "2026-11-05"));
  const remote = clone(BASE);
  remote.journal.unshift(entry("jB", "2026-11-06T07:00:00.000Z"));
  const once = merge(local, remote).merged;
  const twice = merge(once, clone(once), { base: baseOf(once) });
  eq([twice.changedHere, twice.conflicts, sameSnapshot(twice.merged, once)], [false, 0, true], "merging the result again changes nothing");
  eq(sameBase(baseOf(once), baseOf(clone(once))), true, "a copy's base is its own");
}

// ─── 14. Deletions, as one list ──────────────────────────────────────────────

{
  const now = Date.parse("2026-11-07T12:00:00.000Z");
  const a = [tomb("workouts", "w1", "2026-11-05T00:00:00.000Z"), tomb("programs", "P", "2026-11-04T00:00:00.000Z")];
  const b = [tomb("workouts", "w1", "2026-11-01T00:00:00.000Z", "key"), tomb("journal", "old", "2025-09-01T00:00:00.000Z")];
  const m = mergeTombstones(a, b, now);
  eq(m.map(t => `${t.k}|${t.id}|${t.at.slice(0, 10)}|${t.key ?? ""}`).sort(),
    ["programs|P|2026-11-04|", "workouts|w1|2026-11-01|key"],
    "deletions: each once, at its first time, what it is kept, none older than 400 days");
  eq(mergeTombstones([{ k: "nope" as Tombstone["k"], id: "x", at: "2026-11-01T00:00:00.000Z" }], [], now), [], "deletions: something that isn't one is dropped");
}

// ─── 15. A hold put on by a phone that was behind ────────────────────────────

{
  // This phone opened after a week away and held the program; the other phone
  // trained the day before.
  const local = clone(BASE);
  local.programs[0].pausedAt = "2026-11-10";
  local.programs[0].currentWeek = 2;
  const remote = clone(BASE);
  remote.workouts.unshift(workout("wB", "2026-11-09"));
  const marker = { programId: "P", pausedAt: "2026-11-10" };
  const r = merge(local, remote);
  eq(r.merged.programs[0].pausedAt, "2026-11-10", "stale hold: the merge alone keeps this phone's hold");
  eq(undoStaleAutoPause(r, local, remote, marker, 7), true, "stale hold: undone once the other phone's sessions show it trained");
  eq([r.merged.programs[0].pausedAt, r.merged.programs[0].currentWeek], [undefined, 1], "stale hold: where it stands is the backup's");
  eq((r.changes.programs.put.get("P") as SavedProgram | undefined)?.pausedAt, undefined, "stale hold: written on the phone");

  const quiet = clone(BASE);
  const r2 = merge(clone(local), quiet);
  eq(undoStaleAutoPause(r2, local, quiet, marker, 7), false, "a real week off: the hold stays");
  const heldThere = clone(remote);
  heldThere.programs[0].pausedAt = "2026-11-09";
  const r3 = merge(clone(local), heldThere);
  eq(undoStaleAutoPause(r3, local, heldThere, marker, 7), false, "held on the other phone too: stays held");
  const r4 = merge(clone(local), clone(remote));
  eq(undoStaleAutoPause(r4, local, remote, null, 7), false, "a hold put on by hand (no marker): stays");
}

// ─── 16. Hashed a slice at a time, the same ──────────────────────────────────

void (async () => {
  const long = clone(BASE);
  for (let i = 0; i < 400; i++) long.workouts.push(workout(`wl${i}`, "2026-10-01", { completedAt: new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString() }));
  eq(sameBase(await baseOfInSlices(long, 64), baseOf(long)), true, "slices: a long history hashed in slices is the same base");
  const edited = clone(long);
  edited.workouts[300].sessionNotes = "edited";
  eq(sameBase(await baseOfInSlices(edited, 64), baseOf(long)), false, "slices: and an edit deep in it still shows");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("✓ two phones merge as decided");
})();

declare const process: { exit(code: number): never };
