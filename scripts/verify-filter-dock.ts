// The Progress page's filter dock (utils/filterDock.ts): at the top of the page
// every button is exactly where it rests on the page, on the Progress tab and
// on a trainer's client page (whose filters rest just under the row); in the
// row once merged; following the scroll smoothly between, with no bounce; the
// corner button held in its corner; and a page let go part way glides to the
// nearer end.
//
// Run:  npx tsx scripts/verify-filter-dock.ts
// Exits non-zero if any assertion fails.

import {
  DOCK_GAP, DOCK_ITEM, DOCK_MERGE, bigFaceOpacity, dockSlots, mergeBox, mergeProgress, mergeSpan, pinBox,
  settleTarget, smallFaceOpacity, type Box,
} from "../utils/filterDock";

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
const near = (a: Box, b: Box, e = 1e-6) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.w - b.w) < e && Math.abs(a.h - b.h) < e;

const W = 390;
const RIGHT = W - 20;
const small = { w: DOCK_ITEM, h: DOCK_ITEM };

/** A page's three buttons at scroll `s`, as the dock draws them. */
function draw(rests: { prog: Box; range: Box; pin: Box }, top: number, s: number) {
  const slots = dockSlots([small, small, small], top, RIGHT);
  const spans = [rests.prog, rests.range].map(r => mergeSpan(r.y, slots[0].y));
  const p = spans.map(sp => mergeProgress(s, sp.from, sp.to));
  return {
    prog: mergeBox(rests.prog, slots[0], s, p[0]),
    range: mergeBox(rests.range, slots[1], s, p[1]),
    pin: pinBox(rests.pin, slots[2], s, Math.max(p[0], p[1])),
    slots, spans, p,
  };
}

// ─── The row ───────────────────────────────────────────────────────────────
{
  const slots = dockSlots([small, small, small], 67, RIGHT);
  eq(slots.map(b => [b.x, b.y, b.w, b.h]), [[234, 67, 40, 40], [282, 67, 40, 40], [330, 67, 40, 40]],
    "row: three 40s right-aligned 20 in, 8 apart, Compare last");
  eq(dockSlots([{ w: 120, h: 40 }, { w: 100, h: 56 }, small], 10, RIGHT).map(b => b.y), [18, 10, 18], "row: a taller one sets the row, the others centred on it");
  ok(DOCK_GAP === 8 && DOCK_MERGE === 110, "row: the gap and the merge distance the mockup settled on");
}

// ─── The Progress tab: title, Compare beside it, the filters under ─────────
{
  const insetsTop = 59;
  const top = insetsTop + 8;
  const rests = {
    pin: { x: 330, y: insetsTop + 50, w: 40, h: 40 },                 // Compare, in the title row
    prog: { x: 20, y: insetsTop + 116, w: 214, h: 40 },               // the program filter
    range: { x: 246, y: insetsTop + 116, w: 124, h: 40 },             // the time range
  };
  const at0 = draw(rests, top, 0);
  ok(near(at0.prog, rests.prog) && near(at0.range, rests.range) && near(at0.pin, rests.pin),
    "tab: at the top of the page every button is exactly where it rests");
  const pulled = draw(rests, top, -40);
  ok(near(pulled.prog, { ...rests.prog, y: rests.prog.y + 40 }) && near(pulled.pin, { ...rests.pin, y: rests.pin.y + 40 }),
    "tab: pulled down past the top, they move with the page, unmerged");
  const done = draw(rests, top, 400);
  ok(near(done.prog, done.slots[0]) && near(done.range, done.slots[1]) && near(done.pin, done.slots[2]),
    "tab: scrolled well down, each is in its place in the row");
  const end = at0.spans[0].to;
  ok(near(draw(rests, top, end).prog, at0.slots[0]), "tab: the merge ends just as the filters' rest reaches the row");
  eq(at0.spans[0], { from: 0, to: 108 }, "tab: the filters merge over the first 108 of scroll (all of it, from the top)");
  // Compare: with the page, then held in its corner, never above it.
  ok(Math.abs(draw(rests, top, 20).pin.y - (rests.pin.y - 20)) < 1e-6, "tab: Compare scrolls with the page until it reaches the row");
  for (let s = 0; s <= 300; s += 7) ok(draw(rests, top, s).pin.y >= top - 1e-6, `tab: Compare never goes above the row (scroll ${s})`);
  ok(Math.abs(draw(rests, top, 60).pin.y - top) < 1e-6, "tab: and holds there");
  // Smooth: no jumps, merged-ness only ever grows with the scroll, never past 1.
  let prev = draw(rests, top, 0);
  let smooth = true;
  let monotonic = true;
  for (let s = 0.5; s <= 200; s += 0.5) {
    const now = draw(rests, top, s);
    for (const k of ["prog", "range", "pin"] as const) {
      const a = prev[k], b = now[k];
      if (Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2 || Math.abs(a.w - b.w) > 2.5) smooth = false;
    }
    if (now.p[0] < prev.p[0] - 1e-9 || now.p[0] > 1) monotonic = false;
    prev = now;
  }
  ok(smooth, "tab: half a point of scroll never moves a button more than a couple of points (no jumps)");
  ok(monotonic, "tab: merged-ness only grows as the page scrolls down, and never overshoots (no bounce)");
  // And back: scrolling up returns them along the same path.
  ok(near(draw(rests, top, 50).prog, draw(rests, top, 50).prog) && near(draw(rests, top, 0).prog, rests.prog), "tab: back at the top, back at rest");
}

