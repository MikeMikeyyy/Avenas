// utils/exerciseChartLayout.ts
//
// Where the Progress page's exercise chart (components/ExerciseProgressionChart
// .tsx, drawn by components/progress/ExerciseChartPlot.tsx) puts things. Three
// tabs, one kind of chart each (user decision, 2026-10-12): Strength, a line of
// each session's top set; Sets, each session's working sets stacked by their
// reps; Volume, a bar per session. Every session has a slot of the same width,
// numbered from 1 (the Nth time the exercise was done on that day: a shared
// axis for comparing one run of a program with another, user decision,
// 2026-10-13). Past what fits, the row scrolls sideways and opens on the
// newest, and the y-axis fits the sessions on screen. Pure, so the training
// simulation checks every dot, block and bar lands inside the chart for every
// number of sessions and every phone width (scripts/harness/training/
// checks.ts). The path builders are worklets too: the plot eases them to a new
// axis on the UI thread.

import { niceAxis, type NiceAxis } from "./niceAxis";
import type { ExerciseDataPoint, ExerciseMetricKey } from "../constants/progress";

export function isExerciseMetric(v: unknown): v is ExerciseMetricKey {
  return v === "strength" || v === "sets" || v === "volume";
}

// ─── What each tab draws ─────────────────────────────────────────────────────

/** A session's reps across its working sets (a hold's seconds): the height
 *  of its stack on Sets. */
export function setsTotal(p: ExerciseDataPoint): number {
  return p.sets.reduce((n, s) => n + s.reps, 0);
}

/** A session's value on a tab: its top set's weight on Strength, the kilos it
 *  moved on Volume, its reps on Sets. */
export function chartValue(p: ExerciseDataPoint, metric: ExerciseMetricKey): number {
  switch (metric) {
    case "strength": return p.topWeight;
    case "volume":   return p.sessionVolume;
    case "sets":     return setsTotal(p);
  }
}

/**
 * Whether a session draws on a tab. Every session keeps its slot, and its
 * number, on all three, so switching tabs leaves each one where it was; but a
 * session at bodyweight (a pull-up) has no weight for Strength and moves
 * nothing for Volume, and drawn at 0 it would read as a collapse, so its slot
 * stays empty there. A timed hold moves no volume. Sets draws every session.
 */
export function drawsOn(p: ExerciseDataPoint, metric: ExerciseMetricKey): boolean {
  return chartValue(p, metric) > 0;
}

// ─── How a line moved ────────────────────────────────────────────────────────
//
// The % change the chart shows (user request, 2026-10-08), two ways: across
// the whole chart in its header (the last session against the first, "▲ 18%
// since 12 Sep": is this getting stronger?) and, on a tapped session, that
// session against the one before ("▲ 2.5%": how did that session go?). Session
// to session is too jumpy for the header, where a lighter week or a change of
// reps would turn an upward trend down. Strength and Volume only: Sets is how
// the sets went, not a number to trend.

/** The change from `from` to `to`, as a percentage of `from`. Null when there
 *  is nothing to measure from. */
