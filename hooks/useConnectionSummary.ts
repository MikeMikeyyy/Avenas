// This account's connection count as the phone knows it (utils/connectionSummary.ts),
// re-rendering when a read changes it: Home's Connect card goes the moment the
// Connect page, or the Trainer tab's load, finds someone.

import { useCallback, useSyncExternalStore } from "react";

import type { ConnectionSummary } from "../utils/connectPrompt";
import { peekConnectionSummary, subscribeConnectionSummary } from "../utils/connectionSummary";

/** Null until known: never read, or a different account's copy. */
export function useConnectionSummary(owner: string): ConnectionSummary | null {
  const read = useCallback(() => peekConnectionSummary(owner), [owner]);
  return useSyncExternalStore(subscribeConnectionSummary, read, read);
}
