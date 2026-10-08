// utils/exerciseChartLayout.ts
//
// Where the Progress page's exercise chart (components/ExerciseProgressionChart
// .tsx) puts things: its plot inside the card, each session's dot, the y-axis
// it scales to, the dates under the dots and the pop-up over a tapped one.
// Pure, so scripts/verify-training-months.ts can check every dot lands inside
// the chart, for every number of sessions and every phone width.

import { MONTH_NAMES } from "./dates";
import { niceAxis, type NiceAxis } from "./niceAxis";
import type { ExerciseDataPoint, ExerciseMetricKey } from "../constants/progress";

/** The chart's value for one session on one metric. */
export function metricValue(p: ExerciseDataPoint, m: ExerciseMetricKey): number {
  switch (m) {
    case "topWeight":     return p.topWeight;
    case "e1rm":          return p.e1rm;
    case "sessionVolume": return p.sessionVolume;
    case "totalReps":     return p.totalReps;
  }
}

/**
 * The sessions a metric plots, oldest first. Reps plots every session the
 * exercise was done in; Heaviest, Est. 1RM and Volume only those with weight
 * on the bar, since a session at bodyweight (a pull-up, a dip) has no weight to
 * plot, and drawn at 0 it would read as a collapse. (A timed hold has a weight
 * but no 1RM: its "reps" are seconds.)
 */
export function plottedPoints<P extends ExerciseDataPoint>(points: P[], metric: ExerciseMetricKey): P[] {
  return metric === "totalReps" ? points : points.filter(p => metricValue(p, metric) > 0);
}

// ─── How a line moved ────────────────────────────────────────────────────────
//
// The % change the chart shows (user request, 2026-10-08), two ways: across
// the whole chart in its header (the last session against the first, "▲ 18%
// since 12 Sep": is this getting stronger?) and, on a tapped dot, that session
// against the one before ("▲ 2.5%": how did that session go?). Session to
// session is too jumpy for the header, where a lighter week or a change of
// reps would turn an upward trend down.

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

/** How a metric moved across the chart: its last dot against its first, and
 *  the date of the first. Null with fewer than two dots. */
export function chartChange(points: ExerciseDataPoint[], metric: ExerciseMetricKey): { pct: number; sinceYMD: string } | null {
  const plotted = plottedPoints(points, metric);
  if (plotted.length < 2) return null;
  const first = plotted[0];
  const pct = percentChange(metricValue(first, metric), metricValue(plotted[plotted.length - 1], metric));
  return pct === null ? null : { pct, sinceYMD: first.date };
}

/** The `index`th dot of `plotted` (a metric's dots, plottedPoints) against the
 *  one before it. Null for the first. */
export function changeFromPrevious(plotted: ExerciseDataPoint[], index: number, metric: ExerciseMetricKey): number | null {
  if (index < 1 || index >= plotted.length) return null;
  return percentChange(metricValue(plotted[index - 1], metric), metricValue(plotted[index], metric));
}

/** The y-axis labels' column, left of the plot. */
export const Y_AXIS_LABEL_WIDTH = 32;
export const CHART_HEIGHT = 170;
/** The pop-up over a tapped dot: wide enough for its date line with the
 *  change from the session before ("28 Sep 2026 · ▲ 9.5%"). */
export const TOOLTIP_W = 160;
// gifted-charts pads the top of its plot: point y = (height + 10) − the
// value's share of `height` (extendedContainerHeight = height + overflowTop(0)
// + 10 in gifted-charts-core). Keep in sync if the library changes.
export const GIFTED_TOP_PAD = 10;

const MIN_PAD = 12;
const FILL_AT_N = 6;

export type ExerciseChartLayout = {
  cardWidth: number;
  /** The `width` handed to gifted-charts. */
  chartWidth: number;
  /** Where the dots can go, right of the y-axis labels. */
  dataAreaWidth: number;
  /** The card's inner width, which the chart and its pop-up sit in. */
  wrapperWidth: number;
  initialSpacing: number;
  endSpacing: number;
  spacing: number;
};

/**
 * The chart's geometry for `n` sessions on a screen `screenWidth` wide.
 *
 * Dynamic spacing so the points always feel balanced inside the chart:
 *   • 1 point  → at the wrapper's true horizontal midpoint (= the card's
 *                visual center). Robust regardless of whether gifted-charts
 *                stretches the chart to fill the wrapper or honors its
 *                `width` prop, because the dot sits where the user reads
 *                "the middle of the card" either way.
 *   • 2..5 pts → constant per-point gap (same as the filled 6-point gap),
 *                with the group centered around that same midpoint.
 *   • 6+ pts   → edge-to-edge of the plot zone: first point near left,
 *                last near right.
 *   • >6 pts   → spacing shrinks naturally so all points fit.
 *
 * `endSpacing` is ALWAYS pinned to MIN_PAD — a large endSpacing makes
 * gifted-charts render the chart wider than the `width` prop suggests
 * (its x-axis line stretches to fit the reserved right margin), which
 * re-extends the chart to the card's right edge.
 */