export function percentChange(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/** A change as the chart writes it: one decimal under 10% ("2.5%", "2%"),
 *  whole from there ("18%"), unsigned, since the arrow says which way; "0%"
 *  and flat when it rounds to nothing. */
export function fmtChange(pct: number): { text: string; dir: "up" | "down" | "flat" } {
  const abs = Math.abs(pct);
  const shown = abs >= 10 ? Math.round(abs) : Math.round(abs * 10) / 10;
  if (shown === 0) return { text: "0%", dir: "flat" };
  return { text: `${shown}%`, dir: pct > 0 ? "up" : "down" };
}

/** How a tab's sessions moved across the chart: the last one it draws against
 *  the first, and the date of the first. Null with fewer than two, and on
 *  Sets. */
export function chartChange(points: ExerciseDataPoint[], metric: ExerciseMetricKey): { pct: number; sinceYMD: string } | null {
  if (metric === "sets") return null;
  const drawn = points.filter(p => drawsOn(p, metric));
  if (drawn.length < 2) return null;
  const first = drawn[0];
  const pct = percentChange(chartValue(first, metric), chartValue(drawn[drawn.length - 1], metric));
  return pct === null ? null : { pct, sinceYMD: first.date };
}

/** Session `slot` against the session before it that the tab draws (a
 *  bodyweight session between them is skipped). Null for the first, and on
 *  Sets. */
export function changeFromPrevious(points: ExerciseDataPoint[], slot: number, metric: ExerciseMetricKey): number | null {
  if (metric === "sets" || !points[slot] || !drawsOn(points[slot], metric)) return null;
  for (let j = slot - 1; j >= 0; j--) {
    if (drawsOn(points[j], metric)) return percentChange(chartValue(points[j], metric), chartValue(points[slot], metric));
  }
  return null;
}

// ─── The chart's geometry ────────────────────────────────────────────────────

/** The y-axis labels' column, left of the plot. It stays put while the
 *  sessions scroll under it. */
export const Y_AXIS_LABEL_WIDTH = 32;
/** Room above the plot's top line, for a label over the highest dot. */
export const PLOT_TOP = 10;
export const CHART_HEIGHT = 170;
/** The session numbers' row under the plot. */
export const NUMBERS_H = 20;
export const CHART_TOTAL_H = PLOT_TOP + CHART_HEIGHT + NUMBERS_H;
/** Every session's slot, however long it was since the last one: the size
 *  option A was approved at, which stays as sessions are logged (user
 *  decision, 2026-10-12); past what fits, the row scrolls. */
export const SESSION_SPACING = 44;
/** A Sets block's and a Volume bar's width. */
export const BAR_WIDTH = 24;
/** The space between one set's block and the next. */
export const BLOCK_GAP = 2;
export const BLOCK_RADIUS = 4;
export const DOT_R = 3;
/** A label's line, and how far above its dot or stack its centre sits. */
export const LABEL_H = 14;
const DOT_LABEL_GAP = 13;
const STACK_LABEL_GAP = 9;
/** The pop-up over a tapped session: wide enough for its date line with the
 *  change from the session before ("28 Sep 2026 · ▲ 9.5%"). */
export const TOOLTIP_W = 160;

export type ExerciseChartGeometry = {
  cardWidth: number;
  /** The card's inner width, which the chart and its pop-up sit in. */
  wrapperWidth: number;
  /** The plot right of the y-axis labels: what you see of the row. */
  viewportWidth: number;
  /** The whole row of slots, never narrower than the viewport. */
  contentWidth: number;
  /** Where slot 0 begins: a row shorter than the viewport sits in its middle,
   *  the way option A showed five sessions. */
  offset: number;
  spacing: number;
  /** How far the row scrolls; the chart opens there, on the newest. */
  maxScrollX: number;
};

/** The chart's geometry for `n` sessions on a screen `screenWidth` wide. */
export function exerciseChartGeometry(n: number, screenWidth: number): ExerciseChartGeometry {
  const cardWidth = Math.min(screenWidth - 40, 420);
  const wrapperWidth = cardWidth - 32;
  const viewportWidth = wrapperWidth - Y_AXIS_LABEL_WIDTH;
  const row = Math.max(0, n) * SESSION_SPACING;
  const contentWidth = Math.max(viewportWidth, row);
  return {
    cardWidth,
    wrapperWidth,
    viewportWidth,
    contentWidth,
    offset: (contentWidth - row) / 2,
    spacing: SESSION_SPACING,
    maxScrollX: contentWidth - viewportWidth,
  };
}

/** Slot `i`'s centre across the scrolling row. */
export function slotX(g: ExerciseChartGeometry, i: number): number {
  return g.offset + (i + 0.5) * g.spacing;
}

/** The slots whose centres are on screen, the row scrolled to `scrollX`. */
export function visibleSlots(g: ExerciseChartGeometry, n: number, scrollX: number): { first: number; last: number } {
  const x0 = Math.min(Math.max(scrollX, 0), g.maxScrollX);
  return {
    first: Math.max(0, Math.ceil((x0 - g.offset) / g.spacing - 0.5 - 1e-6)),
    last: Math.min(n - 1, Math.floor((x0 + g.viewportWidth - g.offset) / g.spacing - 0.5 + 1e-6)),
  };
}

/** A value's height from the top of the chart, on `axis`. */
export function dotY(value: number, axis: { min: number; max: number }): number {
  return valueY(value, axis.min, axis.max);
}

/** The pop-up's left edge across the card's inner width, for a session at `x`
 *  (the same axis): centred over it, kept on the card, so an edge session
 *  doesn't push it outside the NeuCard (its caret stays on the session). */
export function popupLeft(g: ExerciseChartGeometry, x: number): number {
  return Math.min(Math.max(x - TOOLTIP_W / 2, -6), g.wrapperWidth - TOOLTIP_W + 6);
}

/** A label's centre `gap` above `y`, or below it where above would leave the
 *  chart. */
function labelOver(y: number, gap: number): number {
  return y - gap - LABEL_H / 2 < 0 ? y + gap : y - gap;
}

/** Strength's line, as the plot strokes it. */
export const LINE_STROKE = 2.5;

/** The reps written by a Strength dot: "×8", or a hold's "60s". */
export function strengthLabel(p: ExerciseDataPoint): string {
  return p.isHold ? `${p.topReps}s` : `×${p.topReps}`;
}

/** A Strength label's ink, measured off its font (Nunito Bold at 10pt): every
 *  figure and the × are 6 wide and an s 4.9, less about a point of side
 *  bearing; the figures stand from 4 over the middle of their line to 3.5
 *  under it. */
export function strengthLabelInkWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === "s" ? 4.9 : 6;
  return Math.max(0, w - 1);
}
export const LABEL_INK_UP = 4;
export const LABEL_INK_DOWN = 3.5;
/** How clear of the line a label's ink keeps, past the stroke's own edge. */
const LABEL_AIR = 2;
/** The dot a label keeps off: the gold one's size, and some air. */
const LABEL_DOT_CLEAR = 6;

