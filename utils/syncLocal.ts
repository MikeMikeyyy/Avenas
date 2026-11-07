// utils/syncLocal.ts
//
// What this phone keeps to merge its copy with the account's backup when
// another phone has backed up since (lib/cloud.ts syncBackup, the merge in
// utils/syncMerge.ts; user decision, 2026-11-07):
//
//   SYNC_STATE_KEY     the backup as this phone last saw it: its version and a
//                      hash per item (the merge's base), for the account it
//                      belongs to.
//   SYNC_DELETED_KEY   every deletion this phone knows of, its own and the
//                      other phone's, so a delete reaches the other phone and
//                      nothing deleted comes back. EVERY DELETE of a program,
//                      session or journal entry calls noteDeleted() before it
//                      removes the item: an item missing without one is taken
//                      for one a stale write dropped, and brought back.
//   SYNC_CHANGED_AT_KEY  when this phone last changed something (epoch ms, set
//                      with every scheduled backup): which phone's version wins
//                      an item both changed.
//   DEVICE_ID_KEY      which install this is, sent with each backup, so a phone
//                      can tell its own last backup from another's. Kept across
//                      accounts and sign-outs (it's the install's, not the
//                      account's); the rest goes with the account's data
//                      (lib/cloud.ts clearLocalUserData).
//   AUTO_PAUSE_KEY     the hold the app last put on by itself after a week with
//                      nothing logged (utils/programPause.ts autoPauseIfIdle).
//                      A phone that was behind can do that while the other phone
//                      trained; the next merge undoes it once the other phone's
//                      sessions arrive (syncMerge.ts undoStaleAutoPause).
//
// Runs on the phone and in the node harness (scripts/verify-two-phones.ts):
// storage only, through utils/storage.ts. The four lists themselves are read
// by lib/cloud.ts (readLocalCopy).

import { getJSON, removeKey, setJSON } from "./storage";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";
import { itemId, mergeTombstones, naturalKey, type SyncBase, type SyncKind, type Tombstone } from "./syncMerge";

export const SYNC_STATE_KEY = "@avenas/sync_state";
export const SYNC_DELETED_KEY = "@avenas/sync_deleted";
export const SYNC_CHANGED_AT_KEY = "@avenas/sync_changed_at";
export const DEVICE_ID_KEY = "@avenas/device_id";
export const AUTO_PAUSE_KEY = "@avenas/auto_pause";

/** The backup as this phone last saw it. `raw` fingerprints the four stored
 *  lists as they stood then, so "nothing changed" is one hash, not a hash of
 *  every item. */
export type SyncState = { uid: string; version: number; base: SyncBase; raw: string };

export type AutoPause = { programId: string; pausedAt: string };

// ─── One at a time ──────────────────────────────────────────────────────────
// The deletion list is added to by every delete and rewritten by every merge,
// so the two never interleave a read and a write.

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ─── Deletions ──────────────────────────────────────────────────────────────

export async function readTombstones(): Promise<Tombstone[]> {
  const list = await getJSON<Tombstone[]>(SYNC_DELETED_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Add `more` to the deletions known (a merge's, or a delete's). */
export function addTombstones(more: Tombstone[]): Promise<void> {
  return serial(async () => {
    await setJSON(SYNC_DELETED_KEY, mergeTombstones(await readTombstones(), more));
  });
}

type ItemOf<K extends SyncKind> =
  K extends "programs" ? SavedProgram : K extends "workouts" ? CompletedWorkout : K extends "journal" ? JournalEntry : CustomExercise;

/**
 * Record that `items` are being deleted, so the delete reaches the account's
 * other phone and the merge never brings them back. Call it BEFORE the items
 * leave storage and await it: between the two, a backup check would find them
 * gone with nothing to say why, and fetch them back.
 */
export async function noteDeleted<K extends Exclude<SyncKind, "custom">>(kind: K, items: ItemOf<K>[]): Promise<void> {
  if (items.length === 0) return;
  const at = new Date().toISOString();
  await addTombstones(items.map(item => {
    const key = naturalKey(kind, item);
    return key ? { k: kind, id: itemId(kind, item), key, at } : { k: kind, id: itemId(kind, item), at };
  }));
}

// ─── The base ───────────────────────────────────────────────────────────────

export async function readSyncState(uid: string): Promise<SyncState | null> {
  const s = await getJSON<SyncState | null>(SYNC_STATE_KEY, null);
  return s && s.uid === uid && typeof s.version === "number" && s.base ? s : null;
}

export function writeSyncState(s: SyncState): Promise<void> {
  return setJSON(SYNC_STATE_KEY, s);
}

/** The keys that go with the account's data (lib/cloud.ts clearLocalUserData). */
export const SYNC_ACCOUNT_KEYS = [SYNC_STATE_KEY, SYNC_DELETED_KEY, SYNC_CHANGED_AT_KEY, AUTO_PAUSE_KEY];

export async function clearSyncState(): Promise<void> {
  await removeKey(SYNC_STATE_KEY);
}

// ─── When this phone last changed something ─────────────────────────────────

export function noteLocalChange(at: number = Date.now()): Promise<void> {
  return setJSON(SYNC_CHANGED_AT_KEY, at);
}

export async function readLocalChangedAt(): Promise<number> {
  const at = await getJSON<number>(SYNC_CHANGED_AT_KEY, 0);
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

// ─── Which install this is ──────────────────────────────────────────────────

let device: string | null = null;

export async function deviceId(): Promise<string> {
  if (device) return device;
  const saved = await getJSON<string | null>(DEVICE_ID_KEY, null);
  if (typeof saved === "string" && saved) {
    device = saved;
    return saved;
  }
  const made = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await setJSON(DEVICE_ID_KEY, made);
  device = made;
  return made;
}

// ─── The hold put on by the app ─────────────────────────────────────────────

export function noteAutoPause(p: AutoPause): Promise<void> {
  return setJSON(AUTO_PAUSE_KEY, p);
}

export async function readAutoPause(): Promise<AutoPause | null> {
  const p = await getJSON<AutoPause | null>(AUTO_PAUSE_KEY, null);
  return p && typeof p.programId === "string" && typeof p.pausedAt === "string" ? p : null;
}

export function clearAutoPause(): Promise<void> {
  return removeKey(AUTO_PAUSE_KEY);
}
