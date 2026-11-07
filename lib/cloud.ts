// Network layer: the account's backup (push, pull, and merging it with another
// phone's), counts, the profile.
//
// Imports the Supabase client and AsyncStorage: on the phone, and in the node
// harness through its stand-ins (scripts/harness/app.ts).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOutHere, supabase } from "./supabase";
import { getJSON, removeKey, setJSON } from "../utils/storage";
import { ACHIEVEMENTS_KEY } from "../constants/achievements";
import {
  PROGRAMS_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, WORKOUT_DRAFT_KEY, WORKOUT_DAY_OVERRIDE_KEY,
  UNFINISHED_NOTICE_KEY, IMPORT_LOG_KEY,
  type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { JOURNAL_KEY, type JournalEntry } from "../constants/journal";
import { CUSTOM_KEY, EXERCISE_MEDIA_UPLOADS_KEY, type CustomExercise } from "../constants/exercises";
import { liveCustoms } from "../utils/customExercises";
import { refreshAssisted } from "../utils/assistedStore";
import {
  customFromRow,
  journalFromRows,
  snapshotFromRows,
  toReplaceUserDataPayload,
} from "./mappers";
import type {
  BackupStateRow, CustomExerciseRow, JournalRow, MyBackupPayload, ProgramRow, WorkoutRow,
} from "./database.types";
import {
  applyChanges, baseOfInSlices, datesAfter, droppedWithoutDelete, hashText, mergeSnapshots, sameBase, sameTombstones,
  undoStaleAutoPause, type MergeResult, type SyncSnapshot, type Tombstone,
} from "../utils/syncMerge";
import {
  SYNC_ACCOUNT_KEYS, addTombstones, clearAutoPause, clearSyncState, deviceId, readAutoPause, readLocalChangedAt,
  readSyncState, readTombstones, writeSyncState,
} from "../utils/syncLocal";
import { emitSyncedDataChanged } from "../utils/syncEvents";
import { AUTO_PAUSE_AFTER_DAYS } from "../utils/programHolds";
import { ACCOUNT_TYPE_KEY, type AccountType } from "../contexts/AccountTypeContext";
import { UNIT_KEY } from "../utils/units";
import {
  CLIENTS_KEY, CLIENT_DATA_PREFIX, CONNECTION_ROLES_KEY, PT_SEEDED_KEY, SHARED_PROGRAMS_KEY, TRAINER_CLIENTS_KEY,
  clearTrainerData, relinkSharesAfterRestore,
} from "../utils/trainerStore";
import { clearChatData } from "../utils/chatStore";
import { clearModerationData } from "../utils/moderation";
import { clearProgressSessions } from "../utils/progressSession";
import { deleteGroup, fetchMyGroups } from "./groups";
import { deleteShareRow, fetchMyShareRows, getMyUid } from "./shares";
import { unregisterPushToken } from "./push";
import { deleteMyExerciseMedia } from "./exerciseMedia";

export type SyncCounts = {
  programs: number;
  workouts: number;
  journal: number;
  customExercises: number;
};

/**
 * Make this phone's copy the account's backup, whatever another phone has
 * backed up (Keep Device Data on the "Data found on this device" prompt, the
 * test screen). Every other backup goes through syncBackup, which merges.
 *
 * replace_user_data (migration 0004) replaces the whole copy in ONE
 * transaction, so a failure rolls back instead of leaving it wiped or partial;
 * workouts point at their program by its place in the list (program_index),
 * which the server turns into the program row it mints.
 */
export async function pushAllLocalDataToCloud(userId: string): Promise<SyncCounts> {
  await syncBackup(userId, "replace");
  return localCounts();
}

/** Row counts currently in the cloud for this user (Data & Sync, and whether
 *  either side has anything). Custom exercises are the ones you can see: a
 *  deleted one stays in the backup for its sessions (0048) but isn't counted,
 *  or Data & Sync would show it there after you'd deleted it. */
export async function cloudCounts(userId: string): Promise<SyncCounts> {
  const count = async (table: "programs" | "workouts" | "journal_entries" | "custom_exercises") => {
    const { count: c, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return c ?? 0;
  };
  // A server without 0048 has no deleted_at to filter on: there, all of them.
  const liveCustomCount = async () => {
    const { count: c, error } = await supabase
      .from("custom_exercises")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null);
    return error ? count("custom_exercises") : c ?? 0;
  };
  const [programs, workouts, journal, customExercises] = await Promise.all([
    count("programs"),
    count("workouts"),
    count("journal_entries"),
    liveCustomCount(),
  ]);
  return { programs, workouts, journal, customExercises };
}

/** The most rows the API hands back for one read (Supabase's "max rows"). */
const PAGE_ROWS = 1000;

/**
 * Every one of `userId`'s rows in `table`, a page at a time, in `column`'s
 * order and then by id, so a tie never straddles two pages (and comes back
 * twice, or not at all). A read without pages stopped at 1000 rows: a restore
 * of an account with more workouts kept only the newest 1000, and the next
 * backup then deleted the rest from the account (found 2026-10-23, as
 * importing another app's history made that many likely).
 */
async function selectEvery(
  table: "workouts" | "journal_entries",
  userId: string,
  column: "completed_at" | "created_at",
  ascending: boolean,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from(table).select("*").eq("user_id", userId)
      .order(column, { ascending })
      .order("id", { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`pull ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return rows;
  }
}

/** Everything the cloud holds for one account, fetched but not yet written. */
type CloudSnapshot = SyncSnapshot;

/**
 * The account's backup table by table: a server without 0057, which has no
 * get_my_backup. Network only, and throws on ANY failure without touching
 * local storage.
 */
async function fetchTables(userId: string): Promise<CloudSnapshot> {
  const { data: progRows, error: pe } = await supabase
    .from("programs").select("*").eq("user_id", userId)
    // Oldest-first, matching how local writes append to @avenas/programs (a
    // backup inserts them in that order). Without this the pull returned rows
    // in whatever order Postgres chose, so "newest first" in the programs list
    // was arbitrary after any sync.
    .order("created_at", { ascending: true });
  if (pe) throw new Error(`pull programs: ${pe.message}`);

  // History is newest-first.
  const woRows = await selectEvery("workouts", userId, "completed_at", false);
  const jRows = await selectEvery("journal_entries", userId, "created_at", false);

  const { data: cRows, error: ce } = await supabase.from("custom_exercises").select("*").eq("user_id", userId);
  if (ce) throw new Error(`pull custom exercises: ${ce.message}`);

  // Each program under its own id, and each workout pointing at it by that id:
  // the row ids are minted afresh by every backup, and taken as the ids, a
  // restore renamed every program (mappers.snapshotFromRows, migration 0044).
  const { programs, workouts } = snapshotFromRows((progRows ?? []) as ProgramRow[], woRows as WorkoutRow[]);
  return {
    programs,
    workouts,
    journal: journalFromRows(jRows as JournalRow[]),
    custom: ((cRows ?? []) as CustomExerciseRow[]).map(customFromRow),
  };
}

/**
 * Download the account's whole backup: in one read with its version where
 * the server has 0057 (`backup` is then what syncBackup needs to merge on top
 * of it), table by table where it doesn't (`backup` null). Network only:
 * throws on ANY failure WITHOUT touching local storage, so callers get an
 * all-or-nothing snapshot and a failed download can never leave the device
 * half-written or wiped.
 */
async function fetchAllFromCloud(userId: string): Promise<{ snap: CloudSnapshot; backup: Backup | null }> {
  const backup = await fetchBackup();
  return backup ? { snap: backup.snap, backup } : { snap: await fetchTables(userId), backup: null };
}

/** Overwrite the local cache with a fetched snapshot (cloud is the source of
 *  truth). workout_dates is rebuilt from the snapshot's workouts. Then which
 *  sends made which of the restored copies, which only the phone kept and a
 *  restore clears (relinkSharesAfterRestore). */
async function writeSnapshotToLocal(snap: CloudSnapshot): Promise<void> {
  await setJSON(PROGRAMS_KEY, snap.programs);
  await setJSON(WORKOUT_HISTORY_KEY, snap.workouts);
  await setJSON(WORKOUT_DATES_KEY, Array.from(new Set(snap.workouts.map((w) => w.date))));
  await setJSON(JOURNAL_KEY, snap.journal);
  await setJSON(CUSTOM_KEY, snap.custom);
  await relinkSharesAfterRestore();
  // Which custom exercises are assisted, as restored (utils/assisted.ts).
  await refreshAssisted();
}

/** After the phone took the backup whole (a restore, an account switch): it
 *  has seen this version, and knows its deletions. With no version (a server
 *  without 0057) there's nothing to merge on top of. */
async function recordBackupTaken(userId: string, backup: Backup | null): Promise<void> {
  if (!backup) {
    await clearSyncState();
    return;
  }
  await addTombstones(backup.deleted);
  const { raw } = await readLocalCopy();
  await writeSyncState({ uid: userId, version: backup.version, base: await baseOfInSlices(backup.snap), raw });
}

const snapshotCounts = (s: CloudSnapshot): SyncCounts => ({
  programs: s.programs.length,
  workouts: s.workouts.length,
  journal: s.journal.length,
  customExercises: liveCustoms(s.custom).length,
});

/**
 * Pull this user's cloud data down and OVERWRITE the local AsyncStorage cache
 * with it. All four datasets are fetched before anything is written, so a
 * network failure mid-pull leaves local storage exactly as it was.
 */
export async function pullAllFromCloud(userId: string): Promise<SyncCounts> {
  const { snap, backup } = await fetchAllFromCloud(userId);
  await writeSnapshotToLocal(snap);
  await recordBackupTaken(userId, backup);
  return snapshotCounts(snap);
}

/** Row counts currently in local AsyncStorage. */
export async function localCounts(): Promise<SyncCounts> {
  const [programs, history, journal, custom] = await Promise.all([
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
    getJSON<JournalEntry[]>(JOURNAL_KEY, []),
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
  ]);
  return {
    programs: programs.length,
    workouts: history.length,
    journal: journal.length,
    customExercises: liveCustoms(custom).length,
  };
}

const total = (c: SyncCounts) => c.programs + c.workouts + c.journal + c.customExercises;

/**
 * First-login reconciliation — runs automatically on SIGNED_IN. NON-DESTRUCTIVE:
 * it only seeds whichever side is empty, so it can never silently overwrite data.
 *   - cloud empty, local has data  → push (this device seeds the cloud)
 *   - local empty, cloud has data  → pull (a fresh device gets its data)
 *   - both have data (or both empty) → noop (leave both; resolved later by the
 *     ongoing per-write sync, or a manual push/pull)
 */
export async function syncOnLogin(
  userId: string,
): Promise<{ direction: "pushed" | "pulled" | "noop"; counts: SyncCounts }> {
  const [cloud, local] = await Promise.all([cloudCounts(userId), localCounts()]);
  if (total(cloud) === 0 && total(local) > 0) {
    return { direction: "pushed", counts: await pushAllLocalDataToCloud(userId) };
  }
  if (total(local) === 0 && total(cloud) > 0) {
    return { direction: "pulled", counts: await pullAllFromCloud(userId) };
  }
  return { direction: "noop", counts: cloud };
}

// ── Two phones on one account (migration 0057) ─────────────────────────────────
//
// Every backup replaces the account's whole copy, and with two phones on one
// account the copy used to be whichever left the app last, the other's new
// workouts dropped from it (user decision, 2026-11-07: merge both phones). Now
// the backup has a version, and a phone sends the one it last saw: refused if
// another phone's backup landed since, it downloads that one, merges it with
// its own copy (utils/syncMerge.ts) and sends the result. The other phone's
// changes also come in when the app opens or comes back to the front ("check").
// A phone alone on its account never merges: its own last backup is always
// the latest, so each one goes straight through as before.

/** Another phone backed up since this one last saw the backup. */
export class StaleBackupError extends Error {
  constructor() {
    super("backup: another phone backed up since");
    this.name = "StaleBackupError";
  }
}

/** The server has no 0057 (no versions, no get_my_backup): backups replace
 *  the copy as they always did. PostgREST names a missing function or table by
 *  code; Postgres itself (the harness) by message. */
function isMissing(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" || e.code === "42P01") return true;
  return /could not find the (function|table)|does not exist/i.test(e.message ?? "");
}

/** The account's backup as the server holds it now: the version, the phone
 *  that sent it, when that phone last changed something. */
type Head = { version: number; device: string | null; changedAt: number };
type Backup = Head & { snap: SyncSnapshot; deleted: Tombstone[] };

/** One small row: has another phone backed up since? null on a server without 0057. */
async function fetchBackupHead(userId: string): Promise<Head | null> {
  const { data, error } = await supabase
    .from("backup_state").select("version, device, changed_at, backed_up_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`backup state: ${error.message}`);
  }
  const row = data as Pick<BackupStateRow, "version" | "device" | "changed_at" | "backed_up_at"> | null;
  if (!row) return { version: 0, device: null, changedAt: 0 };
  return {
    version: Number(row.version) || 0,
    device: row.device ?? null,
    changedAt: Date.parse(row.changed_at ?? row.backed_up_at) || 0,
  };
}

/** The whole backup and its version in one read (get_my_backup: one snapshot,
 *  and no 1000-row cap). null on a server without 0057. */
async function fetchBackup(): Promise<Backup | null> {
  const { data, error } = await supabase.rpc("get_my_backup");
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(`pull backup: ${error.message}`);
  }
  const p = data as MyBackupPayload | null;
  if (!p) throw new Error("pull backup: nothing came back");
  // Each program and session under its own id (mappers.snapshotFromRows).
  const { programs, workouts } = snapshotFromRows(p.programs ?? [], p.workouts ?? []);
  return {
    version: Number(p.version) || 0,
    device: p.device ?? null,
    changedAt: Date.parse(p.changed_at ?? p.backed_up_at ?? "") || 0,
    deleted: Array.isArray(p.deleted) ? (p.deleted as Tombstone[]) : [],
    snap: { programs, workouts, journal: journalFromRows(p.journal ?? []), custom: (p.custom ?? []).map(customFromRow) },
  };
}

/**
 * Send `snap` as the account's backup on top of `baseVersion`, the version
 * this phone last saw. Refused with StaleBackupError when another phone's has
 * landed since. Returns the new version, or null from a server without 0057,
 * where it went the old way (replacing, unchecked).
 */
async function sendBackup(
  userId: string,
  snap: SyncSnapshot,
  opts: { baseVersion: number; device: string; deleted: Tombstone[]; changedAt: number },
): Promise<number | null> {
  // Sent as whoever is signed in now: an account switched mid-backup must
  // never be sent this account's copy.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== userId) throw new Error("backup: signed in as someone else");
  const payload = toReplaceUserDataPayload(snap.programs, snap.workouts, snap.journal, snap.custom, userId);
  const { data, error } = await supabase.rpc("replace_user_data", {
    ...payload,
    p_base_version: opts.baseVersion,
    p_device: opts.device,
    p_deleted: opts.deleted,
    p_changed_at: new Date(opts.changedAt || Date.now()).toISOString(),
  });
  if (!error) return Number(data);
  if (/stale backup/i.test(error.message)) throw new StaleBackupError();
  if (!isMissing(error)) throw new Error(`replace_user_data: ${error.message}`);
  const { error: old } = await supabase.rpc("replace_user_data", payload);
  if (old) throw new Error(`replace_user_data: ${old.message}`);
  return null;
}

/** Never let an empty copy replace a backup with things in it unless every
 *  one of them was deleted: an empty phone almost always means "not loaded
 *  yet" or "just cleared for another account", not "deleted everything". */
async function emptyOverFull(userId: string, snap: SyncSnapshot, deleted: Tombstone[], backup: SyncSnapshot | null): Promise<boolean> {
  if (snap.programs.length + snap.workouts.length + snap.journal.length + snap.custom.length > 0) return false;
  if (backup) {
    const gone = new Set(deleted.map(t => `${t.k}|${t.id}`));
    const left = backup.programs.filter(p => !gone.has(`programs|${p.id}`)).length
      + backup.workouts.filter(w => !gone.has(`workouts|${w.id}`)).length
      + backup.journal.filter(j => !gone.has(`journal|${j.id}`)).length
      + backup.custom.length;
    return left > 0;
  }
  return total(await cloudCounts(userId)) > 0;
}

const LIST_KEYS = [PROGRAMS_KEY, WORKOUT_HISTORY_KEY, JOURNAL_KEY, CUSTOM_KEY] as const;

function listFrom(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The four lists a backup holds, as this phone holds them now, with their
 *  fingerprint (one hash of all four, so "nothing changed" is quick). An
 *  unreadable list reads as empty: the merge then finds everything the backup
 *  has gone with no delete, and writes it back. */
async function readLocalCopy(): Promise<{ snap: SyncSnapshot; raw: string }> {
  const raws: (string | null)[] = [];
  for (const key of LIST_KEYS) raws.push(await AsyncStorage.getItem(key));
  return {
    snap: {
      programs: listFrom(raws[0]) as SavedProgram[],
      workouts: listFrom(raws[1]) as CompletedWorkout[],
      journal: listFrom(raws[2]) as JournalEntry[],
      custom: listFrom(raws[3]) as CustomExercise[],
    },
    raw: hashText(raws.map(r => r ?? "").join("\u0000")),
  };
}

/** A merge's changes written on the phone. Each list is read again just
 *  before it's written, and applyChanges leaves alone anything changed in the
 *  meantime (a workout finished while the backup downloaded). The days
 *  trained follow the sessions. Errors are thrown: the backup then fails and
 *  is tried again, rather than going up without what it should have brought. */
async function writeMergeHere(result: MergeResult): Promise<void> {
  const c = result.changes;
  const changed = (k: keyof typeof c) => c[k].put.size > 0 || c[k].drop.size > 0;
  const write = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));
  if (changed("programs")) {
    await write(PROGRAMS_KEY, applyChanges("programs", await getJSON<SavedProgram[]>(PROGRAMS_KEY, []), c.programs));
  }
  if (changed("workouts")) {
    const before = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    const after = applyChanges("workouts", before, c.workouts);
    await write(WORKOUT_HISTORY_KEY, after);
    await write(WORKOUT_DATES_KEY, datesAfter(await getJSON<string[]>(WORKOUT_DATES_KEY, []), before, after));
  }
  if (changed("journal")) {
    await write(JOURNAL_KEY, applyChanges("journal", await getJSON<JournalEntry[]>(JOURNAL_KEY, []), c.journal));
  }
  if (changed("custom")) {
    await write(CUSTOM_KEY, applyChanges("custom", await getJSON<CustomExercise[]>(CUSTOM_KEY, []), c.custom));
  }
  // A program the other phone accepted from a trainer: which send it came
  // from is the phone's own to know, learnt from its origin as after a restore.
  if (changed("programs")) await relinkSharesAfterRestore();
  // The other phone's Assisted switches, and the exercises its programs carry
  // (utils/assisted.ts).
  if (changed("custom") || changed("programs")) await refreshAssisted();
}

/** Why a sync runs. "push": send this phone's changes (merging first if it's
 *  behind). "check": also ask whether another phone backed up, and take its
 *  changes in (the app opening or coming back to the front, Back Up Now).
 *  "replace": this phone's copy becomes the backup, unmerged. */
export type SyncReason = "push" | "check" | "replace";
/** "skipped": nothing could be decided (an import choice still open, a
 *  server without 0057 with nothing owed). */
export type SyncOutcome = "pushed" | "merged" | "upToDate" | "skipped";

/** An account whose sign-in found unclaimed data on the phone and is waiting
 *  on the person's choice (keepDeviceData / replaceWithCloudData): nothing is
 *  merged or sent for it until they've chosen. */
let choosing: string | null = null;

let syncQueue: Promise<unknown> = Promise.resolve();

/**
 * Bring this phone and the account's backup together, one sync at a time:
 * send this phone's changes, and when another phone has backed up since, merge
 * its copy in first. `owed` says this phone has changes the backup hasn't
 * (lib/syncManager.ts BACKUP_OWED_KEY), for a "check" on a server without 0057,
 * where only a backup can be sent.
 */
export function syncBackup(userId: string, reason: SyncReason, opts: { owed?: boolean } = {}): Promise<SyncOutcome> {
  const run = syncQueue.then(() => runSync(userId, reason, opts.owed ?? false), () => runSync(userId, reason, opts.owed ?? false));
  syncQueue = run.catch(() => {});
  return run;
}

async function runSync(userId: string, reason: SyncReason, owed: boolean): Promise<SyncOutcome> {
  if (choosing === userId) return "skipped";
  const device = await deviceId();

  /** The phone's copy as it stands, read in this order: the lists first, then
   *  the deletions, so a delete landing between the two is seen as one (its
   *  tombstone is written before the item goes, utils/syncLocal.ts noteDeleted). */
  const readHere = async () => {
    const copy = await readLocalCopy();
    const deleted = await readTombstones();
    return { ...copy, deleted, changedAt: await readLocalChangedAt() };
  };

  /** What's left once a backup this phone sent (or took) is the latest: the
   *  version, and the copy it was, as the base for the next merge. */
  const seen = async (version: number, snap: SyncSnapshot, raw: string) => {
    await writeSyncState({ uid: userId, version, base: await baseOfInSlices(snap), raw });
    await clearAutoPause();
  };

  if (reason === "replace") {
    const here = await readHere();
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await fetchBackupHead(userId);
      if (await emptyOverFull(userId, here.snap, here.deleted, null)) {
        if (__DEV__) console.warn("[avenas] skipped empty backup over a full one");
        return "skipped";
      }
      try {
        const v = await sendBackup(userId, here.snap, { baseVersion: head?.version ?? 0, device, deleted: here.deleted, changedAt: here.changedAt });
        if (v === null || !head) await clearSyncState();
        else await seen(v, here.snap, here.raw);
        return "pushed";
      } catch (e) {
        if (!(e instanceof StaleBackupError)) throw e;
      }
    }
    throw new StaleBackupError();
  }

  // A backup refused because another phone's landed first: straight to merging.
  let behind = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readSyncState(userId);
    const here = await readHere();

    // Changed since the backup this phone last saw? One hash says no.
    const hereBase = state && here.raw === state.raw ? state.base : await baseOfInSlices(here.snap);
    const unchanged = !!state && (hereBase === state.base || sameBase(hereBase, state.base));
    // An item gone from the phone that no delete explains: something wrote an
    // old list back. The backup still has it: merge, which brings it back.
    let merge = behind || !state || (!unchanged && droppedWithoutDelete(here.snap, state.base, here.deleted) > 0);

    if (!merge && reason === "check") {
      const head = await fetchBackupHead(userId);
      if (!head) return owed ? legacyPush(userId, here) : "skipped";
      if (state && head.version !== state.version) merge = true;
      else if (unchanged) return "upToDate";
    }

    if (!merge && state) {
      if (unchanged) {
        if (here.raw !== state.raw) await writeSyncState({ ...state, raw: here.raw });
        return "upToDate";
      }
      try {
        const v = await sendBackup(userId, here.snap, { baseVersion: state.version, device, deleted: here.deleted, changedAt: here.changedAt });
        if (v === null) { await clearSyncState(); return "pushed"; }
        await writeSyncState({ uid: userId, version: v, base: hereBase, raw: here.raw });
        await clearAutoPause();
        return "pushed";
      } catch (e) {
        if (!(e instanceof StaleBackupError)) throw e;
        // Another phone backed up since: merge its copy in.
      }
    }

    const backup = await fetchBackup();
    if (!backup) return reason === "check" && !owed ? "skipped" : legacyPush(userId, here);
    // The phone's data moved on to another account while this ran: leave it.
    // No owner at all is a phone signed in since before the marker existed
    // (an unclaimed one waiting on its import choice never gets here): its
    // data is this account's, claimed as it merges.
    const owner = await getCacheOwner();
    if (owner !== null && owner !== userId) return "skipped";
    if (owner === null) await setCacheOwner(userId);

    // The backup is this phone's own (its answer lost on the way, or the state
    // that recorded it): then it's what the phone's copy grew from.
    const base = backup.device === device ? await baseOfInSlices(backup.snap) : state?.base ?? null;
    const result = mergeSnapshots({
      local: here.snap,
      remote: backup.snap,
      base,
      localDeleted: here.deleted,
      remoteDeleted: backup.deleted,
      localChangedAt: here.changedAt,
      remoteChangedAt: backup.changedAt,
      // Sent by an app from before 0057 (it says no phone): what it holds
      // differently is old, so only what it adds comes in.
      remoteFromOlderApp: backup.device === null && base !== null,
    });
    undoStaleAutoPause(result, here.snap, backup.snap, await readAutoPause(), AUTO_PAUSE_AFTER_DAYS);
    if (result.changedHere) await writeMergeHere(result);
    await addTombstones(result.deleted);
    if (result.changedHere) emitSyncedDataChanged();

    // What goes up is the phone's copy as it is now, the merge in it.
    const after = await readHere();
    const afterBase = await baseOfInSlices(after.snap);
    const backupBase = await baseOfInSlices(backup.snap);
    if (sameBase(afterBase, backupBase) && sameTombstones(after.deleted, backup.deleted)) {
      await writeSyncState({ uid: userId, version: backup.version, base: backupBase, raw: after.raw });
      await clearAutoPause();
      return "merged";
    }
    if (await emptyOverFull(userId, after.snap, after.deleted, backup.snap)) {
      if (__DEV__) console.warn("[avenas] skipped empty backup over a full one");
      return "skipped";
    }
    try {
      const v = await sendBackup(userId, after.snap, { baseVersion: backup.version, device, deleted: after.deleted, changedAt: after.changedAt });
      if (v === null) { await clearSyncState(); return "pushed"; }
      await writeSyncState({ uid: userId, version: v, base: afterBase, raw: after.raw });
      await clearAutoPause();
      return "merged";
    } catch (e) {
      if (!(e instanceof StaleBackupError)) throw e;
      // Yet another backup landed while this one merged: again.
      behind = true;
    }
  }
  throw new StaleBackupError();
}

/** A server without 0057: the whole copy replaces the backup, as before it. */
async function legacyPush(userId: string, here: { snap: SyncSnapshot; deleted: Tombstone[]; changedAt: number }): Promise<SyncOutcome> {
  if (await emptyOverFull(userId, here.snap, here.deleted, null)) {
    if (__DEV__) console.warn("[avenas] skipped empty backup over a full one");
    return "skipped";
  }
  await sendBackup(userId, here.snap, { baseVersion: 0, device: await deviceId(), deleted: here.deleted, changedAt: here.changedAt });
  await clearSyncState();
  return "pushed";
}

// Which user the local AsyncStorage cache currently belongs to. Used to detect
// account switches so one account's data never leaks into another.
export const CACHE_OWNER_KEY = "@avenas/cache_owner";

/** `true` while this phone holds changes its account's backup doesn't have yet:
 *  set by every scheduled backup, cleared by one that went through
 *  (lib/syncManager.ts). Saved, so a backup that couldn't go (no signal) is
 *  still owed after the app closes. Cleared with the account's data. */
export const BACKUP_OWED_KEY = "@avenas/backup_owed";

export async function getCacheOwner(): Promise<string | null> {
  return getJSON<string | null>(CACHE_OWNER_KEY, null);
}
export async function setCacheOwner(userId: string): Promise<void> {
  await setJSON(CACHE_OWNER_KEY, userId);
}

/**
 * Permanently delete the signed-in user's account: the server RPC removes their
 * auth user (which cascades to all their cloud data), then we wipe the local
 * cache and sign out.
 */
export async function deleteAccount(): Promise<void> {
  // The profile photo lives in the public "avatars" Storage bucket, which the
  // auth.users cascade never reaches, so it stayed reachable by its link after
  // the account was gone (and the Privacy Policy promises it's deleted). Removed
  // FIRST, while this session still owns the folder the storage policy checks.
  // Best effort: a failure here must never block the deletion the user asked for.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error: photoError } = await supabase.storage.from("avatars").remove([`${user.id}/avatar`]);
      if (photoError && __DEV__) console.warn("[avenas] delete avatar", photoError.message);
      // Same reason for the custom exercise photos and videos sent with programs.
      await deleteMyExerciseMedia(user.id);
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] delete avatar", e);
  }
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw new Error(error.message);
  // Server-side push_tokens rows are already gone (FK cascade from the deleted
  // auth user); this clears the locally-cached token so the next account on
  // this device starts clean. Best effort by design.
  await unregisterPushToken();
  await clearLocalUserData();
  await removeKey(CACHE_OWNER_KEY);
  await signOutHere();
}

/** Wipe the locally-cached user data + in-progress drafts (not auth/theme/unit).
 *  Includes the local-only trainer-hub data (roster, coaches, trainers, shared/
 *  sent programs, chat threads, block list) so one account's data never leaks
 *  into the next account on this device when deleting or switching accounts. */
export async function clearLocalUserData(): Promise<void> {
  // In memory, not storage: the Progress page's remembered selections name this
  // account's programs and clients.
  clearProgressSessions();
  await Promise.all([
    removeKey(PROGRAMS_KEY),
    removeKey(WORKOUT_HISTORY_KEY),
    removeKey(WORKOUT_DATES_KEY),
    removeKey(JOURNAL_KEY),
    removeKey(CUSTOM_KEY),
    removeKey(EXERCISE_MEDIA_UPLOADS_KEY),
    removeKey(WORKOUT_DRAFT_KEY),
    removeKey(WORKOUT_DAY_OVERRIDE_KEY),
    // It names this account's workout, which the next account doesn't have.
    removeKey(UNFINISHED_NOTICE_KEY),
    // What was owed was this account's; the next account's data comes from
    // its own backup.
    removeKey(BACKUP_OWED_KEY),
    // Local-only, but it describes THIS account's training: the next account on
    // the device mustn't inherit its PR cards or its already-earned milestones.
    removeKey(ACHIEVEMENTS_KEY),
    // What this account's imports added, to undo them: the next account's
    // history has none of it.
    removeKey(IMPORT_LOG_KEY),
    // The backup this account was last merged with, its deletions, its last
    // change, its last automatic hold (utils/syncLocal.ts). The install's own
    // id stays: it's the phone's, not the account's.
    ...SYNC_ACCOUNT_KEYS.map(removeKey),
    clearTrainerData(),
    clearChatData(),
    clearModerationData(),
  ]);
}

/** Thrown when an account switch can't download the new account's data. The
 *  switch is aborted with local storage untouched; the caller should cancel the
 *  sign-in (sign back out) and tell the user, instead of leaving a wiped device. */
export class AccountSwitchLoadError extends Error {
  constructor(cause: string) {
    super(`account switch: ${cause}`);
    this.name = "AccountSwitchLoadError";
  }
}

export type ReconcileResult =
  | "kept"           // same account — local kept, merged with its backup
  | "replaced"       // different account — local replaced with its cloud data
  | "import_choice"; // unclaimed local data found — the UI must ask the user (see below)

/**
 * Reconcile the local cache to the signed-in account:
 *   - same account as before → keep local edits and merge them with the
 *     account's backup (syncBackup "check"): what another phone backed up
 *     meanwhile comes in, and an empty side is filled from the other
 *   - unclaimed local data (no cache owner yet: a pre-backend install or an
 *     upgrade from before the owner marker) → return "import_choice" WITHOUT
 *     touching anything. It may be months of this very user's offline training,
 *     so the caller asks whether to keep it (keepDeviceData) or replace it with
 *     the account's cloud copy (useCloudData). Never silently wiped, and
 *     nothing is merged or backed up for the account until they've chosen.
 *   - any other account → download that account's cloud snapshot FIRST, and
 *     only then clear local and write it. A failed download throws
 *     AccountSwitchLoadError with the device untouched.
 */
export async function reconcileOnSignIn(userId: string): Promise<ReconcileResult> {
  const owner = await getCacheOwner();
  if (owner === userId) {
    await syncBackup(userId, "check");
    return "kept";
  }

  if (owner === null && total(await localCounts()) > 0) {
    choosing = userId;
    return "import_choice";
  }

  let fetched: { snap: CloudSnapshot; backup: Backup | null };
  try {
    fetched = await fetchAllFromCloud(userId);
  } catch (e) {
    throw new AccountSwitchLoadError(e instanceof Error ? e.message : String(e));
  }
  await clearLocalUserData();
  await writeSnapshotToLocal(fetched.snap);
  await setCacheOwner(userId);
  await recordBackupTaken(userId, fetched.backup);
  return "replaced";
}

/** "import_choice" resolution: keep what's on the device. Claims the cache for
 *  this account and uploads it, so the cloud mirrors what the user chose. */
export async function keepDeviceData(userId: string): Promise<void> {
  await setCacheOwner(userId);
  if (choosing === userId) choosing = null;
  await pushAllLocalDataToCloud(userId);
}

/** "import_choice" resolution: discard the on-device data and use the account's
 *  cloud copy. Fetch-first, so a failed download leaves the device untouched.
 *  (Not `use`-prefixed — it would read as a React hook.) */
export async function replaceWithCloudData(userId: string): Promise<void> {
  const { snap, backup } = await fetchAllFromCloud(userId);
  await clearLocalUserData();
  await writeSnapshotToLocal(snap);
  await setCacheOwner(userId);
  await recordBackupTaken(userId, backup);
  if (choosing === userId) choosing = null;
}

// ── per-account profile (name + role + unit) ───────────────────────────────────
export type CloudProfile = {
  name: string;
  accountType: AccountType;
  unit: "kg" | "lb";
  /** Public URL of the profile photo, or null when none is set. */
  avatarUrl: string | null;
  /** True once the user has finished the name/role step for this account. */
  complete: boolean;
  /** Reachable address when the login identifier isn't one (Apple "Hide My
   *  Email" accounts). Null when unset — most accounts never need it. */
  contactEmail: string | null;
};

// App uses "gym_user"/"pt" + "kg"/"lbs"; the DB column is "user"/"pt" + "kg"/"lb".
const toDbAccountType = (a: AccountType): "user" | "pt" => (a === "pt" ? "pt" : "user");
const toAppAccountType = (a: string | null): AccountType => (a === "pt" ? "pt" : "gym_user");

export async function pushProfile(
  userId: string,
  p: { name: string; email: string; accountType: AccountType; unit: "kg" | "lb" },
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({
      name: p.name,
      email: p.email,
      account_type: toDbAccountType(p.accountType),
      unit: p.unit,
      onboarding_complete: true,
    })
    .eq("id", userId);
  if (error) throw new Error(`save profile: ${error.message}`);
}

/** Update just the self-declared role on this account's profile. Separate from
 *  pushProfile (the onboarding write) so the Profile screen's Member/Trainer
 *  toggle can change this one column. Requires migration 0015 — before that, the
 *  0008 trigger rejected any account_type change once onboarding completed. */
export async function pushAccountType(userId: string, accountType: AccountType): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ account_type: toDbAccountType(accountType) })
    .eq("id", userId);
  if (error) throw new Error(`save account type: ${error.message}`);
}

/** Write this account's kg/lb preference (profiles.unit), which a trainer reads
 *  to show a client's numbers in the client's unit (migration 0036). Called on
 *  every Settings toggle. No-op when signed out; fails soft, since the next
 *  launch's reconcileUnit tries again. */
export async function pushUnit(unit: "kg" | "lb"): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from("profiles").update({ unit }).eq("id", uid);
    if (error) throw new Error(error.message);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] pushUnit", e);
  }
}

/**
 * Make the server's unit match the one this device uses. Before this build the
 * Settings toggle never reached the cloud, so a trainer would read whatever was
 * chosen at sign-up. Only a unit the person actually CHOSE is pushed: with
 * nothing saved the app is on its kg default, and pushing that from a fresh
 * install would overwrite someone's "lb".
 */
export async function reconcileUnit(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(UNIT_KEY);
    if (saved !== "kg" && saved !== "lbs") return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = saved === "kg" ? "kg" : "lb";
    const profile = await pullProfile(user.id);
    if (!profile || profile.unit === local) return;
    await pushUnit(local);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] reconcileUnit", e);
  }
}

/**
 * Make the server's account_type match the one this device is actually using.
 *
 * The Member/Trainer toggle in Profile was local-only for a long time, so any
 * account that switched to Trainer after onboarding kept `account_type = 'user'`
 * in the cloud. That column is what every OTHER account sees through
 * get_my_connections(), so such a trainer appeared to their connections as a
 * member and could never be bucketed as a trainer (utils/roster.ts). This runs
 * on launch and on every foreground to repair the drift. The local value wins:
 * it's the one the user actually sees in the app.
 *
 * No-ops when signed out, offline, mid-onboarding, or already in sync.
 */
export async function reconcileAccountType(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = await AsyncStorage.getItem(ACCOUNT_TYPE_KEY);
    if (local !== "pt" && local !== "gym_user") return;
    const profile = await pullProfile(user.id);
    if (!profile?.complete || profile.accountType === local) return;
    await pushAccountType(user.id, local);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] reconcileAccountType", e);
  }
}

/**
 * Tear down everything that only exists because this account was a TRAINER,
 * for a Trainer → Gym User downgrade.
 *
 * Deliberately narrower than clearTrainerData(), which wipes both sides of the
 * hub for an account switch. What survives here is everything the user keeps as
 * a gym user: their own trainers (derived from connections, so untouched),
 * programs they've RECEIVED and accepted, their library, and their membership
 * of other people's groups.
 *
 * What goes:
 *   - the local client roster and each client's cached data
 *   - trainers they had taken on as clients
 *   - groups they OWN (deleted for every member, since nobody else can run them)
 *   - programs they SENT (recipients keep any copy they already accepted)
 *
 * Lives here rather than in trainerStore because lib/groups.ts imports that
 * module, so the dependency has to run this direction.
 *
 * Local removal happens first and unconditionally; the cloud steps are
 * best-effort per item, so one failure can't strand the rest half-done. Since
 * migration 0041 the server's change_account_type has already done the cloud
 * half (and disconnected gym-user clients, withdrawn waiting reviews and left
 * everyone a note), so here it finds nothing left; it stays for a server
 * without 0041, where the switch is a bare column write.
 */
export async function clearCoachingData(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const clientData = allKeys.filter(k => k.startsWith(CLIENT_DATA_PREFIX));
  // The filings too (a gym account files nothing; the server dropped its copy
  // in change_account_type, migration 0041).
  await AsyncStorage.multiRemove([CLIENTS_KEY, TRAINER_CLIENTS_KEY, CONNECTION_ROLES_KEY, PT_SEEDED_KEY, ...clientData]);

  // Local share entries: drop the ones I SENT, keep what a trainer sent me.
  try {
    const local = await getJSON<{ receivedFromCoachId?: string }[]>(SHARED_PROGRAMS_KEY, []);
    await setJSON(SHARED_PROGRAMS_KEY, local.filter(s => !!s.receivedFromCoachId));
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData local shares", e);
  }

  const uid = await getMyUid();
  if (!uid) return; // signed out: the local wipe above is all we can do

  try {
    for (const g of (await fetchMyGroups(uid)).filter(g => g.isOwner)) {
      try {
        await deleteGroup(g.id);
      } catch (e) {
        if (__DEV__) console.warn("[avenas] clearCoachingData group", g.id, e);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData groups", e);
  }

  try {
    const rows = await fetchMyShareRows(uid);
    for (const r of rows.filter(r => r.sender_id === uid && r.kind === "share")) {
      try {
        await deleteShareRow(r.id);
      } catch (e) {
        if (__DEV__) console.warn("[avenas] clearCoachingData share", r.id, e);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn("[avenas] clearCoachingData shares", e);
  }
}

/** Update just the display name on this account's profile. */
export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ name }).eq("id", userId);
  if (error) throw new Error(error.message);
}

/** Start an email change. Supabase emails a confirmation link to the new address;
 *  the change only takes effect once that link is clicked. */
export async function updateEmail(newEmail: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
  if (error) throw new Error(error.message);
}

/** Change the signed-in user's password. We re-verify the current password first
 *  by re-signing in (updateUser trusts the session alone, so this proves the
 *  person at the keyboard actually knows the old password). On success the user
 *  stays signed in with a fresh session. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email;
  if (!email) throw new Error("You need to be signed in to change your password.");

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) throw new Error("Your current password is incorrect.");

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function pullProfile(userId: string): Promise<CloudProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, account_type, unit, avatar_url, onboarding_complete, contact_email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`load profile: ${error.message}`);
  if (!data) return null;
  return {
    name: (data.name as string | null) ?? "",
    accountType: toAppAccountType(data.account_type as string | null),
    unit: (data.unit as string) === "lb" ? "lb" : "kg",
    avatarUrl: (data.avatar_url as string | null) ?? null,
    complete: data.onboarding_complete === true,
    contactEmail: (data.contact_email as string | null) ?? null,
  };
}

/**
 * Set (or clear, with null) the account's contact address.
 *
 * Deliberately NOT supabase.auth.updateUser({ email }): that changes the LOGIN
 * identifier and needs a confirm-link round trip. This is a plain profile field
 * — the address to reach someone on when their login email can't be, which is
 * exactly the Apple "Hide My Email" case. See migration 0017.
 */
export async function updateContactEmail(userId: string, email: string | null): Promise<void> {
  const value = email?.trim() ? email.trim() : null;
  const { error } = await supabase.from("profiles").update({ contact_email: value }).eq("id", userId);
  if (error) throw new Error(`save contact email: ${error.message}`);
}

/**
 * Upload (or replace) the signed-in user's profile photo and return its public
 * URL. The object lives at "<userId>/avatar" so each upload overwrites the last
 * one (upsert) — no orphaned files. A cache-busting query param is appended so
 * expo-image refetches after a replace instead of showing the stale cached copy.
 *
 * `fetch(localUri).then(r => r.arrayBuffer())` is the dependency-free way to read
 * a local file into bytes in Expo/React Native (the Supabase RN guide's pattern).
 */
export async function uploadAvatar(userId: string, localUri: string, mimeType?: string): Promise<string> {
  const bytes = await fetch(localUri).then((r) => r.arrayBuffer());
  const path = `${userId}/avatar`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType: mimeType ?? "image/jpeg", upsert: true });
  if (error) throw new Error(`upload avatar: ${error.message}`);
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/** Persist (or clear) the avatar URL on this account's profile row. */
export async function updateAvatarUrl(userId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) throw new Error(error.message);
}
