// utils/syncEvents.ts
//
// "The account's other phone changed things, and they're on this phone now":
// told by lib/cloud.ts after a merge writes what the backup brought in. A
// screen reads its programs, sessions and entries once (and again on focus),
// so one already open would show the old ones, and a screen that saves the
// list it holds (My Programs, the Journal, the archive) would write the other
// phone's changes away. Those screens, and the tabs, read again on this
// (hooks/useSyncedDataReload.ts).

type Listener = () => void;
const listeners = new Set<Listener>();

export function onSyncedDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitSyncedDataChanged(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch (e) {
      if (__DEV__) console.warn("[avenas] synced data listener", e);
    }
  }
}
