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
let pushing = false;
let queuedWhilePushing = false;

async function runPush(): Promise<void> {
  if (pushing) {
    // A change arrived while a push was in flight — re-arm so it isn't lost.
    queuedWhilePushing = true;
    return;
  }
  pushing = true;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    const owner = await getCacheOwner();
    // owner === null means a pre-backend / not-yet-reconciled cache; reconcile
    // sets it on sign-in, so treat a mismatch (not absence) as "don't push".
    if (owner !== null && owner !== uid) return;
    await pushAllLocalDataToCloud(uid);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] cloud auto-push", e);
  } finally {
    pushing = false;
    if (queuedWhilePushing) {
      queuedWhilePushing = false;
      scheduleCloudPush();
    }
  }
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

/** Await an immediate push (cancelling any pending debounce). Used before sign-out
 *  so the current account's latest local data reaches the cloud while we're still
 *  authenticated. Resolves even if nothing is pushed (e.g. cache-owner mismatch). */
export async function flushCloudPushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await runPush();
}