export function exerciseChartLayout(n: number, screenWidth: number): ExerciseChartLayout {
  const cardWidth = Math.min(screenWidth - 40, 420);
  const chartWidth = cardWidth - 80;
  const dataAreaWidth = chartWidth - Y_AXIS_LABEL_WIDTH;
  // NeuCard inner content area = cardWidth minus the card's 16px horizontal
  // padding on each side. This is the visual "center" the user perceives.
  const wrapperWidth = cardWidth - 32;
  const base = { cardWidth, chartWidth, dataAreaWidth, wrapperWidth, endSpacing: MIN_PAD };
  // For the dot to sit AT the wrapper's horizontal midpoint, expressed as
  // an `initialSpacing` offset from the y-axis line:
  //   dot_x_in_wrapper = Y_AXIS_LABEL_WIDTH + initialSpacing = wrapperWidth/2
  //   → initialSpacing = wrapperWidth/2 - Y_AXIS_LABEL_WIDTH
  const cardCenterInPlotCoords = wrapperWidth / 2 - Y_AXIS_LABEL_WIDTH;
  if (n <= 1) return { ...base, initialSpacing: cardCenterInPlotCoords, spacing: 0 };
  if (n >= FILL_AT_N) {
    return { ...base, initialSpacing: MIN_PAD, spacing: (dataAreaWidth - 2 * MIN_PAD) / (n - 1) };
  }
  const filledSpacing = (dataAreaWidth - 2 * MIN_PAD) / (FILL_AT_N - 1);
  const groupWidth = (n - 1) * filledSpacing;
  return { ...base, initialSpacing: cardCenterInPlotCoords - groupWidth / 2, spacing: filledSpacing };
}

/**
 * The chart's React key: a new chart for every series it draws. gifted-charts
 * draws the line inside a box whose width it animates open ONCE, to the width
 * of the data the chart mounted with (`initialSpacing + n × spacing +
 * endSpacing`), and never again (its animation callback doesn't watch the
 * data). The page keeps one chart through every exercise picked and every
 * session logged, so one first drawn with a single session cut every longer
 * series off there: two dots and half a line where the third session should
 * be. Keyed on the series and everything that width depends on, the line draws
 * in afresh to its own width.
 */
export function exerciseChartKey(exerciseName: string, day: string, n: number, layout: ExerciseChartLayout): string {
  return `${exerciseName}|${day}|${n}|${layout.chartWidth}`;
}

/** Session `i`'s dot, across the card's inner width (the same x the dates,
 *  the tap columns and the pop-up use). */
export function dotX(layout: ExerciseChartLayout, i: number): number {
  return Y_AXIS_LABEL_WIDTH + layout.initialSpacing + i * layout.spacing;
}

/** A dot's height from the plot's top, for a value on `axis` (which runs
 *  from `min`, zero when it has none). */
export function dotY(value: number, axis: { min?: number; max: number }): number {
  const min = axis.min ?? 0;
  return GIFTED_TOP_PAD + CHART_HEIGHT - ((value - min) / (axis.max - min)) * CHART_HEIGHT;
}

/**
 * The pop-up card's left edge across the card's inner width, for a dot at
 * `x`: centred over the dot, clamped to the card's edges so an edge dot doesn't
 * push it outside the NeuCard (the caret stays on the dot).
 */
export function tooltipLeft(layout: ExerciseChartLayout, x: number): number {
  return Math.min(Math.max(x - TOOLTIP_W / 2, -6), layout.wrapperWidth - TOOLTIP_W + 6);
}

/** The exercise chart's y-axis, which runs from `min` rather than from zero. */
export type ExerciseChartAxis = NiceAxis & { min: number };

/** The least the y-axis covers, as a share of the highest value. */
const MIN_SPAN_SHARE = 0.2;
/** Room left above the highest session and below the lowest, as a share of
 *  their span: for the dots and the pop-up. */
const EDGE_ROOM = 0.1;

/** The axis' round steps: these times a power of ten. Finer than niceAxis' 1,
 *  2, 2.5, 5: a gap of 2× between one step and the next could leave half the
 *  plot standing empty, which is the squeeze this axis is here to undo. */
const STEP_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

/** The smallest round step at or above `x`. A whole number when the values
 *  are (reps): never "22.5 reps". */
function roundStep(x: number, whole: boolean): number {
  const target = x > 0 ? x : 1;
  for (let exp = Math.floor(Math.log10(target)); ; exp++) {
    for (const m of STEP_MANTISSAS) {
      const s = Math.round(m * Math.pow(10, exp) * 1e9) / 1e9;
      if (s >= target - 1e-12 && (!whole || (s >= 1 && Number.isInteger(s)))) return s;
    }
  }
}

/** A tick, in the units the axis is read in: "57.5", "1.25k". */
function fmtTick(v: number, axisMax: number): string {
  if (v === 0) return "0";
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  return axisMax >= 1000 ? `${trim(v / 1000)}k` : trim(v);
}

