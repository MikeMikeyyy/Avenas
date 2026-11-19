// utils/filterDock.ts
//
// The Progress page's filter dock (user request and picks, 2026-11-15, the
// Progress Filter Dock mockup): as the page scrolls, the big buttons at its top
// (the program and time-range filters, and Compare; comparing, the two
// programs and ✕) merge into a row of small ones pinned at the top of the page,
// so a filter is in reach wherever you are on it. Compare (or ✕) stays in its
// corner once it reaches the row, and the others shrink and glide up beside
// it, following the scroll with no bounce (the user turned the bouncy version
// down), finishing as they reach the row. Scrolled back up, they grow back into
// the page.
//
// **At the top of the page every button is exactly where it rests on the page**
// (user requirement: "make sure the buttons in their main form start and
// return to where they are now"): a button's merge starts no earlier than the
// top of the page, so at scroll 0 (and above it, pulled down) it's at its rest,
// however close to the row it rests (a trainer's client page has its filters
// just under the row). `scripts/verify-filter-dock.ts` holds it to that.
//
// Boxes are in the page's frame: x from the page's left edge, y from its top
// as the scroll view shows it; a button's rest is where it sits in the scroll
// content (its y at scroll 0). Pure; the functions the dock's animated styles
// call are worklets.

export type Box = { x: number; y: number; w: number; h: number };

/** A small button: the size of every round button on the page (Compare's
 *  circle), so the glass keeps its round ends (radius half this) throughout. */
export const DOCK_ITEM = 40;
/** Between two small buttons. */
export const DOCK_GAP = 8;
/** How much scroll a button takes to merge (the mockup's 110, which the user
 *  approved), less where it rests closer to the row than that. */
export const DOCK_MERGE = 110;
/** Below the status bar, the row's top on the Progress tab. */
export const DOCK_TOP_GAP = 8;

/** The small row's boxes, in order, right-aligned at `right`, each `sizes[i]`
 *  big, their tops at `top` (a shorter one centred on the row's height). */
export function dockSlots(sizes: readonly { w: number; h: number }[], top: number, right: number, gap = DOCK_GAP): Box[] {
  const total = sizes.reduce((s, z) => s + z.w, 0) + gap * Math.max(0, sizes.length - 1);
  const rowH = sizes.reduce((m, z) => Math.max(m, z.h), 0);
  let x = right - total;
  return sizes.map(z => {
    const box = { x, y: top + (rowH - z.h) / 2, w: z.w, h: z.h };
    x += z.w + gap;
    return box;
  });
}

/** The left corner's box (the Progress tab's back, utils/progressReturn.ts):
 *  at the page's left margin, centred on the row's height as a shorter one in
 *  the row is. It's held there as the right corner's is (`pinBox`). */
export function dockLeadSlot(size: { w: number; h: number }, top: number, left: number, rowH: number): Box {
  return { x: left, y: top + (Math.max(rowH, size.h) - size.h) / 2, w: size.w, h: size.h };
}

/** The scroll over which a button merges: it ends as the button's rest
 *  reaches its slot, and starts `range` before that, never before the top of
 *  the page. */
export function mergeSpan(restY: number, slotY: number, range = DOCK_MERGE): { from: number; to: number } {
  "worklet";
  const to = Math.max(0, restY - slotY);
  return { from: Math.max(0, to - range), to };
}

/** How far a button has merged at scroll `s`, eased in and out: 0 at its rest,
 *  1 in the row. At or above the top of the page, 0. */
export function mergeProgress(s: number, from: number, to: number): number {
  "worklet";
  if (s <= 0 || to <= 0) return 0;
  if (s >= to) return 1;
  if (s <= from) return 0;
  const t = (s - from) / (to - from);
  return t * t * (3 - 2 * t);
}

const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

/** A merging button at scroll `s`, merged `p`: from where it rests on the
 *  page (moving with it) to its slot in the row. */
export function mergeBox(rest: Box, slot: Box, s: number, p: number): Box {
  "worklet";
  return {
    x: lerp(rest.x, slot.x, p),
    y: lerp(rest.y - s, slot.y, p),
    w: lerp(rest.w, slot.w, p),
    h: lerp(rest.h, slot.h, p),
  };
}

/** The corner button (Compare, or ✕ while comparing): with the page until it
 *  reaches the row, then held there; its size and place eased into its slot as
 *  the others merge (`p`, the furthest merged of them). */
export function pinBox(rest: Box, slot: Box, s: number, p: number): Box {
  "worklet";
  const h = lerp(rest.h, slot.h, p);
  return {
    x: lerp(rest.x, slot.x, p),
    y: Math.max(rest.y - s, slot.y + (slot.h - h) / 2),
    w: lerp(rest.w, slot.w, p),
    h,
  };
}

/** Where to glide to when the page is let go part way through a merge (`from`
 *  and `to`, the last button's): the end, or back to the start, whichever it's
 *  nearer. Null when it isn't part way. */
export function settleTarget(s: number, from: number, to: number): number | null {
  if (to <= from) return null;
  const t = (s - from) / (to - from);
  if (t <= 0.02 || t >= 0.98) return null;
  return t >= 0.5 ? to : from;
}

/** Words on the big button fade as it shrinks; the small one's icon comes in
 *  over the second half. */
export function bigFaceOpacity(p: number): number {
  "worklet";
  return Math.min(1, Math.max(0, 1 - p / 0.5));
}
export function smallFaceOpacity(p: number): number {
  "worklet";
  return Math.min(1, Math.max(0, (p - 0.45) / 0.55));
}
