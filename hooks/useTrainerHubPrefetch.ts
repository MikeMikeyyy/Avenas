// Loads the Trainer tab in the background shortly after launch, so it's up to
// date by the time it's opened: its data (utils/trainerHub.ts) and the two
// badges on it (Messages, Connect).
//
// AFTER startup, never part of it. The splash and Home wait on nothing here: it
// starts a couple of seconds after the tabs mount, once Home has done its own
// launch reads, and every read in it is async, so nothing is held up while it
// runs. Opening the tab before it finishes costs nothing either: the tab shows
// the copy saved last time and its own load joins this one.
//
// Skipped until the community terms are accepted, since until then the tab
// shows the agreement and nothing else.

import { useEffect } from "react";
import { useAccountType } from "../contexts/AccountTypeContext";
import { useAuth } from "../contexts/AuthContext";
import { hasAcceptedCommunityTerms } from "../utils/moderation";
import { prefetchTrainerHub } from "../utils/trainerHub";
import { warmUnreadMessages } from "./useUnreadMessages";
import { warmConnectionPresence } from "./useConnectionPresence";

/** How long after the tabs mount to start: past Home's own launch work, and
 *  still well before most people reach the Trainer tab. */
const PREFETCH_DELAY_MS = 2000;

export function useTrainerHubPrefetch(): void {
  const { accountType } = useAccountType();
  const { userId } = useAuth();
  const owner = userId ?? "";

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!(await hasAcceptedCommunityTerms()) || cancelled) return;
        await Promise.all([
          prefetchTrainerHub(accountType, owner),
          warmUnreadMessages(accountType, owner),
          warmConnectionPresence(owner),
        ]);
      })().catch(err => {
        if (__DEV__) console.warn("[avenas] prefetch trainer hub", err);
      });
    }, PREFETCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountType, owner]);
}
