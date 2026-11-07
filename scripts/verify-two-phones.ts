// scripts/verify-two-phones.ts
//
// Two phones signed in to one account (user decision, 2026-11-07: "Merge both
// phones"), each running its own copy of the app's backup code (lib/cloud.ts,
// utils/syncLocal.ts, utils/programPause.ts) against every migration, as on
// Supabase (scripts/harness). Expo Go and the App Store app on one phone are
// two phones too.
//
//   1. Updating to this app: the backup an older app left (ids re-minted) is
//      merged on the first check, with nothing doubled.
//   2. A second phone restores, then both log, delete, edit and rename, and
//      each backup that went up after the other's is merged, not lost.
//   3. One thing changed on both: the later change; a program part by part.
//   4. An older app's backup over it all: nothing doubled, nothing deleted
//      comes back, nothing it didn't have is lost.
//   5. A backup whose answer never came back, a screen writing back a list
//      read before a merge, no signal: nothing lost or doubled.
//   6. A phone left a week holds the program as it opens while the other
//      trained: the hold is undone by the other phone's sessions.
//   7. A phone alone on its account never downloads the backup to merge, and
//      sends nothing when nothing changed.
//   8. A long random run of both phones: after both check, both hold the same,
//      the backup holds it too, everything added and not deleted is there
//      once, and nothing deleted is.
//
// Run: npx tsx scripts/verify-two-phones.ts

import { advanceDays, setClock, tick } from "./harness/solo/env";
import { connectDb, fakeSupabase, freshApp, on, stubModule, type Phone } from "./harness/app";
import { createDb } from "./harness/db";
import { getJSON, setJSON } from "../utils/storage";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { JOURNAL_KEY, type JournalEntry } from "../constants/journal";
import { toReplaceUserDataPayload } from "../lib/mappers";
import { formatStoredDate, toYMD } from "../utils/dates";
import { sameSnapshot, type SyncSnapshot } from "../utils/syncMerge";
import type * as Cloud from "../lib/cloud";
import type * as SyncLocal from "../utils/syncLocal";
import type * as ProgramPause from "../utils/programPause";

declare const process: { exitCode?: number };

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const ok = (cond: boolean, label: string) => eq(cond, true, label);

// Native (expo-notifications); lib/cloud.ts only reaches it deleting an account.
stubModule({ file: "lib/push.ts" }, { unregisterPushToken: async () => {} });

type App = { cloud: typeof Cloud; local: typeof SyncLocal; pause: typeof ProgramPause };
const appCopy = (): App => freshApp(() => ({
  /* eslint-disable @typescript-eslint/no-require-imports -- a fresh copy per phone, see freshApp */
  cloud: require("../lib/cloud") as typeof Cloud,
  local: require("../utils/syncLocal") as typeof SyncLocal,
  pause: require("../utils/programPause") as typeof ProgramPause,
  /* eslint-enable @typescript-eslint/no-require-imports */
}));

const SAM = "5a5a5a5a-0000-4000-8000-00000000005a";
type Device = Phone & { app: App };
const device = (name: string): Device => ({ uid: SAM, name, store: new Map(), offline: false, app: appCopy() });
const SIGN_IN: [string, string][] = [["@avenas/account_type", "gym_user"], ["@avenas/unit", "kg"]];

// ─── What a phone does (the screens' writes, as the solo flows repeat them) ──

const at = (p: Device) => <T>(fn: () => Promise<T>) => on(p, fn);

