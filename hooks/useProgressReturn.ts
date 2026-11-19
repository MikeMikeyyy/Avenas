// hooks/useProgressReturn.ts
//
// The Progress tab's way back (utils/progressReturn.ts): held by View Progress
// and See All Progress as they go, shown by the tab for that visit, and Back
// opening the pages again.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useIsFocused, useNavigation, useNavigationContainerRef, useRouter, type Href } from "expo-router";

import {
  PROGRESS_TAB, RETURN_TRIP_PARAM, dropProgressReturn, heldProgressReturn, holdProgressReturn, pagePathname,
  pagesOverTabs, returnFromState, topPage, type NavState, type ProgressReturn,
} from "../utils/progressReturn";

/** A little over the slide the page Back opens comes in with: then the tab
 *  goes back under it, unseen, and its slide is cleared. */
const SETTLE_MS = 600;
/** How long the Progress page keeps its button once it's left, so it never
 *  vanishes (and the title jumps) on a page still sliding out of view. */
const LINGER_MS = 600;

/** For View Progress / See All Progress: holds the way back to the stack as it
 *  stands, for the visit with this `at`, just before they go. */
export function useHoldProgressReturn(): (at: string | undefined) => void {
  const navRef = useNavigationContainerRef();
  return useCallback((at: string | undefined) => {
    if (!at) return;
    holdProgressReturn(returnFromState(navRef.getRootState() as unknown as NavState | undefined, at));
  }, [navRef]);
}

/** On the Progress tab: Back for this visit, or null with no way back held.
 *  `ats`: the `at` of each request its params carry. */
export function useProgressReturn(ats: readonly (string | undefined)[]): (() => void) | null {
  const router = useRouter();
  const navigation = useNavigation();
  const navRef = useNavigationContainerRef();
  const isFocused = useIsFocused();
  const [trip, setTrip] = useState<ProgressReturn | null>(null);
  const atsKey = ats.map(a => a ?? "").join("|");

  // Shown: whenever the tab comes into view, the way back held for the visit
  // its params ask for (none once it's been left, as that lets it go). No
  // cleanup here: new params while it's in view must never let it go.
  useFocusEffect(useCallback(() => {
    setTrip(heldProgressReturn(atsKey.split("|")));
  }, [atsKey]));

  // Left, any way: the way back goes, and the button with it once the page
  // is out of view.
  useEffect(() => {
    if (isFocused) return;
    dropProgressReturn();
    const id = setTimeout(() => setTrip(null), LINGER_MS);
    return () => clearTimeout(id);
  }, [isFocused]);

  // The visit Back was last taken for: the button stays drawn while the page
  // slides in over it, and a second tap mustn't open the pages twice.
  const taken = useRef<string | null>(null);

  const back = useCallback(() => {
    if (!trip || taken.current === trip.at) return;
    taken.current = trip.at;
    dropProgressReturn();
    // Bottom to top, in one go: only the top one slides in, from the left.
    trip.pages.forEach((p, i) => {
      const params = i === trip.pages.length - 1 ? { ...p.params, [RETURN_TRIP_PARAM]: trip.at } : p.params;
      router.push({ pathname: pagePathname(p.name), params } as unknown as Href);
    });
    setTimeout(() => {
      const root = navRef.getRootState() as unknown as NavState | undefined;
      // The tab they were over back under them, so their own back lands
      // there; not if they've been backed out of already (it would switch
      // the tab in view). A jump, never a navigate: a navigate to a tab
      // closes every page over the tabs.
      if (trip.tab && trip.tab !== PROGRESS_TAB && pagesOverTabs(root) > 0) {
        navigation.dispatch({ type: "JUMP_TO", payload: { name: trip.tab } });
      }
      // In: its own back slides the usual way.
      const top = topPage(root);
      const marked = (top?.params as Record<string, unknown> | undefined)?.[RETURN_TRIP_PARAM];
      if (marked === trip.at) router.setParams({ [RETURN_TRIP_PARAM]: undefined } as never);
    }, SETTLE_MS);
  }, [trip, router, navigation, navRef]);

  return trip ? back : null;
}
