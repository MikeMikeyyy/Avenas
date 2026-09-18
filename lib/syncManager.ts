// Automatic cloud backup scheduler.
//
// The cloud copy is only useful if it tracks local changes. Screens call
// scheduleCloudPush() after any data-bearing local write; this debounces a burst
// of writes into a single atomic push (lib/cloud.pushAllLocalDataToCloud →
// replace_user_data RPC) ~DEBOUNCE_MS later, while the app is still foregrounded
// and the network is available (the most reliable moment to push).
//
// flushCloudPush() pushes immediately and is used on app background/inactive as
// a safety net for changes that happened in the last debounce window.
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

import { supabase } from "./supabase";
import { getCacheOwner, pushAllLocalDataToCloud } from "./cloud";
import { getJSON, setJSON } from "../utils/storage";

const DEBOUNCE_MS = 2500;

/** `{ uid, at }` of this device's last successful backup. Keyed to the account
 *  so a switch never shows the previous account's time. Local-only. */
export const LAST_BACKUP_KEY = "@avenas/last_backup";
type LastBackup = { uid: string; at: number };

let timer: ReturnType<typeof setTimeout> | null = null;
let current: Promise<PushOutcome> | null = null;
let rearm = false;

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

async function doPush(): Promise<PushOutcome> {
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return "skipped";
    const owner = await getCacheOwner();
    // owner === null means a pre-backend / not-yet-reconciled cache; reconcile
    // sets it on sign-in, so treat a mismatch (not absence) as "don't push".
    if (owner !== null && owner !== uid) return "skipped";
    await pushAllLocalDataToCloud(uid);
    lastBackup = { uid, at: Date.now() };
    lastBackupLoaded = true;
    // setJSON swallows its own errors: the status is a convenience, never a
    // reason to report a push that succeeded as failed.
    await setJSON(LAST_BACKUP_KEY, lastBackup);
    return "pushed";
  } catch (e) {
    if (__DEV__) console.warn("[avenas] cloud auto-push", e);
    return "failed";
  }
}

function runPush(): Promise<PushOutcome> {
  if (current) {
    // A change arrived while a push was in flight — re-arm so it isn't lost.
    rearm = true;
    return current;
  }
  running = true;
  emit();
  current = doPush().then((outcome) => {
    current = null;
    running = false;
    // A skip says nothing about whether the account's data is safe, so it
    // leaves an earlier failure showing rather than quietly clearing it.
    if (outcome === "pushed") lastFailed = false;
    if (outcome === "failed") lastFailed = true;
    emit();
    if (rearm) {
      rearm = false;
      scheduleCloudPush();
    }
    return outcome;
  });
  return current;
}

export type BackupStatus = {
  /** "backing_up" while a push runs; "failed" when the last real attempt did. */
  state: "idle" | "backing_up" | "failed";
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
  return {
    state: running ? "backing_up" : lastFailed ? "failed" : "idle",
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
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runPush();
  }, DEBOUNCE_MS);
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
 *  "Backed up" when nothing was sent. */
export async function backUpNow(): Promise<PushOutcome> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  return runPush();
}
