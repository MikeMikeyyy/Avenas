// utils/pageSnapshot.ts
//
// The last copy of a trainer-area page this account saw, so the page opens on
// it instead of on a spinner or an empty page that fills in over the few
// seconds its network reads take. The page then refreshes in the background
// and updates in place. Used by the Trainer tab's two hubs (utils/trainerHub.ts)
// and by each group's page (utils/groupPage.ts).
//
// Held in memory for this launch and written to the device for the next one,
// one storage key per page. Every copy is stamped with its OWNER (the account
// id, "" when signed out), and a read for anyone else finds nothing, so a
// different account on this phone never opens onto the previous one's
// clients. A version stamp does the same for a copy written by an older build
// whose shape no longer matches.
//
// Deliberately ignorant of what a snapshot holds: that lives with each page's
// loader, and keeping it out of here is what lets trainerStore's
// clearTrainerData call into this module without an import cycle.

import AsyncStorage from "@react-native-async-storage/async-storage";

export const PT_HUB_SNAPSHOT_KEY = "@avenas/pt/hub_snapshot";
export const GYM_HUB_SNAPSHOT_KEY = "@avenas/gym/hub_snapshot";
/** One key per group: `@avenas/group_page/<groupId>`. */
export const GROUP_PAGE_SNAPSHOT_PREFIX = "@avenas/group_page/";

/** Whether a storage key holds one of these copies (for clearTrainerData). */
export const isPageSnapshotKey = (key: string): boolean =>
  key === PT_HUB_SNAPSHOT_KEY || key === GYM_HUB_SNAPSHOT_KEY || key.startsWith(GROUP_PAGE_SNAPSHOT_PREFIX);

/** Bump when a page's data shape changes, so an old copy reads as absent rather
 *  than rendering with fields missing. */
const SNAPSHOT_VERSION = 1;

type Envelope = { v: number; owner: string; data: unknown };

const memory = new Map<string, Envelope>();
/** Exactly what's on disk, so saving an unchanged page doesn't rewrite it. */
const onDisk = new Map<string, string>();

const warn = (op: string, key: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] page snapshot", op, key, err);
};

/** This launch's copy, synchronously, or null when there isn't one for `owner`. */
export function peekSnapshot<T>(key: string, owner: string): T | null {
  const e = memory.get(key);
  return e && e.owner === owner ? (e.data as T) : null;
}

/**
 * Load the saved copy from the device into memory, so `peekSnapshot` can hand
 * it to a screen on its first render. A no-op once this launch has a copy.
 */
export async function hydrateSnapshot(key: string, owner: string): Promise<void> {
  if (peekSnapshot(key, owner)) return;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return;
    const e = JSON.parse(raw) as Envelope;
    if (e?.v !== SNAPSHOT_VERSION || e.owner !== owner) return;
    // A save that landed while this was reading is newer than the disk: keep it.
    if (peekSnapshot(key, owner)) return;
    memory.set(key, e);
    onDisk.set(key, raw);
  } catch (err) {
    warn("read", key, err);
  }
}

/**
 * Record what the page now shows: in memory at once, on disk when it differs.
 * `forDisk` is what the device keeps of it, when that's less than the whole
 * (the program lists keep only what their cards draw); a copy read back from
 * disk is that reduced form.
 */
export function saveSnapshot<T>(key: string, owner: string, data: T, forDisk: (data: T) => unknown = d => d): void {
  // The same object again (a load's result, then the screen rendering it) is
  // already recorded: skip the serialising, which grows with the page.
  const held = memory.get(key);
  if (held && held.owner === owner && held.data === data) return;
  memory.set(key, { v: SNAPSHOT_VERSION, owner, data });
  let raw: string;
  try {
    raw = JSON.stringify({ v: SNAPSHOT_VERSION, owner, data: forDisk(data) });
  } catch (err) {
    warn("serialise", key, err);
    return;
  }
  if (onDisk.get(key) === raw) return;
  AsyncStorage.setItem(key, raw)
    .then(() => { onDisk.set(key, raw); })
    .catch(err => warn("write", key, err));
}

/** Throw one page's copy away, in memory and on disk: the page it described no
 *  longer exists for this account (a group left, deleted, or taken away). */
export function dropSnapshot(key: string): void {
  memory.delete(key);
  onDisk.delete(key);
  AsyncStorage.removeItem(key).catch(err => warn("remove", key, err));
}

/** Drop every copy from memory. The disk keys are removed alongside the rest
 *  of the trainer data (trainerStore.clearTrainerData, via isPageSnapshotKey). */
export function forgetSnapshots(): void {
  memory.clear();
  onDisk.clear();
}
