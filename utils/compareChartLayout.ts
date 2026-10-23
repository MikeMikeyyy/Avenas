// utils/compareChartLayout.ts
//
// Where the comparison chart (components/progress/CompareChartPlot.tsx) puts
// things. It's the exercise chart's geometry (utils/exerciseChartLayout.ts):
// a slot per session, numbered from 1, the same width however long between
// sessions, scrolling sideways past what fits. Both programs share the slots,
// so each program's 4th session stands over the same number (user decision,
// 2026-10-14). On Sets and Volume each slot holds a pair, green's on the left.
//
// A session that came round and wasn't done keeps its slot and its number
// (utils/programCompare.ts liftSlots; user decision, 2026-10-14: squeezed in
// between the sessions done, "2 missed" read as one place, and the words ran
// into the bars). On Strength it's an empty dotted circle on the line (user
// request, 2026-10-14), which goes dotted through it, or out to it before the
// first session or after the last, never to nothing; one word at the foot over
// a run of them ("Missed", "2 missed"), as the week-by-week board on the
// Program Compare canvas showed. On Sets and Volume
// that program's half of the slot holds an empty bar (the user's idea), as
// tall as its session before, and nothing is written.
//
// Pure, and the path builders are worklets like the exercise chart's: the plot
// eases them to a new axis on the UI thread.

import type { ExerciseMetricKey } from "../constants/progress";
import {
  BLOCK_GAP, BLOCK_RADIUS, CHART_HEIGHT, PLOT_TOP, barAxis, chartValue, drawsOn, exerciseChartAxis, slotX,
  valueY, type ExerciseChartAxis, type ExerciseChartGeometry,
} from "./exerciseChartLayout";
import type { LiftSlot } from "./programCompare";

/** One program's half of a slot on Sets and Volume: a block or bar this wide,
 *  the pair this far apart. */
export const PAIR_W = 17;
export const PAIR_GAP = 2;
/** A pair member's centre, from its slot's centre: green left, blue right. */
export const PAIR_OFFSET = (PAIR_W + PAIR_GAP) / 2;

/** The pop-up over a tapped slot: both programs' sessions, a line each. */
export const COMPARE_TOOLTIP_W = 188;

/** How tall a missed session's empty bar stands on Sets or Volume: as its
 *  program's session before it that draws there, else the one after; null
 *  with neither. */
export function missedBarValue(slots: readonly LiftSlot[], k: number, metric: ExerciseMetricKey): number | null {
  for (let i = k - 1; i >= 0; i--) {
    const p = slots[i].point;
    if (p && drawsOn(p, metric)) return chartValue(p, metric);
  }
  for (let i = k + 1; i < slots.length; i++) {
    const p = slots[i].point;
    if (p && drawsOn(p, metric)) return chartValue(p, metric);
  }
  return null;
}

/** The y-axis for slots `first`..`last` on screen, fitted to both programs'
 *  sessions there, and to the marks of the ones missed there: on Sets and
 *  Volume their empty bars, on Strength their empty circles, which sit on the
 *  line toward a session that can be off screen (Strength by the sessions'
 *  load jumps, Sets and Volume from zero). Null when no session there draws
 *  on the tab. */
export function compareWindowAxis(
  green: readonly LiftSlot[],
  blue: readonly LiftSlot[],
  metric: ExerciseMetricKey,
  first: number,
  last: number,
): ExerciseChartAxis | null {
  const values: number[] = [];
  const rings: number[] = [];
  const on = (k: number) => k >= first && k <= last;
  for (const slots of [green, blue]) {
    for (let i = Math.max(0, first); i <= Math.min(last, slots.length - 1); i++) {
      const p = slots[i].point;
      if (p) {
        if (drawsOn(p, metric)) values.push(chartValue(p, metric));
      } else if (metric !== "strength") {
        const v = missedBarValue(slots, i, metric);
        if (v !== null) values.push(v);
      }
    }
    if (metric === "strength") {
      const drawn = slots.flatMap((s, slot) => (s.point && drawsOn(s.point, "strength") ? [{ slot, v: s.point.topWeight }] : []));
      for (const r of missedOnLine(slots, drawn).rings) if (on(r.slot)) rings.push(r.v);
    }
  }
  if (values.length === 0) return null;
  return metric === "strength" ? exerciseChartAxis([...values, ...rings], true, values) : barAxis(values);
}