type Box = { l: number; t: number; r: number; b: number };

/** Whether the segment from (x0, y0) to (x1, y1) touches `box` (Liang–Barsky). */
function crossesBox(x0: number, y0: number, x1: number, y1: number, box: Box): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x0 - box.l], [dx, box.r - x0], [-dy, y0 - box.t], [dy, box.b - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 <= t1;
}

function pointToBox(x: number, y: number, box: Box): number {
  return Math.hypot(Math.max(box.l - x, 0, x - box.r), Math.max(box.t - y, 0, y - box.b));
}

function pointToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** How near the segment comes to `box`: 0 if it touches. Apart, the nearest
 *  two points are an end of the one and a corner or an edge of the other. */
function segmentToBox(x0: number, y0: number, x1: number, y1: number, box: Box): number {
  if (crossesBox(x0, y0, x1, y1, box)) return 0;
  return Math.min(
    pointToBox(x0, y0, box),
    pointToBox(x1, y1, box),
    pointToSegment(box.l, box.t, x0, y0, x1, y1),
    pointToSegment(box.r, box.t, x0, y0, x1, y1),
    pointToSegment(box.l, box.b, x0, y0, x1, y1),
    pointToSegment(box.r, box.b, x0, y0, x1, y1),
  );
}

/** Where a dot's reps may go, as their middle's offset from the dot, in the
 *  order they're tried: over it, as ever, or a little higher (a moderate climb
 *  through the dot); tucked over to one side (a steep climb or drop through it
 *  leaves the corner behind it free); under it (a dip), or tucked under to a
 *  side; beside it (a dip with steep sides, too near the bottom to go under);
 *  then further over or under, into the mouth of a dip or a peak. `half` is
 *  half the label's width. */
function labelSpots(half: number): [number, number][] {
  const tuck = half + 4;
  const beside = half + 7;
  return [
    [0, -DOT_LABEL_GAP], [0, -(DOT_LABEL_GAP + 4)],
    [-tuck, -10], [tuck, -10],
    [0, DOT_LABEL_GAP], [0, DOT_LABEL_GAP + 4],
    [-tuck, 10], [tuck, 10],
    [-beside, 0], [beside, 0],
    [0, -22], [0, 22], [0, -28], [0, 28], [0, -34], [0, 34],
  ];
}

/** A dot's reps, clear of the line through it (user report, 2026-10-13: over
 *  every dot, a steep climb or drop ran the line through them). The first
 *  spot in labelSpots that keeps the ink LABEL_AIR off the line, off the dot
 *  and off the label before, inside the chart; failing that, the spot that
 *  comes nearest. `toward` holds the dots the line runs to from this one. */
function placeDotLabel(
  x: number, y: number, text: string, toward: { x: number; y: number }[], before: Box | null, rowWidth: number,
): { x: number; y: number; ink: Box } | null {
  const half = strengthLabelInkWidth(text) / 2;
  const base = PLOT_TOP + CHART_HEIGHT;
  const clear = LINE_STROKE / 2 + LABEL_AIR;
  let best: { x: number; y: number; ink: Box } | null = null;
  let bestCost = Infinity;
  for (const [dx, dy] of labelSpots(half)) {
    const cx = x + dx;
    const cy = y + dy;
    if (cy - LABEL_H / 2 < 0 || cy + LABEL_H / 2 > base || cx - half < 0 || cx + half > rowWidth) continue;
    const ink = { l: cx - half, t: cy - LABEL_INK_UP, r: cx + half, b: cy + LABEL_INK_DOWN };
    let cost = 0;
    for (const n of toward) cost += Math.max(0, clear - segmentToBox(x, y, n.x, n.y, ink));
    if (pointToBox(x, y, ink) < LABEL_DOT_CLEAR) cost += 100;
    if (before && ink.l < before.r + 2 && before.l < ink.r + 2 && ink.t < before.b + 2 && before.t < ink.b + 2) cost += 100;
    if (cost === 0) return { x: cx, y: cy, ink };
    if (cost < bestCost) {
      best = { x: cx, y: cy, ink };
      bestCost = cost;
    }
  }
  return best;
}

