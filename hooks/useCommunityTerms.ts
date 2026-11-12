// Whether this account has agreed to the community guidelines on this phone
// (utils/agreements.ts), re-rendering the moment it does, so every screen
// waiting on it opens together: agreeing on a chat a notification opened also
// opens the pages under it, and the Trainer tab.

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { hasAcceptedCommunityTerms, peekCommunityTermsAccepted, subscribeCommunityTerms } from "../utils/agreements";

/** Null until read off the phone. `enabled` false skips the read, for a
 *  screen that turns out not to need it. */
export function useCommunityTermsAccepted(owner: string, enabled = true): boolean | null {
  const read = useCallback(() => peekCommunityTermsAccepted(owner), [owner]);
  const accepted = useSyncExternalStore(subscribeCommunityTerms, read, read);
  useEffect(() => {
    if (enabled && accepted === null) void hasAcceptedCommunityTerms(owner);
  }, [enabled, accepted, owner]);
  return accepted;
}
