// utils/progressReturn.ts
//
// The Progress tab's way back (user request and picks, 2026-11-19: "if i click
// something like view progress, it takes me to the progress page from wherever
// I clicked it, yet there is no back button"). View Progress on My Programs
// and See All Progress on Exercise History close the pages they're on to reach
// the tab (`dismissTo`: a second copy of the tabs is never pushed), so before
// going each holds here the tab that was under them and the pages open over
// it, the stack as it stood (hooks/useProgressReturn.ts).
//
// While the Progress tab shows that visit it has a back button, before its
// title (components/progress/ProgressView.tsx `onBack`). Back opens those pages
// again, the top one sliding in from the left as going back does (the root
// Stack's `animation` for a route carrying RETURN_TRIP_PARAM, cleared once it's
// in so its own back slides the usual way), then puts the tab they were over
// back under them, so their own back lands where it did. Leaving the Progress
// tab any way (another tab, another page) lets the way back go, so the button
// is gone when you come back (user pick, the same day).
//
// The reading of the navigation state is pure, so it's checked without the app
// (scripts/verify-progress-return.ts).

/** The navigation state as far as it's read here: a navigator's routes, the
 *  one showing, and each route's own navigator when it has one. */
export type NavState = {
  index?: number;
  routes: readonly { name: string; params?: object; state?: NavState }[];
};

/** A page to open again: its route's name in the root Stack and its params. */
export type ReturnPage = { name: string; params: Record<string, string | string[]> };

export type ProgressReturn = {
  /** The request's `at` (utils/progressSession.ts): the visit it's for. */
  at: string;
  /** The tab that was under the pages; null when it couldn't be read. */
  tab: string | null;
  /** Bottom to top: the pages that were open over the tabs. */
  pages: ReturnPage[];
};

/** The tabs' route in the root Stack. */
export const TABS_ROUTE = "(tabs)";
/** The tab that shows the way back. */
export const PROGRESS_TAB = "progress";
/** On the page opened by Back, while it slides in: the root Stack gives a route
 *  carrying it the slide from the left. Its value is the visit's `at`. */
export const RETURN_TRIP_PARAM = "returnTrip";

/** The navigator holding the tabs and the pages over them: the first one, down
 *  the routes showing, that has the tabs among its routes. */
export function stackWithTabs(root: NavState | undefined): NavState | null {
  let state = root;
  while (state) {
    if (state.routes.some(r => r.name === TABS_ROUTE)) return state;
    const showing = state.routes[state.index ?? state.routes.length - 1];
    state = showing?.state;
  }
  return null;
}

/** A route's params as they can be put back: its strings and lists of strings,
 *  never the slide's own marker. */
function plainParams(params: object | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (k === RETURN_TRIP_PARAM) continue;
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.every(x => typeof x === "string")) out[k] = [...v];
  }
  return out;
}

/** The way back from the stack as it stands now: the tab showing under the
 *  pages and the pages over it, up to the one showing. Null with no page over
 *  the tabs (nothing to go back to). */
export function returnFromState(root: NavState | undefined, at: string): ProgressReturn | null {
  const stack = stackWithTabs(root);
  if (!stack) return null;
  const tabsAt = stack.routes.findIndex(r => r.name === TABS_ROUTE);
  const top = stack.index ?? stack.routes.length - 1;
  const pages = stack.routes.slice(tabsAt + 1, top + 1).map(r => ({ name: r.name, params: plainParams(r.params) }));
  if (pages.length === 0) return null;
  const tabs = stack.routes[tabsAt].state;
  const tab = tabs ? tabs.routes[tabs.index ?? 0]?.name ?? null : null;
  return { at, tab, pages };
}

/** How many pages are open over the tabs now. */
export function pagesOverTabs(root: NavState | undefined): number {
  const stack = stackWithTabs(root);
  if (!stack) return 0;
  const tabsAt = stack.routes.findIndex(r => r.name === TABS_ROUTE);
  const top = stack.index ?? stack.routes.length - 1;
  return Math.max(0, top - tabsAt);
}

/** The page showing at the top of the root Stack, when it's a page. */
export function topPage(root: NavState | undefined): { name: string; params?: object } | null {
  const stack = stackWithTabs(root);
  if (!stack || pagesOverTabs(root) === 0) return null;
  return stack.routes[stack.index ?? stack.routes.length - 1] ?? null;
}

/** A root Stack route's name as the path that opens it: an index file is its
 *  folder's path ("trainer/group/[id]/index" is /trainer/group/[id]). */
export function pagePathname(name: string): string {
  return `/${name.replace(/(^|\/)index$/, "")}`;
}

/** Whether a route is the page Back is opening, still sliding in. */
export function isReturnTrip(params: object | undefined): boolean {
  const v = (params as Record<string, unknown> | undefined)?.[RETURN_TRIP_PARAM];
  return typeof v === "string" && v !== "";
}

// ── The one way back held, for the app's run ────────────────────────────────

let held: ProgressReturn | null = null;

/** Held by View Progress / See All Progress just before they go. */
export function holdProgressReturn(trip: ProgressReturn | null): void {
  held = trip;
}

/** The way back for the visit the Progress tab's params ask for (the `at` of
 *  either request): one held for an earlier tap, or a tap that never got
 *  there, never shows. */
export function heldProgressReturn(ats: readonly (string | undefined)[]): ProgressReturn | null {
  return held && ats.includes(held.at) ? held : null;
}

/** Let go as the Progress tab is left. */
export function dropProgressReturn(): void {
  held = null;
}