async function changed(p: Device) {
  // scheduleCloudPush's stamp: when this phone last changed something.
  await p.app.local.noteLocalChange();
  tick();
}
async function logWorkout(p: Device, w: CompletedWorkout) {
  await at(p)(async () => {
    const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    await setJSON(WORKOUT_HISTORY_KEY, [w, ...history]);
    const dates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
    if (!dates.includes(w.date)) await setJSON(WORKOUT_DATES_KEY, [...dates, w.date]);
    await changed(p);
  });
}
async function editWorkout(p: Device, id: string, patch: Partial<CompletedWorkout>) {
  await at(p)(async () => {
    const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    await setJSON(WORKOUT_HISTORY_KEY, history.map(w => (w.id === id ? { ...w, ...patch } : w)));
    await changed(p);
  });
}
async function deleteWorkout(p: Device, id: string) {
  await at(p)(async () => {
    const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    const target = history.find(w => w.id === id);
    if (!target) return;
    await p.app.local.noteDeleted("workouts", [target]);
    await setJSON(WORKOUT_HISTORY_KEY, history.filter(w => w.id !== id));
    await changed(p);
  });
}
async function writeEntries(p: Device, f: (list: JournalEntry[]) => JournalEntry[], deleted: JournalEntry[] = []) {
  await at(p)(async () => {
    if (deleted.length) await p.app.local.noteDeleted("journal", deleted);
    await setJSON(JOURNAL_KEY, f(await getJSON<JournalEntry[]>(JOURNAL_KEY, [])));
    await changed(p);
  });
}
async function writePrograms(p: Device, f: (list: SavedProgram[]) => SavedProgram[], deleted: SavedProgram[] = []) {
  await at(p)(async () => {
    if (deleted.length) await p.app.local.noteDeleted("programs", deleted);
    await setJSON(PROGRAMS_KEY, f(await getJSON<SavedProgram[]>(PROGRAMS_KEY, [])));
    await changed(p);
  });
}
/** What each sync came to, so a run can show it merged rather than only pushed. */
const outcomes = new Map<string, number>();
const sync = async (p: Device, reason: Cloud.SyncReason = "push") => {
  const outcome = await at(p)(() => p.app.cloud.syncBackup(SAM, reason));
  outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
  return outcome;
};
const copyOf = (p: Device): Promise<SyncSnapshot> => at(p)(async () => ({
  programs: await getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
  workouts: await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
  journal: await getJSON<JournalEntry[]>(JOURNAL_KEY, []),
  custom: await getJSON(`@avenas/custom_exercises`, []),
}));
const workoutIds = async (p: Device) => (await copyOf(p)).workouts.map(w => w.id).sort();

/** Both phones check, twice round, and must then hold the same, as the backup does. */
async function settle(a: Device, b: Device, label: string) {
  for (let i = 0; i < 2; i++) {
    await sync(a, "check");
    await sync(b, "check");
  }
  const [ca, cb] = [await copyOf(a), await copyOf(b)];
  ok(sameSnapshot(ca, cb), `${label}: both phones hold the same`);
  const backup = await backupCopy(a);
  ok(sameSnapshot(ca, backup), `${label}: and so does the backup`);
  return ca;
}

