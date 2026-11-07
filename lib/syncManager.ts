// Automatic cloud backup scheduler.
//
// The cloud copy is only useful if it tracks local changes. Screens call
// scheduleCloudPush() after any data-bearing local write; this debounces a burst
// of writes into a single backup (lib/cloud.ts syncBackup → replace_user_data
// RPC) ~DEBOUNCE_MS later, while the app is still foregrounded and the network
// is available (the most reliable moment to push). A backup goes on top of the
// one this phone last saw, so when the account's other phone has backed up
// since, it merges that one in first (migration 0057, user decision
// 2026-11-07); nothing changed since the last one, nothing is sent.
//
// flushCloudPush() pushes immediately and is used on app background/inactive as
// a safety net for changes that happened in the last debounce window.
// catchUpWithBackup() also asks whether the other phone backed up, and takes
// its changes in: the app opening, coming back to the front, the signal back.
//
// Guards:
//   - only pushes when a user is signed in
//   - only pushes when the local cache belongs to the signed-in user (never
//     uploads one account's data under another right after a switch)
//   - serialises pushes; a write that lands mid-push re-arms one afterwards.
//
// It also keeps the backup STATUS that Settings > Data & Sync shows: whether a
// push is running, whether the last real attempt failed, and when this account
// last backed up. Failures used to be silent, so a device could sit offline for
// days holding data the cloud didn't, with nothing on screen to say so.
//
// A backup that can't go is OWED (BACKUP_OWED_KEY, saved on the phone): every
// scheduled push sets it and only one that went through clears it. A workout
// logged with no signal used to be retried only if the signal came back with
// the app still open; closed first, the app forgot, and the cloud and a
// trainer's view went without it until the next change (user report,
// 2026-10-14). pushOwedBackup now sends it a moment after the next launch and
// whenever the signal comes back.

import { supabase } from "./supabase";
import { BACKUP_OWED_KEY, getCacheOwner, syncBackup, type SyncReason } from "./cloud";
import { getJSON, removeKey, setJSON } from "../utils/storage";
import { noteLocalChange } from "../utils/syncLocal";

const DEBOUNCE_MS = 2500;

/** `{ uid, at }` of this device's last successful backup. Keyed to the account
 *  so a switch never shows the previous account's time. Local-only. */
export const LAST_BACKUP_KEY = "@avenas/last_backup";
type LastBackup = { uid: string; at: number };

let timer: ReturnType<typeof setTimeout> | null = null;
let current: Promise<PushOutcome> | null = null;
let rearm = false;
/** A check asked for while a backup was on its way: run once that's done. */
let rearmCheck = false;
// Bumped by every scheduled push, so a push clears the owed flag only when
// nothing changed while it ran (the push re-armed after it does that).
let changes = 0;

/** "skipped" = nothing to push for the signed-in account (signed out, or the
 *  cache belongs to another account). It is neither a backup nor a failure. */
export type PushOutcome = "pushed" | "skipped" | "failed";

// ── Backup status ───────────────────────────────────────────────────────────
let running = false;
let lastFailed = false;
let lastBackup: LastBackup | null = null;
let lastBackupLoaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

async function doPush(reason: SyncReason): Promise<PushOutcome> {
  const changesAtStart = changes;
  const owed = await getJSON<boolean>(BACKUP_OWED_KEY, false);
  try {
    const { data, error } = await supabase.auth.getSession();
    // No signal and a token over an hour old: supabase-js can't renew it, and
    // answers with an error and no session. That's a backup that couldn't go,
    // not a phone nobody is signed in on. Taken for a skip, it was never
    // retried and let a sign-out past its backup check (lib/auth.ts).
    if (error) return reason === "check" && !owed ? "skipped" : "failed";
    const uid = data.session?.user.id;
    if (!uid) return "skipped";
    const owner = await getCacheOwner();
    // owner === null means a pre-backend / not-yet-reconciled cache; reconcile
    // sets it on sign-in, so treat a mismatch (not absence) as "don't push".
    if (owner !== null && owner !== uid) return "skipped";
    const outcome = await syncBackup(uid, reason, { owed });
    if (outcome === "skipped") return "skipped";
    if (changes === changesAtStart) await removeKey(BACKUP_OWED_KEY);
    lastBackup = { uid, at: Date.now() };
    lastBackupLoaded = true;
    // setJSON swallows its own errors: the status is a convenience, never a
    // reason to report a push that succeeded as failed.
    await setJSON(LAST_BACKUP_KEY, lastBackup);
    return "pushed";
  } catch (e) {
    if (__DEV__) console.warn("[avenas] cloud auto-push", e);
    // A look for the other phone's changes that couldn't be made, with nothing
    // of this phone's waiting, leaves the backup as it was: no failure to show.
    return reason === "check" && !owed ? "skipped" : "failed";
  }
}