/**
 * Where a lift's missed sessions sit on its Strength line, and the line through
 * them: each missed place is an empty dotted circle on the line (user request,
 * 2026-10-14), between two sessions where the line between them would pass,
 * before the first or after the last level with it, and the line goes dotted
 * from a session through the circles to the next session or the last circle.
 * `drawn` are the slots that draw, with their values, in order.
 */
export function missedOnLine(
  slots: readonly LiftSlot[],
  drawn: readonly { slot: number; v: number }[],
): { rings: { slot: number; v: number }[]; ends: { from: number; to: number; v: number }[] } {
  const rings: { slot: number; v: number }[] = [];
  const ends: { from: number; to: number; v: number }[] = [];
  if (drawn.length === 0) return { rings, ends };
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  let lead = -1;
  let trail = -1;
  slots.forEach((s, k) => {
    if (s.missed === undefined) return;
    if (k < first.slot) {
      if (lead < 0) lead = k;
      rings.push({ slot: k, v: first.v });
    } else if (k > last.slot) {
      trail = k;
      rings.push({ slot: k, v: last.v });
    } else {
      const i = drawn.findIndex(d => d.slot > k);
      const a = drawn[i - 1];
      const b = drawn[i];
      rings.push({ slot: k, v: a.v + ((b.v - a.v) * (k - a.slot)) / (b.slot - a.slot) });
    }
  });
  if (lead >= 0) ends.push({ from: lead, to: first.slot, v: first.v });
  if (trail >= 0) ends.push({ from: last.slot, to: trail, v: last.v });
  return { rings, ends };
}

/**
 * One program's Strength line, as straight segments (x, value, x, value each):
 * solid between two sessions, dotted where it passes through a session missed
 * and out to one missed before the first or after the last. With the dots'
 * places, and the empty circles' (missedOnLine).
 */
export function strengthLine(
  slots: readonly LiftSlot[],
  g: ExerciseChartGeometry,
): { solid: number[]; dotted: number[]; xs: number[]; vs: number[]; missedXs: number[]; missedVs: number[] } {
  const drawn: { slot: number; v: number }[] = [];
  slots.forEach((s, slot) => {
    if (s.point && drawsOn(s.point, "strength")) drawn.push({ slot, v: s.point.topWeight });
  });
  const solid: number[] = [];
  const dotted: number[] = [];
  for (let i = 1; i < drawn.length; i++) {
    const a = drawn[i - 1];
    const b = drawn[i];
    const through = slots.slice(a.slot + 1, b.slot).some(s => s.missed !== undefined);
    (through ? dotted : solid).push(slotX(g, a.slot), a.v, slotX(g, b.slot), b.v);
  }
  const { rings, ends } = missedOnLine(slots, drawn);
  for (const e of ends) dotted.push(slotX(g, e.from), e.v, slotX(g, e.to), e.v);
  return {
    solid,
    dotted,
    xs: drawn.map(d => slotX(g, d.slot)),
    vs: drawn.map(d => d.v),
    missedXs: rings.map(r => slotX(g, r.slot)),
    missedVs: rings.map(r => r.v),
  };
}

/** A run of one program's missed sessions side by side, for Strength: a grey
 *  dot at the foot of each slot, and one word over them, centred. */
export type MissedRun = { side: "green" | "blue"; slots: number[]; x: number; label: string };

/** Each program's runs of missed sessions, on Strength. */
export function missedRuns(
  green: readonly LiftSlot[],
  blue: readonly LiftSlot[],
  g: ExerciseChartGeometry,
): MissedRun[] {
  const out: MissedRun[] = [];
  const walk = (slots: readonly LiftSlot[], side: "green" | "blue") => {
    let run: number[] = [];
    const close = () => {
      if (run.length === 0) return;
      out.push({ side, slots: run, x: (slotX(g, run[0]) + slotX(g, run[run.length - 1])) / 2, label: missedLabel(run.length) });
      run = [];
    };
    slots.forEach((s, k) => (s.missed !== undefined ? run.push(k) : close()));
    close();
  };
  walk(green, "green");
  walk(blue, "blue");
  return out;
}