/** The backup as get_my_backup hands it over, read on `p`'s account. */
async function backupCopy(p: Phone): Promise<SyncSnapshot> {
  const { data } = await on(p, () => fakeSupabase.rpc("get_my_backup"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the mappers, as lib/cloud.ts reads it
  const m = require("../lib/mappers") as typeof import("../lib/mappers");
  const j = data as import("../lib/database.types").MyBackupPayload;
  const { programs, workouts } = m.snapshotFromRows(j.programs, j.workouts);
  return { programs, workouts, journal: m.journalFromRows(j.journal), custom: j.custom.map(m.customFromRow) };
}
const backupVersion = async (p: Phone) => ((await on(p, () => fakeSupabase.rpc("get_my_backup"))).data as { version: number }).version;

/** How many times each function was called, to see what a phone sent and read. */
const calls = new Map<string, number>();
const realRpc = fakeSupabase.rpc.bind(fakeSupabase);
fakeSupabase.rpc = async (fn: string, args?: Record<string, unknown>) => {
  calls.set(fn, (calls.get(fn) ?? 0) + 1);
  return realRpc(fn, args);
};
const callCount = (fn: string) => calls.get(fn) ?? 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ymd = () => toYMD(new Date());
let n = 0;
const newWorkout = (over: Partial<CompletedWorkout> = {}): CompletedWorkout => {
  n += 1;
  tick();
  return {
    id: `workout_${Date.now()}_${n}`, date: ymd(), completedAt: new Date().toISOString(), workoutName: "Upper",
    durationSeconds: 1800, programId: "prog_main", dayId: "d0",
    exercises: [{ name: "Bench Press", notes: "", sets: [{ type: "working", weight: "80", reps: "5", done: true }] }],
    ...over,
  };
};
const newEntry = (title: string): JournalEntry => {
  tick();
  return { id: `${Date.now()}`, title, body: "", createdAt: new Date().toISOString() };
};
const MAIN: SavedProgram = {
  id: "prog_main", name: "Strength", totalWeeks: 8, currentWeek: 1, status: "active",
  startDate: formatStoredDate(new Date(2026, 9, 26)), trainingDays: 2, cycleDays: 3,
  cyclePattern: ["Upper", "Lower", "Rest"], dayIds: ["d0", "d1", "d2"],
  workouts: { "0:Upper": [{ id: "e1", name: "Bench Press", sets: [{ type: "working", reps: "5" }] }] },
};

// ─── The scenarios ───────────────────────────────────────────────────────────

async function scenarios() {
  setClock(2026, 11, 2, 9);
  const A = device("Phone");
  const B = device("Expo Go");

  // ── 1. Updating to this app ──
  // The phone's copy, and the backup an older app made of it: every session
  // and entry under a row id minted by that backup, none of their own.
  const w1 = newWorkout();
  const w2 = newWorkout({ workoutName: "Lower", dayId: "d1" });
  const j1 = newEntry("Week 1");
  A.store = new Map([
    ...SIGN_IN,
    ["@avenas/cache_owner", JSON.stringify(SAM)],
    [PROGRAMS_KEY, JSON.stringify([MAIN])],
    [WORKOUT_HISTORY_KEY, JSON.stringify([w2, w1])],
    [WORKOUT_DATES_KEY, JSON.stringify([w1.date])],
    [JOURNAL_KEY, JSON.stringify([j1])],
  ]);
  await on(A, async () => {
    const p = toReplaceUserDataPayload([MAIN], [w2, w1], [j1], [], SAM);
    const strip = <T extends { local_id?: string | null }>(rows: T[]) => rows.map(({ local_id: _l, ...r }) => r);
    const { error } = await fakeSupabase.rpc("replace_user_data", {
      p_programs: p.p_programs, p_workouts: strip(p.p_workouts), p_journal: strip(p.p_journal), p_custom: [],
    });
    if (error) throw new Error(error.message);
  });
  eq(await sync(A, "check"), "merged", "update: the first check merges with the older app's backup");
  eq(await workoutIds(A), [w1.id, w2.id].sort(), "update: each session once, under the phone's own id");
  eq((await copyOf(A)).journal.map(e => e.id), [j1.id], "update: the entry once");
  ok(sameSnapshot(await copyOf(A), await backupCopy(A)), "update: the backup now holds the phone's copy, ids and all");
  eq(await sync(A, "check"), "upToDate", "update: then there's nothing to do");

  // ── 2. A second phone ──
  B.store = new Map(SIGN_IN);
  eq(await on(B, () => B.app.cloud.reconcileOnSignIn(SAM)), "replaced", "second phone: signs in and restores");
  eq(await workoutIds(B), [w1.id, w2.id].sort(), "second phone: with every session under its id");

  const wA = newWorkout();
  await logWorkout(A, wA);
  eq(await sync(A), "pushed", "both log: the first phone backs up");
  const wB = newWorkout({ workoutName: "Lower", dayId: "d1" });
  await logWorkout(B, wB);
  eq(await sync(B), "merged", "both log: the second's backup is refused and merges instead");
  eq(await workoutIds(B), [w1.id, w2.id, wA.id, wB.id].sort(), "both log: the second phone has both new sessions");
  eq(await sync(A, "check"), "merged", "both log: the first phone's check takes the second's in");
  eq(await workoutIds(A), [w1.id, w2.id, wA.id, wB.id].sort(), "both log: and so has the first");
  ok((await on(A, () => getJSON<string[]>(WORKOUT_DATES_KEY, []))).includes(wB.date), "both log: the other phone's day is a day trained");

  await deleteWorkout(A, wA.id);
  await sync(A);
  await sync(B, "check");
  eq(await workoutIds(B), [w1.id, w2.id, wB.id].sort(), "delete: a session deleted on one phone goes from the other");

  await editWorkout(A, w1.id, { sessionNotes: "felt strong" });
  await writePrograms(B, list => list.map(p => (p.id === MAIN.id ? { ...p, name: "Strength Block" } : p)));
  await sync(A);
  await sync(B);
  await sync(A, "check");
  const both = await settle(A, B, "edits");
  eq([both.workouts.find(w => w.id === w1.id)?.sessionNotes, both.programs[0].name], ["felt strong", "Strength Block"],
    "edits: a session edited on one phone and the program renamed on the other: both");

  const entry = newEntry("Recovery");
  await writeEntries(B, list => [entry, ...list]);
  await sync(B);
  await writeEntries(A, list => list.filter(e => e.id !== j1.id), [j1]);
  await sync(A);
  const journal = (await settle(A, B, "journal")).journal.map(e => e.id);
  eq(journal, [entry.id], "journal: an entry written on one phone and one deleted on the other");

  // ── 3. One thing changed on both ──
  await editWorkout(A, w2.id, { sessionNotes: "first phone" });
  await editWorkout(B, w2.id, { sessionNotes: "second phone, later" });
  await sync(A);
  await sync(B);
  eq((await settle(A, B, "conflict")).workouts.find(w => w.id === w2.id)?.sessionNotes, "second phone, later",
    "conflict: the session changed on both takes the later change");

  await writePrograms(A, list => list.map(p => ({ ...p, workouts: { "0:Upper": [{ id: "e1", name: "Incline Bench Press", sets: [{ type: "working", reps: "8" }] }] } })));
  await writePrograms(B, list => list.map(p => ({ ...p, pausedAt: ymd() })));
  await sync(B);
  await sync(A);
  const prog = (await settle(A, B, "program parts")).programs[0];
  eq([prog.workouts["0:Upper"][0].name, prog.pausedAt], ["Incline Bench Press", ymd()],
    "program parts: an exercise changed on one phone and a hold on the other both stay");
  await writePrograms(A, list => list.map(p => ({ ...p, pausedAt: undefined })));
  await sync(A);
  await settle(A, B, "resumed");

  // ── 4. An older app's backup over it all ──
  // A third install on an app from before 0057: its copy is the one restored
  // a while back, so it has a session since deleted (wA) and none since.
  const C: Phone = { uid: SAM, name: "Old app", store: new Map(), offline: false };
  await on(C, async () => {
    const p = toReplaceUserDataPayload([MAIN], [wA, w2, w1], [j1], [], SAM);
    const strip = <T extends { local_id?: string | null }>(rows: T[]) => rows.map(({ local_id: _l, ...r }) => r);
    await fakeSupabase.rpc("replace_user_data", { p_programs: p.p_programs, p_workouts: strip(p.p_workouts), p_journal: strip(p.p_journal), p_custom: [] });
  });
  const afterOld = await settle(A, B, "older app");
  eq(afterOld.workouts.map(w => w.id).sort(), [w1.id, w2.id, wB.id].sort(),
    "older app: nothing doubled, the session deleted stays deleted, the one it never had is kept");
  eq(afterOld.journal.map(e => e.id), [entry.id], "older app: the entry deleted stays deleted, the new one kept");
  eq(afterOld.programs.map(p => p.name), ["Strength Block"], "older app: the program as renamed");

  // ── 5. Things that go wrong ──
  // The backup went through, but its answer never came back: the phone still
  // thinks it's on the version before.
  const before = await on(A, () => getJSON<unknown>("@avenas/sync_state", null));
  const wLost = newWorkout();
  await logWorkout(A, wLost);
  await sync(A);
  await on(A, () => setJSON("@avenas/sync_state", before));
  const wNext = newWorkout();
  await logWorkout(A, wNext);
  eq(await sync(A), "merged", "lost answer: the next backup is refused, and merges with the phone's own last one");
  eq((await settle(A, B, "lost answer")).workouts.filter(w => w.id === wLost.id || w.id === wNext.id).length, 2,
    "lost answer: both sessions, once each");

  // A screen that read the programs before a merge writes them back after it,
  // without the program the merge brought in.
  const second: SavedProgram = { ...MAIN, id: "prog_second", name: "Conditioning", status: "created", startDate: "" };
  await writePrograms(A, list => [...list, second]);
  await sync(A);
  const heldByScreen = await on(B, () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []));
  await sync(B, "check");
  eq((await on(B, () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []))).map(p => p.id), [MAIN.id, second.id], "stale screen: the merge brought the program in");
  await writePrograms(B, () => heldByScreen.map(p => ({ ...p, name: "Strength Block 2" })));
  await sync(B);
  const healed = await settle(A, B, "stale screen");
  eq(healed.programs.map(p => [p.id, p.name]), [[MAIN.id, "Strength Block 2"], [second.id, "Conditioning"]],
    "stale screen: the program it wrote away comes back, and its rename stays");

  // No signal: the backup fails, nothing is lost, and it goes once it's back.
  B.offline = true;
  const wOffline = newWorkout();
  await logWorkout(B, wOffline);
  let threw = false;
  try { await sync(B); } catch { threw = true; }
  ok(threw, "offline: the backup fails out loud (it's retried)");
  B.offline = false;
  eq((await settle(A, B, "offline")).workouts.some(w => w.id === wOffline.id), true, "offline: the session goes once the signal's back");

  // ── 6. A phone left a week ──
  // The first phone trains every day; the second sits unopened.
  for (let d = 0; d < 8; d++) {
    advanceDays(1, 9);
    await logWorkout(A, newWorkout());
    await sync(A);
  }
  const held = await on(B, () => B.app.pause.autoPauseIfIdle());
  ok(!!held?.pausedAt, "a week away: the second phone opens and holds the program, by its own count");
  await sync(B, "check");
  eq((await on(B, () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []))).find(p => p.id === MAIN.id)?.pausedAt, undefined,
    "a week away: the first phone's sessions undo the hold");
  eq((await settle(A, B, "a week away")).programs.find(p => p.id === MAIN.id)?.pausedAt, undefined,
    "a week away: and it never reaches the phone being trained on");

  // ── 7. A phone alone ──
  const version = await backupVersion(A);
  const reads = callCount("get_my_backup");
  const sends = callCount("replace_user_data");
  for (let i = 0; i < 5; i++) {
    await logWorkout(A, newWorkout());
    eq(await sync(A), "pushed", `alone: backup ${i + 1} goes straight through`);
    eq(await sync(A, "check"), "upToDate", `alone: and a check finds nothing new`);
  }
  eq(callCount("get_my_backup") - reads, 0, "alone: the backup is never downloaded to merge");
  eq(callCount("replace_user_data") - sends, 5, "alone: one backup a change");
  eq(await backupVersion(A), version + 5, "alone: each one moves the version on by one");
  eq(await sync(A), "upToDate", "alone: nothing changed, nothing sent");
  eq(callCount("replace_user_data") - sends, 5, "alone: still five");
  await settle(A, B, "alone");
}

