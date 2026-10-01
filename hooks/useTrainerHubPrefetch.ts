// Loads the Trainer tab in the background shortly after launch, so it's up to
// date by the time it's opened: its data (utils/trainerHub.ts) and the two
// badges on it (Messages, Connect). Also brings this phone's blocks and the
// server's into line (utils/moderation.ts:syncBlocks), and asks a trainer how
// to file any fellow trainer they've connected with and not placed yet
// (utils/connectionRolePrompt.ts).
//
// AFTER startup, never part of it. The splash and Home wait on nothing here: it
// starts a couple of seconds after the tabs mount, once Home has done its own
// launch reads, and every read in it is async, so nothing is held up while it
// runs. Opening the tab before it finishes costs nothing either: the tab shows
// the copy saved last time and its own load joins this one.
//
// Skipped until the community terms are accepted, since until then the tab
// shows the agreement and nothing else.

import { useEffect, useRef } from "react";
import { useAccountType } from "../contexts/AccountTypeContext";
import { useAuth } from "../contexts/AuthContext";
import { useOffline } from "../contexts/ConnectivityContext";
import { hasAcceptedCommunityTerms, syncBlocks } from "../utils/moderation";
import { prefetchTrainerHub } from "../utils/trainerHub";
import { flushPendingShareUnlinks } from "../utils/trainerStore";
import { importLegacyTrainerClients } from "../lib/connectionRoles";
import { promptUndecidedConnectionRoles } from "../utils/connectionRolePrompt";
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
          syncBlocks(),
          // This phone's old "also my client" list, carried to the server once
          // (lib/connectionRoles.ts). Before the question below, so a trainer
          // already filed that way isn't asked about.
          accountType === "pt" ? importLegacyTrainerClients() : Promise.resolve(),
        ]);
        if (cancelled) return;
        // Any trainer connection not yet filed as trainer / client / both,
        // including a request I sent that was accepted since I last looked.
        // After everything above, so the question never holds up the hub.
        if (await promptUndecidedConnectionRoles(accountType)) {
          await prefetchTrainerHub(accountType, owner);
        }
      })().catch(err => {
        if (__DEV__) console.warn("[avenas] prefetch trainer hub", err);
      });
    }, PREFETCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountType, owner]);

  // Back online: whatever waited to reach the server goes now (a copy of a
  // trainer's program deleted with no signal, so the trainer's page stops
  // calling it accepted; a block made with no signal, so it severs and takes
  // them out of my groups). Only on the change back, never at launch: the
  // prefetch above does both then.
  const offline = useOffline();
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (wasOffline.current && !offline) {
      flushPendingShareUnlinks().catch(err => {
        if (__DEV__) console.warn("[avenas] send waiting share notices", err);
      });
      void syncBlocks();
    }
    wasOffline.current = offline;
  }, [offline]);
}
