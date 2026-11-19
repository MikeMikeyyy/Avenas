// The Progress tab's way back (utils/progressReturn.ts): what View Progress and
// See All Progress hold is the tab that was under them and every page open
// over it, bottom to top, with their params as they can be put back; nothing
// when no page is open; a way back shows only for the visit it was held for;
// the page Back opens slides from the left only while it carries the marker;
// a route's name opens it again as its path; and the back button rests and
// holds at the dock's left, where the page put it (utils/filterDock.ts).
//
// Run:  npx tsx scripts/verify-progress-return.ts
// Exits non-zero if any assertion fails.

import {
  RETURN_TRIP_PARAM, dropProgressReturn, heldProgressReturn, holdProgressReturn, isReturnTrip, pagePathname,
  pagesOverTabs, returnFromState, stackWithTabs, topPage, type NavState,
} from "../utils/progressReturn";
import { DOCK_ITEM, dockLeadSlot, pinBox } from "../utils/filterDock";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else failures.push(`✗ ${label}`);
}

const tabs = (showing: string): NavState["routes"][number] => ({
  name: "(tabs)",
  state: { index: ["home", "workout", "progress", "trainer-hub"].indexOf(showing), routes: ["home", "workout", "progress", "trainer-hub"].map(name => ({ name })) },
});
/** Expo Router's root: its own slot over the app's Stack. */
const rooted = (stack: NavState): NavState => ({ index: 0, routes: [{ name: "__root", state: stack }] });

// ─── What's held: the tab under, and the pages over it ──────────────────────
{
  const root = rooted({ index: 1, routes: [tabs("home"), { name: "programs", params: {} }] });
  eq(returnFromState(root, "1"), { at: "1", tab: "home", pages: [{ name: "programs", params: {} }] }, "My Programs over Home: Home, then My Programs");
  ok(stackWithTabs(root) !== null, "the app's Stack is found under Expo Router's own root");

  const deep = rooted({
    index: 3,
    routes: [
      tabs("trainer-hub"),
      { name: "journal" },
      { name: "workout-detail", params: { id: "w1", edit: "1" } },
      { name: "exercise-history", params: { exerciseName: "Bench Press", customId: undefined, n: 3, tags: ["a", "b"] } },
    ],
  });
  eq(returnFromState(deep, "2"), {
    at: "2", tab: "trainer-hub",
    pages: [
      { name: "journal", params: {} },
      { name: "workout-detail", params: { id: "w1", edit: "1" } },
      { name: "exercise-history", params: { exerciseName: "Bench Press", tags: ["a", "b"] } },
    ],
  }, "every page, bottom to top, its strings and lists of strings kept, nothing else");

  const marked = rooted({ index: 1, routes: [tabs("home"), { name: "programs", params: { [RETURN_TRIP_PARAM]: "9", a: "x" } }] });
  eq(returnFromState(marked, "3")?.pages[0].params, { a: "x" }, "a page opened by Back loses the slide's marker when held again");

  const upTo = rooted({ index: 1, routes: [tabs("home"), { name: "programs" }, { name: "new-program" }] });
  eq(returnFromState(upTo, "4")?.pages.map(p => p.name), ["programs"], "only up to the page showing");

  eq(returnFromState(rooted({ index: 0, routes: [tabs("progress")] }), "5"), null, "no page over the tabs: nothing to go back to");
  eq(returnFromState(undefined, "6"), null, "no state: nothing held");
  eq(returnFromState(rooted({ index: 1, routes: [{ name: "(tabs)" }, { name: "programs" }] }), "7")?.tab, null, "tabs not yet read: no tab to put back, the pages still");
}

// ─── Where the stack stands now ─────────────────────────────────────────────
{
  const two = rooted({ index: 2, routes: [tabs("home"), { name: "journal" }, { name: "exercise-history", params: { [RETURN_TRIP_PARAM]: "8" } }] });
  eq(pagesOverTabs(two), 2, "two pages over the tabs");
  eq(topPage(two)?.name, "exercise-history", "the one showing on top");
  eq(pagesOverTabs(rooted({ index: 0, routes: [tabs("home")] })), 0, "none over the tabs");
  eq(topPage(rooted({ index: 0, routes: [tabs("home")] })), null, "no page on top when the tabs show");
}

// ─── One way back, for the visit it was held for ────────────────────────────
{
  holdProgressReturn({ at: "100", tab: "home", pages: [{ name: "programs", params: {} }] });
  eq(heldProgressReturn([undefined, "100"])?.at, "100", "shown for the visit whose `at` the tab's params carry");
  eq(heldProgressReturn(["99", undefined]), null, "never for another visit (a tap that never got there)");
  dropProgressReturn();
  eq(heldProgressReturn(["100"]), null, "gone once the tab's been left");
}

// ─── The slide from the left, and the path back ─────────────────────────────
{
  ok(isReturnTrip({ [RETURN_TRIP_PARAM]: "5" }), "a page carrying the marker slides in from the left");
  ok(!isReturnTrip({ [RETURN_TRIP_PARAM]: undefined }) && !isReturnTrip({}) && !isReturnTrip(undefined), "cleared, its back slides the usual way");
  eq(
    ["programs", "trainer/client/[id]", "trainer/group/[id]/index", "index"].map(pagePathname),
    ["/programs", "/trainer/client/[id]", "/trainer/group/[id]", "/"],
    "a route's name opens it as its path, an index file as its folder's",
  );
}

// ─── The back button in the dock: at its rest at the top, held at the left ──
{
  const small = { w: DOCK_ITEM, h: DOCK_ITEM };
  const top = 59 + 8;
  const slot = dockLeadSlot(small, top, 20, DOCK_ITEM);
  eq(slot, { x: 20, y: top, w: DOCK_ITEM, h: DOCK_ITEM }, "its slot: the page's left margin, on the row");
  eq(dockLeadSlot(small, top, 20, 56).y, top + 8, "centred on a taller row");
  const rest = { x: 20, y: 59 + 50, w: DOCK_ITEM, h: DOCK_ITEM };
  eq(pinBox(rest, slot, 0, 0), rest, "at the top of the page, exactly where the title row puts it");
  eq(pinBox(rest, slot, 400, 1), slot, "scrolled down, held at the row's left");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ the Progress tab's way back holds where you were");