// ─── 8. A long random run ────────────────────────────────────────────────────

/** mulberry32: the same run every time for a seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function randomRun(seed: number, steps: number) {
  const db = await createDb({ apiGrants: true });
  connectDb(db);
  try {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, 'sam@example.com')`, [SAM]);
    await randomSteps(seed, steps);
  } finally {
    await db.close();
  }
}

async function randomSteps(seed: number, steps: number) {
  setClock(2026, 11, 2, 9);
  const mergedBefore = outcomes.get("merged") ?? 0;
  const rand = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const A = device("Phone");
  const B = device("Expo Go");
  A.store = new Map([...SIGN_IN, ["@avenas/cache_owner", JSON.stringify(SAM)], [PROGRAMS_KEY, JSON.stringify([MAIN])]]);
  await sync(A, "check");
  B.store = new Map(SIGN_IN);
  await on(B, () => B.app.cloud.reconcileOnSignIn(SAM));

  const added = new Set<string>();   // every session and entry ever made, "w:id" / "j:id"
  const deleted = new Set<string>();
  const programsMade = new Set<string>([MAIN.id]);
  const programsDeleted = new Set<string>();
  const label = `random run ${seed}`;

  for (let i = 0; i < steps; i++) {
    const p = rand() < 0.5 ? A : B;
    const r = rand();
    const mine = await copyOf(p);
    try {
      if (r < 0.2) {
        const w = newWorkout({ workoutName: pick(["Upper", "Lower", "Run"]) });
        added.add(`w:${w.id}`);
        await logWorkout(p, w);
      } else if (r < 0.3 && mine.workouts.length > 0) {
        const w = pick(mine.workouts);
        deleted.add(`w:${w.id}`);
        await deleteWorkout(p, w.id);
      } else if (r < 0.42 && mine.workouts.length > 0) {
        await editWorkout(p, pick(mine.workouts).id, { sessionNotes: `note ${i}` });
      } else if (r < 0.5) {
        const e = newEntry(`entry ${i}`);
        added.add(`j:${e.id}`);
        await writeEntries(p, list => [e, ...list]);
      } else if (r < 0.55 && mine.journal.length > 0) {
        const e = pick(mine.journal);
        deleted.add(`j:${e.id}`);
        await writeEntries(p, list => list.filter(x => x.id !== e.id), [e]);
      } else if (r < 0.6 && mine.journal.length > 0) {
        const e = pick(mine.journal);
        await writeEntries(p, list => list.map(x => (x.id === e.id ? { ...x, body: `rewritten ${i}` } : x)));
      } else if (r < 0.65) {
        tick();
        const prog: SavedProgram = { ...MAIN, id: `program_${Date.now()}_${i}`, name: `Block ${i}`, status: "created", startDate: "" };
        programsMade.add(prog.id);
        await writePrograms(p, list => [...list, prog]);
      } else if (r < 0.69 && mine.programs.length > 1) {
        const prog = pick(mine.programs.filter(x => x.id !== MAIN.id));
        if (prog) {
          programsDeleted.add(prog.id);
          await writePrograms(p, list => list.filter(x => x.id !== prog.id), [prog]);
        }
      } else if (r < 0.75 && mine.programs.length > 0) {
        const prog = pick(mine.programs);
        await writePrograms(p, list => list.map(x => (x.id === prog.id ? { ...x, name: `${x.name.split(" #")[0]} #${i}` } : x)));
      } else if (r < 0.8) {
        // A screen holding the programs from before a check writes them back
        // after it, renamed: whatever the check brought in is written away.
        const held = await on(p, () => getJSON<SavedProgram[]>(PROGRAMS_KEY, []));
        await sync(p, "check");
        await writePrograms(p, () => held.filter(x => !programsDeleted.has(x.id)).map((x, k) => (k === 0 ? { ...x, name: `${x.name.split(" #")[0]} #${i}` } : x)));
      } else if (r < 0.93) {
        await sync(p, pick(["push", "check"] as const));
      } else if (r < 0.96) {
        p.offline = !p.offline;
      } else {
        advanceDays(1, 9);
      }
    } catch (e) {
      // A backup with no signal fails, as it should; anything else is a bug.
      if (!p.offline) failures.push(`✗ ${label} step ${i} on ${p.name}: ${(e as Error).message}`);
    }
  }
  A.offline = false;
  B.offline = false;
  const end = await settle(A, B, label);
  const sessions = end.workouts.map(w => `w:${w.id}`);
  const entries = end.journal.map(e => `j:${e.id}`);
  const have = new Set([...sessions, ...entries]);
  eq(sessions.length + entries.length, have.size, `${label}: nothing twice`);
  eq([...added].filter(k => !deleted.has(k) && !have.has(k)), [], `${label}: everything made and not deleted is there`);
  eq([...have].filter(k => deleted.has(k)), [], `${label}: nothing deleted is`);
  eq([...have].filter(k => !added.has(k)), [], `${label}: nothing that was never made`);
  const progs = new Set(end.programs.map(p => p.id));
  eq(end.programs.length, progs.size, `${label}: no program twice`);
  eq([...programsMade].filter(id => !programsDeleted.has(id) && !progs.has(id)), [], `${label}: every program kept is there`);
  eq([...progs].filter(id => programsDeleted.has(id)), [], `${label}: no deleted program is`);
  ok((outcomes.get("merged") ?? 0) - mergedBefore >= 5, `${label}: the phones merged along the way, not only pushed`);
}

void (async () => {
  try {
    const db = await createDb({ apiGrants: true });
    connectDb(db);
    try {
      await db.query(`insert into auth.users (id, email) values ($1::uuid, 'sam@example.com')`, [SAM]);
      await scenarios();
    } finally {
      await db.close();
    }
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await randomRun(seed, 250);
  } catch (e) {
    failures.push(`✗ crashed: ${(e as Error).stack ?? e}`);
  }
  const tally = [...outcomes.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
  if (failures.length) {
    console.log(failures.slice(0, 40).join("\n"));
    console.log(`\n${passed} passed, ${failures.length} failed (backups: ${tally})`);
    process.exitCode = 1;
    return;
  }
  console.log(`${passed} passed, 0 failed (backups: ${tally})`);
  console.log("✓ two phones on one account merge, and nothing is lost");
})();
