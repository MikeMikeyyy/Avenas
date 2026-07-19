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

import { supabase } from "./supabase";
import { getCacheOwner, pushAllLocalDataToCloud } from "./cloud";

const DEBOUNCE_MS = 2500;

let timer: ReturnType<typeof setTimeout> | null = null;
let current: Promise<boolean> | null = null;
let rearm = false;

// True = the account's data is safe to abandon (pushed, or there was nothing to
// push for it: signed out / another account's cache). False = the push FAILED,
// so this device holds data the cloud doesn't.
async function doPush(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return true;
    const owner = await getCacheOwner();
    // owner === null means a pre-backend / not-yet-reconciled cache; reconcile
    // sets it on sign-in, so treat a mismatch (not absence) as "don't push".
    if (owner !== null && owner !== uid) return true;
    await pushAllLocalDataToCloud(uid);
    return true;
  } catch (e) {
    if (__DEV__) console.warn("[avenas] cloud auto-push", e);
    return false;
  }
}

function runPush(): Promise<boolean> {
  if (current) {
    // A change arrived while a push was in flight — re-arm so it isn't lost.
    rearm = true;
    return current;
  }
  current = doPush().then((ok) => {
    current = null;
    if (rearm) {
      rearm = false;
      scheduleCloudPush();
    }
    return ok;
  });
  return current;
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
  return runPush();
}
