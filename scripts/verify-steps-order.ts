// A custom exercise's steps, moved by dragging one (utils/stepOrder.ts, which
// components/StepsEditor.tsx runs): steps differ in height, so the place a
// held step has reached is worked out from each one's height, not a row's.
//
// Run:  npx tsx scripts/verify-steps-order.ts

import { moveItem, placeReached, slideFor } from "../utils/stepOrder";

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

// Three steps: one line, three lines, one line (middles at 25, 100 and 175).
const heights = [50, 100, 50];

eq(placeReached(heights, 0, 0), 0, "held and not moved, it stays in its place");
eq(placeReached(heights, 0, 74), 0, "the first, short of the tall second's middle, stays first");
eq(placeReached(heights, 0, 76), 1, "past the tall second's middle, it's second");
eq(placeReached(heights, 0, 151), 2, "past the last's middle, it's last");
eq(placeReached(heights, 0, 900), 2, "dragged far past the end, it's last");
eq(placeReached(heights, 2, -76), 1, "the last, up past the tall second's middle, is second");
eq(placeReached(heights, 2, -151), 0, "up past the first's middle, it's first");
eq(placeReached(heights, 2, -900), 0, "dragged far past the top, it's first");
eq(placeReached(heights, 1, 0), 1, "the tall one, held still, stays put");
eq(placeReached(heights, 1, 76), 2, "the tall one, past the last's middle, is last");

// The rows making room: those between where it was and where it's reached.
eq([0, 1, 2].map(i => slideFor(i, 0, 2)), [0, -1, -1], "the first dragged to the end: the others each slide up a place");
eq([0, 1, 2].map(i => slideFor(i, 2, 0)), [1, 1, 0], "the last dragged to the top: the others each slide down a place");
eq([0, 1, 2].map(i => slideFor(i, 1, 1)), [0, 0, 0], "not moved: nothing slides");

// The new order, which is what's saved.
eq(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"], "the first moved to the end");
eq(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"], "the last moved to the top");
eq(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"], "moved to its own place, nothing changes");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