/** What a run says: "Missed" for one, "2 missed" for more. */
export const missedLabel = (count: number): string => (count === 1 ? "Missed" : `${count} missed`);

/** One program's empty bars on Sets or Volume, one at each session it missed
 *  (centre x across the row, and the value it stands to; missedBarValue). */
export function missedBars(
  slots: readonly LiftSlot[],
  metric: ExerciseMetricKey,
  offset: number,
  g: ExerciseChartGeometry,
): { xs: number[]; vs: number[] } {
  const xs: number[] = [];
  const vs: number[] = [];
  slots.forEach((s, k) => {
    if (s.missed === undefined) return;
    const v = missedBarValue(slots, k, metric);
    if (v === null) return;
    xs.push(slotX(g, k) + offset);
    vs.push(v);
  });
  return { xs, vs };
}

/** Where the row opens: green's latest slot on screen (`greenCount` of them,
 *  missed ones included), with the slot after it beside it when there is one,
 *  so blue's next session shows what's ahead. */
export function compareOpenX(g: ExerciseChartGeometry, greenCount: number, n: number): number {
  if (g.maxScrollX <= 0 || n <= 0) return 0;
  const latest = Math.min(Math.max(greenCount, 1), n) - 1;
  const right = slotX(g, Math.min(latest + 1, n - 1)) + g.spacing / 2;
  return Math.min(Math.max(right - g.viewportWidth, 0), g.maxScrollX);
}

// ─── Paths (worklets) ────────────────────────────────────────────────────────

function r1(n: number): number {
  "worklet";
  return Math.round(n * 10) / 10;
}

/** Straight segments as one path, from quadruplets (x, value, x, value). */
export function segmentsPathD(segs: number[], min: number, max: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i + 3 < segs.length; i += 4) {
    d += `M${r1(segs[i])},${r1(valueY(segs[i + 1], min, max))}L${r1(segs[i + 2])},${r1(valueY(segs[i + 3], min, max))}`;
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

/** One program's Sets blocks as one path, PAIR_W wide, from triplets (centre
 *  x, the reps stacked under the block, the reps at its top), risen `grow` (0
 *  to 1) of the way as the tab comes in. */
export function pairBlocksPathD(blocks: number[], min: number, max: number, grow = 1): string {
  "worklet";
  if (grow <= 0) return "";
  let d = "";
  for (let i = 0; i + 2 < blocks.length; i += 3) {
    const bottom = valueY(blocks[i + 1] * grow, min, max);
    const top = valueY(blocks[i + 2] * grow, min, max) + BLOCK_GAP * grow;
    const h = Math.max(1, bottom - top);
    d += roundedRectD(blocks[i] - PAIR_W / 2, bottom - h, PAIR_W, h, BLOCK_RADIUS - 1);
  }
  return d;
}

/** One program's Volume bars as one path, PAIR_W wide, rounded at the top,
 *  risen `grow` (0 to 1) of the way as the tab comes in. */
export function pairBarsPathD(xs: number[], vs: number[], min: number, max: number, grow = 1): string {
  "worklet";
  if (grow <= 0) return "";
  const base = PLOT_TOP + CHART_HEIGHT;
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    const top = valueY(vs[i] * grow, min, max);
    const h = Math.max(1, base - top);
    const k = Math.min(4, PAIR_W / 2, h);
    const x = xs[i] - PAIR_W / 2;
    const R = x + PAIR_W;
    d += `M${r1(x)},${base}V${r1(top + k)}Q${r1(x)},${r1(top)} ${r1(x + k)},${r1(top)}H${r1(R - k)}Q${r1(R)},${r1(top)} ${r1(R)},${r1(top + k)}V${base}Z`;
  }
  return d;
}