export type StrengthDot = { slot: number; x: number; y: number; labelX: number; labelY: number };

/** Strength: a dot per session with weight on the bar, its reps written by
 *  it, clear of the line. */
export function strengthDots(points: ExerciseDataPoint[], g: ExerciseChartGeometry, axis: ExerciseChartAxis): StrengthDot[] {
  const at: { slot: number; x: number; y: number }[] = [];
  points.forEach((p, slot) => {
    if (drawsOn(p, "strength")) at.push({ slot, x: slotX(g, slot), y: dotY(p.topWeight, axis) });
  });
  let before: Box | null = null;
  return at.map((d, i) => {
    const toward = [at[i - 1], at[i + 1]].filter((n): n is (typeof at)[number] => !!n);
    const spot = placeDotLabel(d.x, d.y, strengthLabel(points[d.slot]), toward, before, g.contentWidth);
    before = spot?.ink ?? null;
    return { ...d, labelX: spot?.x ?? d.x, labelY: spot?.y ?? labelOver(d.y, DOT_LABEL_GAP) };
  });
}

export type SetBlock = {
  /** Which of the session's sets (ExerciseDataPoint.sets). */
  set: number;
  weight: number;
  reps: number;
  /** Its top and height: set 1 sits on the baseline, each next one above it. */
  y: number;
  h: number;
  /** Lighter than the session's heaviest set (a back-off set): drawn paler. */
  lighter: boolean;
};

export type SetStack = {
  slot: number;
  x: number;
  blocks: SetBlock[];
  /** The top of the stack, and the centre of the weight written over it. */
  top: number;
  labelY: number;
  /** The session's heaviest set, the weight over the stack (0: bodyweight). */
  heaviest: number;
};

/** Sets: each session's working sets stacked from the baseline, a block per
 *  set as tall as its reps (a hold's seconds). */
export function setStacks(points: ExerciseDataPoint[], g: ExerciseChartGeometry, axis: ExerciseChartAxis): SetStack[] {
  return points.map((p, slot) => {
    const heaviest = p.sets.reduce((m, s) => (s.weight > m ? s.weight : m), 0);
    let cum = 0;
    const blocks = p.sets.map((s, set): SetBlock => {
      const bottom = dotY(cum, axis);
      cum += s.reps;
      const y = dotY(cum, axis) + BLOCK_GAP;
      return { set, weight: s.weight, reps: s.reps, y, h: Math.max(1, bottom - y), lighter: s.weight < heaviest - 1e-9 };
    });
    const top = dotY(cum, axis);
    return { slot, x: slotX(g, slot), blocks, top, labelY: labelOver(top, STACK_LABEL_GAP), heaviest };
  });
}

export type VolumeBar = { slot: number; x: number; y: number; labelY: number };

/** Volume: a bar per session that moved any weight, the kilos written over
 *  it. */
export function volumeBars(points: ExerciseDataPoint[], g: ExerciseChartGeometry, axis: ExerciseChartAxis): VolumeBar[] {
  const out: VolumeBar[] = [];
  points.forEach((p, slot) => {
    if (!drawsOn(p, "volume")) return;
    const y = dotY(p.sessionVolume, axis);
    out.push({ slot, x: slotX(g, slot), y, labelY: labelOver(y, STACK_LABEL_GAP) });
  });
  return out;
}

// ─── Paths ───────────────────────────────────────────────────────────────────
//
// What the plot draws, from the values and an axis. Worklets: when a scroll
// brings other sessions on screen, the plot eases the axis to fit them on the
// UI thread and every path follows it frame by frame (its labels fade across).

/** Where `v` sits on an axis running `min`..`max`, from the top of the chart. */
export function valueY(v: number, min: number, max: number): number {
  "worklet";
  if (!(max > min)) return PLOT_TOP + CHART_HEIGHT;
  return PLOT_TOP + CHART_HEIGHT - ((v - min) / (max - min)) * CHART_HEIGHT;
}

function r1(n: number): number {
  "worklet";
  return Math.round(n * 10) / 10;
}

/** Strength's line, straight from one session to the next, never curved:
 *  nothing happens between two sessions (user decision, 2026-10-08). */