// ─── A trainer's client page: Compare at the top, the filters just under ───
{
  const top = 2;                                     // the row: where Compare already rests
  const rests = {
    pin: { x: 330, y: 2, w: 40, h: 40 },
    prog: { x: 20, y: 54, w: 214, h: 40 },
    range: { x: 246, y: 54, w: 124, h: 40 },
  };
  const at0 = draw(rests, top, 0);
  ok(near(at0.prog, rests.prog) && near(at0.range, rests.range) && near(at0.pin, rests.pin),
    "client: at the top of the page every button is exactly where it rests (a short way from the row, still unmerged)");
  eq(at0.spans[0], { from: 0, to: 52 }, "client: the merge takes the 52 of scroll there is, from the top");
  ok(near(draw(rests, top, 52).prog, at0.slots[0]), "client: merged as the filters reach the row");
  ok(near(draw(rests, top, 30).pin, rests.pin), "client: Compare never moves (it rests in its corner)");
  ok(draw(rests, top, 10).p[0] > 0 && draw(rests, top, 10).p[0] < 1, "client: part way, part merged");
}

// ─── Comparing: the two programs merge in turn, the lower one later ────────
{
  const top = 67;
  const green = mergeSpan(240, top);
  const blue = mergeSpan(298, top);
  ok(green.to < blue.to, "comparing: the lower program's row merges later");
  ok(mergeProgress(green.to, green.from, green.to) === 1 && mergeProgress(green.to, blue.from, blue.to) < 1, "comparing: green is in the row while blue is still on its way");
}

// ─── Let go part way: glide to the nearer end ──────────────────────────────
{
  eq(settleTarget(30, 0, 108), 0, "settle: under half merged, back to the page");
  eq(settleTarget(70, 0, 108), 108, "settle: over half, on into the row");
  eq([settleTarget(0, 0, 108), settleTarget(108, 0, 108), settleTarget(300, 0, 108)], [null, null, null], "settle: at either end or past it, nothing to do");
  eq(settleTarget(5, 0, 0), null, "settle: nothing to merge, nothing to do");
}

// ─── The faces: words fade out, then the icon in ───────────────────────────
{
  eq([bigFaceOpacity(0), bigFaceOpacity(0.5), smallFaceOpacity(0.45), smallFaceOpacity(1)], [1, 0, 0, 1], "faces: words gone by half way, the icon in by the end");
  ok(bigFaceOpacity(0.25) > 0 && smallFaceOpacity(0.7) > 0 && smallFaceOpacity(0.7) < 1, "faces: each fades, never pops");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ the filter dock holds its places");
