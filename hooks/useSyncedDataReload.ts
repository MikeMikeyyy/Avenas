// hooks/useSyncedDataReload.ts
//
// Read a screen's data again when a merge with the account's other phone has
// changed it on this one (utils/syncEvents.ts). Every screen that keeps
// programs, sessions or journal entries it saves back from what it holds must
// use it, or its next save writes the other phone's changes away.

import { useEffect, useRef } from "react";
import { onSyncedDataChanged } from "../utils/syncEvents";

export function useSyncedDataReload(reload: () => void): void {
  // The latest reload, kept after each render, so the listener added once
  // always runs the screen's current one.
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; });
  useEffect(() => onSyncedDataChanged(() => latest.current()), []);
}