/** Four steps of `step` up from `min`, labelled. */
function axisFrom(min: number, step: number): ExerciseChartAxis {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const max = r(min + 4 * step);
  return {
    min: r(min),
    max,
    stepValue: step,
    labels: [0, 1, 2, 3, 4].map(i => fmtTick(r(min + i * step), max)),
  };
}

/**
 * The y-axis for the plotted values, oldest session first: zoomed to them, so
 * the change from one session to the next is what fills the plot. Every metric
 * (kg, or reps) is read the same way:
 *   - The lowest and highest sessions sit inside the plot, a tenth of their
 *     span clear of each edge.
 *   - It never covers less than a fifth of the highest value, so a small
 *     wobble stays small (a 1 kg dip on 60 kg moves a dot a few percent of the
 *     plot) and a lone session or a flat run sits in the middle, or within
 *     half a step of it.
 *   - Four round steps up from a round bottom ("55, 57.5, 60", never
 *     "54.4"; whole steps for whole numbers), the bottom that puts the values
 *     most central, and never below zero.
 * It used to run from zero with the first session on the middle line, which
 * drew every metric as its ratio to the first session: Heaviest and Best Set
 * (Heaviest times the reps, for anyone doing the same reps every week) landed
 * on the same dots, and a 10% gain moved a dot 5% of the plot (user report,
 * 2026-10-08). The chart is handed each value less `min` (gifted-charts plots
 * from zero), with these labels.
 * Empty (or all zero): a clean 0–100 grid.
 */
export function exerciseChartAxis(values: number[]): ExerciseChartAxis {
  const hi = values.reduce((m, v) => (v > m ? v : m), 0);
  if (hi <= 0) return { ...niceAxis(hi, 4), min: 0 };
  const lo = values.reduce((m, v) => (v < m ? v : m), hi);
  const span = Math.max(hi - lo, hi * MIN_SPAN_SHARE);
  const mid = (hi + lo) / 2;
  const top = mid + span * (0.5 + EDGE_ROOM);
  const bottom = Math.max(0, mid - span * (0.5 + EDGE_ROOM));
  const whole = values.every(Number.isInteger);
  // The smallest round step that fits, up a size whenever no round bottom
  // reaches the top; of the round bottoms that do, the most central.
  let step = roundStep((top - bottom) / 4, whole);
  for (let i = 0; i < 8; i++) {
    let best: number | null = null;
    for (let k = Math.floor(bottom / step + 1e-9); k >= 0; k--) {
      const min = k * step;
      if (min + 4 * step < top - 1e-9) break;
      if (best === null || Math.abs(min + 2 * step - mid) < Math.abs(best + 2 * step - mid)) best = min;
    }
    if (best !== null) return axisFrom(best, step);
    step = roundStep(step * 1.0001, whole);
  }
  return axisFrom(0, roundStep(top / 4, whole));
}

/** The x-axis date, "5 Oct": day first, the month by name. "10/5" read as the
 *  10th of May to anyone who writes the day first, the app's own order. */
function fmtAxisDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

/** How far apart two month names must sit, px (a name is about 18 wide). */
const MONTH_LABEL_GAP = 26;

/**
 * The date under each dot ("" for none), oldest first, for dots `spacing` px
 * apart (ExerciseChartLayout.spacing).
 *
 * Until the sessions span about three calendar months, the date ("5 Oct")
 * under about five of them, whatever the count (stride 1 labels every point; larger
 * strides space them out). Past that, each month's short name ONCE, under its
 * first session: picked by stride, the names repeated ("Sep Sep Oct Oct Dec")
 * and there was no telling where a month began. A name that would sit on top
 * of the one before is left off. Never the same text twice in a row.
 */
export function exerciseChartLabels(dates: string[], spacing = Number.POSITIVE_INFINITY): string[] {
  const out = dates.map(() => "");
  const monthLabels = (() => {
    if (dates.length < 2) return false;
    const [y1, m1] = dates[0].split("-").map(Number);
    const [y2, m2] = dates[dates.length - 1].split("-").map(Number);
    if (![y1, m1, y2, m2].every(Number.isFinite)) return false;
    return (y2 - y1) * 12 + (m2 - m1) >= 3;
  })();
  if (!monthLabels) {
    const stride = Math.max(1, Math.ceil(dates.length / 5));
    let last = "";
    dates.forEach((date, i) => {
      if (i % stride !== 0) return;
      const text = fmtAxisDate(date);
      if (text === last) return;
      out[i] = text;
      last = text;
    });
    return out;
  }
  const minGap = spacing > 0 ? Math.ceil(MONTH_LABEL_GAP / spacing) : 1;
  let lastMonth = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  dates.forEach((date, i) => {
    const [y, m] = date.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    const month = `${y}-${m}`;
    if (month === lastMonth) return;
    lastMonth = month;
    if (i - lastAt < minGap) return;
    out[i] = MONTH_NAMES[(m - 1) % 12].slice(0, 3);
    lastAt = i;
  });
  return out;
}