function runPush(reason: SyncReason = "push"): Promise<PushOutcome> {
  if (current) {
    // A change arrived while a push was in flight — re-arm so it isn't lost.
    rearm = true;
    if (reason === "check") rearmCheck = true;
    return current;
  }
  running = true;
  emit();
  current = doPush(reason).then((outcome) => {
    current = null;
    running = false;
    // A skip says nothing about whether the account's data is safe, so it
    // leaves an earlier failure showing rather than quietly clearing it.
    if (outcome === "pushed") lastFailed = false;
    if (outcome === "failed") lastFailed = true;
    emit();
    if (rearm) {
      rearm = false;
      const check = rearmCheck;
      rearmCheck = false;
      if (check) void runPush("check");
      else armPush();
    }
    return outcome;
  });
  return current;
}

export type BackupStatus = {
  /** "backing_up" while a push runs; "failed" when the last real attempt did;
   *  "waiting" while a change hasn't reached the cloud (about to go, or owed
   *  from before the app closed). */
  state: "idle" | "backing_up" | "failed" | "waiting";
  /** When `uid` last backed up from this device (epoch ms), or null if never. */
  lastBackupAt: number | null;
};

/** The backup status for `uid`, loading the stored last-backup time once. */
export async function getBackupStatus(uid: string): Promise<BackupStatus> {
  if (!lastBackupLoaded) {
    const stored = await getJSON<LastBackup | null>(LAST_BACKUP_KEY, null);
    // A push that finished during the read already set a newer value.
    if (!lastBackupLoaded) lastBackup = stored;
    lastBackupLoaded = true;
  }
  const owed = await getJSON<boolean>(BACKUP_OWED_KEY, false);
  return {
    state: running ? "backing_up" : lastFailed ? "failed" : owed ? "waiting" : "idle",
    lastBackupAt: lastBackup && lastBackup.uid === uid ? lastBackup.at : null,
  };
}

/** Called whenever the backup status may have changed. Returns an unsubscribe. */
export function subscribeBackupStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Debounce a cloud push. Call after any local data write. */
export function scheduleCloudPush(): void {
  changes += 1;
  // Owed from this moment, on the phone: if the push can't go, or the app
  // closes before it does, the next launch still sends it.
  void setJSON(BACKUP_OWED_KEY, true).then(emit);
  // When, for a merge with the account's other phone: an item both changed
  // takes the version changed last (utils/syncMerge.ts).
  void noteLocalChange();
  armPush();
}

/** The debounced push itself, for a change already counted. */
function armPush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runPush();
  }, DEBOUNCE_MS);
}

/** Push if this phone holds a change the cloud doesn't: a workout logged with
 *  no signal, maybe before the app was closed. Run a moment after launch and
 *  whenever the signal comes back (app/_layout.tsx); leaving the app pushes
 *  regardless (flushCloudPush). Nothing to do while a push is on its way. */
export async function pushOwedBackup(): Promise<void> {
  if (current || timer) return;
  if (!lastFailed && !(await getJSON<boolean>(BACKUP_OWED_KEY, false))) return;
  if (current || timer) return; // one started while the flag was read
  void runPush();
}

/** Push now (cancelling any pending debounce). Used on app background/inactive. */
export function flushCloudPush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void runPush();
}

/** Await an immediate push (cancelling any pending debounce). Used before
 *  sign-out. Resolves true when the account's data is safe (pushed, or nothing
 *  to push), false when the push failed — the caller decides whether signing
 *  out is still acceptable. */
export async function flushCloudPushNow(): Promise<boolean> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return (await runPush()) !== "failed";
}

/** Back up right now for the Data & Sync screen's "Back Up Now". Unlike
 *  flushCloudPushNow, a skip is reported as such: the screen must not say
 *  "Backed up" when nothing was sent. Asks after the other phone too, so it
 *  never says "Backed up" over a backup this phone hasn't taken in. */
export async function backUpNow(): Promise<PushOutcome> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return runPush("check");
}

/** Take in what the account's other phone backed up since this one last saw
 *  the backup, and send this phone's changes with it: as the app opens, comes
 *  back to the front, and gets its signal back (app/_layout.tsx). One small
 *  read when there's nothing new; offline or signed out, nothing happens and
 *  no failure shows unless a backup is owed. */
export function catchUpWithBackup(): Promise<PushOutcome> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return runPush("check");
}