export function linePathD(xs: number[], vs: number[], min: number, max: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i < xs.length; i++) d += `${i === 0 ? "M" : "L"}${r1(xs[i])},${r1(valueY(vs[i], min, max))}`;
  return d;
}

/** The fill under Strength's line, down to the baseline. */
export function areaPathD(xs: number[], vs: number[], min: number, max: number): string {
  "worklet";
  if (xs.length === 0) return "";
  const base = PLOT_TOP + CHART_HEIGHT;
  return `${linePathD(xs, vs, min, max)}L${r1(xs[xs.length - 1])},${base}L${r1(xs[0])},${base}Z`;
}

/** Every dot as one path: a circle per session. */
export function dotsPathD(xs: number[], vs: number[], min: number, max: number, r: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    const y = r1(valueY(vs[i], min, max));
    d += `M${r1(xs[i] - r)},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  return d;
}

function roundedRectD(x: number, y: number, w: number, h: number, r: number): string {
  "worklet";
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  const R = x + w;
  const B = y + h;
  return `M${r1(x + k)},${r1(y)}H${r1(R - k)}Q${r1(R)},${r1(y)} ${r1(R)},${r1(y + k)}V${r1(B - k)}Q${r1(R)},${r1(B)} ${r1(R - k)},${r1(B)}H${r1(x + k)}Q${r1(x)},${r1(B)} ${r1(x)},${r1(B - k)}V${r1(y + k)}Q${r1(x)},${r1(y)} ${r1(x + k)},${r1(y)}Z`;
}

/** Sets' blocks as one path, from triplets: a block's centre x, then the reps
 *  stacked under it and the reps at its top (as setStacks lays them). */
export function blocksPathD(blocks: number[], min: number, max: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i + 2 < blocks.length; i += 3) {
    const bottom = valueY(blocks[i + 1], min, max);
    const top = valueY(blocks[i + 2], min, max) + BLOCK_GAP;
    const h = Math.max(1, bottom - top);
    d += roundedRectD(blocks[i] - BAR_WIDTH / 2, bottom - h, BAR_WIDTH, h, BLOCK_RADIUS);
  }
  return d;
}

/** Volume's bars as one path, rounded at the top, standing on the baseline. */
export function barsPathD(xs: number[], vs: number[], min: number, max: number): string {
  "worklet";
  const base = PLOT_TOP + CHART_HEIGHT;
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    const top = valueY(vs[i], min, max);
    const h = Math.max(1, base - top);
    const k = Math.min(5, BAR_WIDTH / 2, h);
    const x = xs[i] - BAR_WIDTH / 2;
    const R = x + BAR_WIDTH;
    d += `M${r1(x)},${base}V${r1(top + k)}Q${r1(x)},${r1(top)} ${r1(x + k)},${r1(top)}H${r1(R - k)}Q${r1(R)},${r1(top)} ${r1(R)},${r1(top + k)}V${base}Z`;
  }
  return d;
}

// ─── The record's shine ──────────────────────────────────────────────────────
//
// Every few seconds a glint of light runs up the gold bar (Volume) and the gold
// block (Sets), and a sparkle twinkles on the gold dot (Strength): that one's
// the record (user request, 2026-10-13). Worklets like the paths above, so the
// light stays on its shape while the axis eases it.

/** The glint: bands of light on one centre, the widest the faintest, so its
 *  edges are soft, and a thin streak trailing it (`offset` behind), the shine
 *  a trophy throws. Near white at its middle where they overlap: white over
 *  gold barely shows at a faint strength. */
export const GLINT_BANDS = [
  { width: 20, opacity: 0.28, offset: 0 },
  { width: 12, opacity: 0.45, offset: 0 },
  { width: 5, opacity: 0.75, offset: 0 },
  { width: 3, opacity: 0.6, offset: -12 },
] as const;
/** How far past the shape the glint's centre starts and ends, so every band,
 *  the trailing streak included, is off it at both ends (a point to spare, or
 *  the streak's last frame left a sliver at the top). */
const GLINT_REACH = 2 * (Math.max(...GLINT_BANDS.map(b => Math.abs(b.offset) + b.width / 2)) + 1);
/** Which way the glint runs: up its shape, its bands leaning like "/", 28° off
 *  flat. A unit vector across the bands, up and to the left on screen. */
const GLINT_UX = -Math.sin((28 * Math.PI) / 180);
const GLINT_UY = -Math.cos((28 * Math.PI) / 180);

/** Three points along the curve from (x0, y0) by (cx, cy) to (x1, y1), short of
 *  its ends: a rounded corner, as a polygon takes it. */
function pushCorner(out: number[], x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void {
  "worklet";
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push(a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1);
  }
}

/** A Volume bar as barsPathD draws it, as a polygon (x, y pairs). */
function barPolygon(x: number, v: number, min: number, max: number): number[] {
  "worklet";
  const base = PLOT_TOP + CHART_HEIGHT;
  const top = valueY(v, min, max);
  const k = Math.min(5, BAR_WIDTH / 2, Math.max(1, base - top));
  const L = x - BAR_WIDTH / 2;
  const R = L + BAR_WIDTH;
  const out = [L, base, L, top + k];
  pushCorner(out, L, top + k, L, top, L + k, top);
  out.push(L + k, top, R - k, top);
  pushCorner(out, R - k, top, R, top, R, top + k);
  out.push(R, top + k, R, base);
  return out;
}

/** A Sets block as blocksPathD draws it (its centre, the reps under it and the
 *  reps at its top), as a polygon. */
function blockPolygon(cx: number, below: number, upTo: number, min: number, max: number): number[] {
  "worklet";
  const B = valueY(below, min, max);
  const h = Math.max(1, B - (valueY(upTo, min, max) + BLOCK_GAP));
  const y = B - h;
  const L = cx - BAR_WIDTH / 2;
  const R = L + BAR_WIDTH;
  const k = Math.max(0, Math.min(BLOCK_RADIUS, BAR_WIDTH / 2, h / 2));
  const out = [L + k, y, R - k, y];
  pushCorner(out, R - k, y, R, y, R, y + k);
  out.push(R, y + k, R, B - k);
  pushCorner(out, R, B - k, R, B, R - k, B);
  out.push(R - k, B, L + k, B);
  pushCorner(out, L + k, B, L, B, L, B - k);
  out.push(L, B - k, L, y + k);
  pushCorner(out, L, y + k, L, y, L + k, y);
  return out;
}

/** The part of a convex polygon on one side of a line across the glint:
 *  where u·p ≥ c (`side` 1) or ≤ c (`side` -1). One step of Sutherland–Hodgman. */
function clipAcross(poly: number[], c: number, side: number): number[] {
  "worklet";
  const out: number[] = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[2 * i];
    const ay = poly[2 * i + 1];
    const bx = poly[2 * j];
    const by = poly[2 * j + 1];
    const da = side * (GLINT_UX * ax + GLINT_UY * ay - c);
    const db = side * (GLINT_UX * bx + GLINT_UY * by - c);
    if (da >= 0) out.push(ax, ay);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push(ax + t * (bx - ax), ay + t * (by - ay));
    }
  }
  return out;
}

/** One band of the glint, `width` across, where it crosses the shape `poly`,
 *  the glint's centre `p` of the way up (0 just under the shape, 1 just past
 *  its top, so it shows nothing at either end) and the band `offset` along
 *  from it (less than 0 trails it). Every band is placed by the same centre, so
 *  together they stay one glint. */
function glintD(poly: number[], p: number, width: number, offset: number): string {
  "worklet";
  if (!(p > 0 && p < 1)) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const s = GLINT_UX * poly[i] + GLINT_UY * poly[i + 1];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const centre = lo - GLINT_REACH / 2 + p * (hi - lo + GLINT_REACH) + offset;
  const cut = clipAcross(clipAcross(poly, centre - width / 2, 1), centre + width / 2, -1);
  if (cut.length < 6) return "";
  let d = `M${r1(cut[0])},${r1(cut[1])}`;
  for (let i = 2; i < cut.length; i += 2) d += `L${r1(cut[i])},${r1(cut[i + 1])}`;
  return `${d}Z`;
}

/** The glint's band `width` across (`offset` from its centre), `p` of the way
 *  up the record's Volume bar. */
export function barGlintD(x: number, v: number, min: number, max: number, p: number, width: number, offset = 0): string {
  "worklet";
  return glintD(barPolygon(x, v, min, max), p, width, offset);
}

/** The same up the record's Sets block (a triplet, as blocksPathD takes them). */
export function blockGlintD(block: number[], min: number, max: number, p: number, width: number, offset = 0): string {
  "worklet";
  if (block.length < 3) return "";
  return glintD(blockPolygon(block[0], block[1], block[2], min, max), p, width, offset);
}

/** The sparkle on the record's dot: a four-pointed star reaching `r` from its
 *  centre (cx, cy), turned `turn` radians, its sides drawn in toward the
 *  middle. Nothing at no size. */
export function sparkleD(cx: number, cy: number, r: number, turn: number): string {
  "worklet";
  if (!(r > 0.3)) return "";
  let d = "";
  for (let i = 0; i <= 4; i++) {
    const a = turn + (i * Math.PI) / 2;
    const x = r1(cx + r * Math.sin(a));
    const y = r1(cy - r * Math.cos(a));
    d += i === 0 ? `M${x},${y}` : `Q${r1(cx)},${r1(cy)} ${x},${y}`;
  }
  return `${d}Z`;
}

// ─── The y-axis ──────────────────────────────────────────────────────────────

/** The exercise chart's y-axis, which runs from `min` rather than from zero,
 *  in `sections` steps of `stepValue`. */
export type ExerciseChartAxis = NiceAxis & { min: number; sections: number };

/** The least the y-axis covers, as a share of the highest value. */
const MIN_SPAN_SHARE = 0.2;
/** Room left above the highest session and below the lowest, as a share of
 *  their span: for the dots and the pop-up. */
const EDGE_ROOM = 0.1;

/** The axis' steps: these times a power of ten, the round numbers a lifter
 *  reads ("40, 45, 50"). Steps of 1.5, 3, 4, 6 or 8 were allowed too, and
 *  sessions loaded 5 kg at a time read against 44, 48, 52, 56 (user report,
 *  2026-10-12). */
const NICE_STEPS = [1, 2, 2.5, 5];
/** How many steps the axis may take, best first on a tie: 4, or 5 or 3 when
 *  that lets a round step fit the sessions closer. */
const SECTION_CHOICES = [4, 5, 3];

/** The jumps weights are loaded in, coarsest first: plates, pins, dumbbells. */
const LOAD_STEPS = [5, 2.5, 2, 1.25, 1, 0.5];
/** At least this share of the weights must sit on a jump for the axis to step
 *  by it ("mainly in 5 kg jumps": one odd weight doesn't undo it). */
const LOAD_SHARE = 0.75;

/** A value on a multiple of `q`, allowing for a weight stored in kg and read
 *  in lbs (135 lb comes back as 135.0006). */
const onStep = (v: number, q: number) => Math.abs(v - Math.round(v / q) * q) <= 0.05;

/** The jump most of `values` are loaded in, or null when they're too uneven
 *  for one (a machine's 50, 63, 77, 84). */
export function loadStep(values: number[]): number | null {
  const weights = values.filter(v => v > 0);
  if (!weights.length) return null;
  return LOAD_STEPS.find(q => weights.filter(v => onStep(v, q)).length / weights.length >= LOAD_SHARE) ?? null;
}

/** The jump a weight axis steps by: the one most of `values` were loaded in,
 *  as long as they span at least one of it. Sessions all within a jump (8 and
 *  10 kg dumbbells, mostly on 5s) would read against steps too coarse to show
 *  them, a squashed line at the foot of the plot, so they take round steps. */
export function axisLoadStep(values: number[]): number | null {
  const q = loadStep(values);
  if (q === null) return null;
  const weights = values.filter(v => v > 0);
  return Math.max(...weights) - Math.min(...weights) >= q - 1e-9 ? q : null;
}

/** Steps that read naturally for weights in 2 kg jumps (dumbbells, some
 *  pins), which take none of 2.5 and 5: without them, sessions from 14 to 22 kg
 *  had only 2s (too fine) or 10s (a quarter of the plot). */
const TWO_KG_STEPS = [4, 8];

/** The candidate steps for an axis about `range` tall, smallest first: round
 *  ones, a whole number for whole values (reps), and a multiple of `load` when
 *  the weights are loaded in jumps of it. */
function candidateSteps(range: number, whole: boolean, load: number | null): number[] {
  const out: number[] = [];
  const first = Math.floor(Math.log10(Math.max(range, 1e-6) / 6)) - 1;
  const mantissas = load === 2 ? [...NICE_STEPS, ...TWO_KG_STEPS].sort((a, b) => a - b) : NICE_STEPS;
  for (let exp = first; out.length < 12 && exp < first + 8; exp++) {
    for (const m of mantissas) {
      const s = Math.round(m * Math.pow(10, exp) * 1e9) / 1e9;
      if (whole && (s < 1 || !Number.isInteger(s))) continue;
      if (load !== null && (s < load || !onStep(s, load))) continue;
      out.push(s);
    }
  }
  return out;
}

/** A tick, in the units the axis is read in: "57.5", "1.25k". */
function fmtTick(v: number, axisMax: number): string {
  if (v === 0) return "0";
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  return axisMax >= 1000 ? `${trim(v / 1000)}k` : trim(v);
}

/** `sections` steps of `step` up from `min`, labelled. */
function axisFrom(min: number, step: number, sections: number): ExerciseChartAxis {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const max = r(min + sections * step);
  return {
    min: r(min),
    max,
    stepValue: step,
    sections,
    labels: Array.from({ length: sections + 1 }, (_, i) => fmtTick(r(min + i * step), max)),
  };
}

/**
 * The y-axis for the plotted values: zoomed to them, so the change from one
 * session to the next is what fills the plot. Every metric (kg, or reps) is
 * read the same way:
 *   - The lowest and highest sessions sit inside the plot, a tenth of their
 *     span clear of each edge.
 *   - It never covers less than a fifth of the highest value, so a small
 *     wobble stays small (a 1 kg dip on 60 kg moves a dot a few percent of the
 *     plot) and a lone session or a flat run sits in the middle, or within
 *     half a step of it.
 *   - Round steps up from a round bottom, never below zero: 1, 2, 2.5 or 5
 *     times a power of ten (whole for whole numbers), and for weights loaded
 *     in jumps (`loads`: Strength), a multiple of the jump most of them were
 *     loaded in (axisLoadStep), so 5 kg jumps read "40, 50, 60" and 2.5 kg
 *     ones "55, 57.5, 60"; uneven weights (a machine's 50, 63, 77, 84), or
 *     ones all within a single jump, just take round steps.
 *   - 3 to 5 steps, whichever covers the least while still holding the
 *     sessions (4 on a tie), then the bottom that puts them most central.
 * It used to run from zero with the first session on the middle line, which
 * drew every metric as its ratio to the first session: a 10% gain moved a dot
 * 5% of the plot (user report, 2026-10-08).
 * Empty (or all zero): a clean 0–100 grid.
 */
export function exerciseChartAxis(values: number[], loads = false): ExerciseChartAxis {
  const hi = values.reduce((m, v) => (v > m ? v : m), 0);
  if (hi <= 0) return { ...niceAxis(hi, 4), min: 0, sections: 4 };
  const lo = values.reduce((m, v) => (v < m ? v : m), hi);
  const span = Math.max(hi - lo, hi * MIN_SPAN_SHARE);
  const mid = (hi + lo) / 2;
  const top = mid + span * (0.5 + EDGE_ROOM);
  const bottom = Math.max(0, mid - span * (0.5 + EDGE_ROOM));
  const whole = values.every(Number.isInteger);
  const load = loads ? axisLoadStep(values) : null;

  type Fit = { min: number; step: number; sections: number; cover: number; rank: number; off: number };
  let best: Fit | null = null;
  const beats = (f: Fit, b: Fit | null) =>
    !b || f.cover < b.cover - 1e-9
    || (Math.abs(f.cover - b.cover) <= 1e-9 && (f.rank < b.rank || (f.rank === b.rank && f.off < b.off)));
  for (const step of candidateSteps(top - bottom, whole, load)) {
    for (const [rank, sections] of SECTION_CHOICES.entries()) {
      const cover = step * sections;
      // Round bottoms that hold the sessions: at or under `bottom`, with the
      // top at or over `top`.
      const kLo = Math.max(0, Math.ceil((top - cover) / step - 1e-9));
      const kHi = Math.floor(bottom / step + 1e-9);
      for (let k = kLo; k <= kHi; k++) {
        const fit: Fit = { min: k * step, step, sections, cover, rank, off: Math.abs(k * step + cover / 2 - mid) };
        if (beats(fit, best)) best = fit;
      }
    }
  }
  if (best) return axisFrom(best.min, best.step, best.sections);
  // Nothing round fits (not reached in practice): four steps from zero.
  const step = candidateSteps(top, whole, load).find(s => s * 4 >= top) ?? niceAxis(top, 4).stepValue;
  return axisFrom(0, step, 4);
}

/** An axis for bars (Sets, Volume): from zero, so a bar's height is its
 *  value, with a tenth of the tallest's room over it for its label. */
export function barAxis(values: number[]): ExerciseChartAxis {
  return exerciseChartAxis([0, ...values]);
}

/** The y-axis for a tab with slots `first`..`last` on screen: fitted to the
 *  sessions there (Strength by its load jumps, Sets and Volume from zero).
 *  Null when none of them draws on the tab (a run of bodyweight sessions on
 *  Strength): the plot keeps the axis it had. */
export function windowAxis(points: ExerciseDataPoint[], metric: ExerciseMetricKey, first: number, last: number): ExerciseChartAxis | null {
  const values: number[] = [];
  for (let i = Math.max(0, first); i <= Math.min(last, points.length - 1); i++) {
    if (drawsOn(points[i], metric)) values.push(chartValue(points[i], metric));
  }
  if (values.length === 0) return null;
  return metric === "strength" ? exerciseChartAxis(values, true) : barAxis(values);
}
