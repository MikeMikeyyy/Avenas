import { useMemo } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import NeuCard from "./NeuCard";
import DropdownPicker from "./DropdownPicker";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { RADAR_GROUPS } from "../utils/muscleGroups";
import { toDisplayWeight } from "../utils/units";
import type { MuscleGroupStat, StrengthMetricKey } from "../constants/progress";
import { STRENGTH_METRIC_OPTIONS } from "../constants/progress";
import type { SelectableMuscle } from "../constants/exercises";

interface Props {
  /** Per-muscle-group aggregates (volume / sessions / sets) for the active window. */
  stats: Record<SelectableMuscle, MuscleGroupStat>;
  /**
   * Same aggregates for the previous comparable window (see
   * previousComparableWindow in utils/progressStats.ts) — drives the per-group
   * ▲/▼ trend and the muted "Previous" polygon. Omitted, or empty of training,
   * means no arrows and no previous polygon (e.g. a brand-new user with no
   * baseline to compare against).
   */
  prevStats?: Record<SelectableMuscle, MuscleGroupStat>;
  /** "kg" | "lbs" — appended to volume labels. */
  unit: string;
  /**
   * Inclusive day count of the active window (see windowLengthDays in
   * utils/progressStats.ts) — scales the per-week full-scale benchmarks to
   * the selected range. The previous comparable window has the same length.
   */
  windowDays: number;
  metric: StrengthMetricKey;
  onMetricChange: (m: StrengthMetricKey) => void;
}

// Leading icon per metric: a heavy weight for Total Volume, a rotating icon
// for Workout Frequency (distinct from the swap arrows used elsewhere), and
// the app's canonical dumbbell for Muscular Load. Shared by the card header
// and the metric picker's sheet rows so the list mirrors the header.
const ICON_SIZE = 18;
function metricIcon(m: StrengthMetricKey, color: string) {
  if (m === "volume") return <MaterialCommunityIcons name="weight" size={ICON_SIZE} color={color} />;
  if (m === "frequency") return <MaterialCommunityIcons name="autorenew" size={ICON_SIZE + 1} color={color} />;
  return <DumbbellIcon size={ICON_SIZE} color={color} />;
}

// ─── geometry helpers ────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Vertex angle for axis i. The hexagon is FLAT-TOPPED: the first two axes
// straddle the top edge (Chest top-left at -120°, Back top-right at -60°),
// then clockwise every 60° — so the top and bottom of the chart are edges,
// not points.
const axisAngle = (i: number) => -120 + i * 60;

// Closed polygon through one point per axis (index order = RADAR_GROUPS order).
function polygonPath(cx: number, cy: number, radii: number[]): string {
  const pts = radii.map((r, i) => polar(cx, cy, r, axisAngle(i)));
  return `M ${pts.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")} Z`;
}

// ─── value formatting ──────────────────────────────────────────────────────--

function fmtVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString();
}

// ─── metric values & trends ──────────────────────────────────────────────────

type StatTotals = { volume: number; sets: number };

function sumTotals(stats: Record<SelectableMuscle, MuscleGroupStat>): StatTotals {
  let volume = 0;
  let sets = 0;
  for (const g of RADAR_GROUPS) {
    volume += stats[g].volume;
    sets += stats[g].sets;
  }
  return { volume, sets };
}

/**
 * The raw number a group contributes under the active metric. Load is the
 * group's count of completed working sets — NOT tonnage. A leg set moves
 * several times the weight of an arm set, so tonnage permanently skews the
 * radar toward Legs no matter how the user actually distributes training;
 * set counts are comparable across muscle groups (and also count bodyweight
 * work, which has no tonnage at all). Each group is then measured against the
 * benchmark-floored shared scale (see FULL_SCALE_PER_WEEK / fullScale); the
 * label just shows the real number.
 */
function metricRaw(s: MuscleGroupStat, metric: StrengthMetricKey): number {
  if (metric === "volume") return s.volume;
  if (metric === "frequency") return s.sessions;
  return s.sets;
}

// Change within ±5% of the previous window reads as "held steady" — no arrow.
// Keeps the labels calm for users with a consistent routine.
const TREND_BAND = 0.05;

type Trend = "up" | "down" | null;

// Trend compares the SAME quantity the label shows: tonnage for volume,
// sessions for frequency, working-set count for load — so every arrow simply
// means "more/less than the previous period".
function trendFor(current: number, previous: number): Trend {
  if (previous <= 0) return current > 0 ? "up" : null;
  if (current <= 0) return "down";
  const ratio = current / previous;
  if (ratio >= 1 + TREND_BAND) return "up";
  if (ratio <= 1 - TREND_BAND) return "down";
  return null;
}

// One-line explainer under the header so the numbers are never ambiguous.
const METRIC_CAPTIONS: Record<StrengthMetricKey, string> = {
  load: "Working sets per group",
  frequency: "Sessions that trained each group",
  volume: "Total weight lifted per group",
};

// Concentric hexagonal grid rings behind the polygon — quarters of the
// full-scale benchmark (see vertexRadius).
const GRID_LEVELS = 4;

// The MINIMUM a vertex must reach to touch the outer ring, per metric, for
// ONE week of training of ONE muscle group. Scaled by the window length (see
// fullScale) so a month-range chart expects ~4× the weekly amount. These are
// deliberate product anchors, not derived from the user's data: they are the
// FLOOR of the chart's scale, so a quiet week (2 sets on a Tuesday) can never
// max out the graph. When the user trains PAST a benchmark, the scale grows
// to the window's biggest group instead of clamping (see fullScale), so only
// the single largest number touches the ring.
//   load:      7 completed working sets — a solid weekly dose for one group.
//   frequency: 3 sessions touching the group — high frequency for anyone.
//   volume:    4,000 kg lifted — roughly 7 hard sets of a mid-weight compound.
const FULL_SCALE_PER_WEEK: Record<StrengthMetricKey, number> = {
  load: 7,
  frequency: 3,
  volume: 4000,
};

/**
 * Strength radar — a 6-axis muscle-group spider chart. The active metric
 * (Muscular Load / Workout Frequency / Total Volume) is chosen via the compact
 * top-right toggle, which opens a bottom sheet (DropdownPicker).
 *
 * Muscular Load (the default) counts working sets, not tonnage — see metricRaw
 * for why. Total Volume remains available for the raw tonnage numbers, whose
 * lower-body dominance is real information once it's labeled as weight lifted.
 *
 * Chart encoding: one connected polygon spans all six axes, each vertex placed
 * against a scale whose outer ring is the larger of an absolute weekly-training
 * benchmark (scaled to the window length) and the window's own biggest value —
 * so a quiet week can't max out, and past the benchmark only the single
 * largest group touches the ring (see FULL_SCALE_PER_WEEK / fullScale). The
 * current (ACCT) and previous (muted) polygons share that one scale, so their
 * overlap reads as real change. Behind them sits a hexagonal grid (GRID_LEVELS rings +
 * spokes). When `prevStats` contains training, each label also carries a
 * ▲ (ACCT) / ▼ (muted) vs the previous comparable window, and a
 * "Current Week / Previous Week" legend appears under the chart (ProgressView
 * pins the windows to exactly that — the radar is deliberately not tied to
 * the Volume chart's range filter). The per-axis labels always carry the
 * real numbers.
 */
export default function StrengthRadarChart({
  stats,
  prevStats,
  unit,
  windowDays,
  metric,
  onMetricChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { width: screenWidth } = useWindowDimensions();

  // Chart width = the card's inner content width (card = screen − 40 margins;
  // NeuCard inner padding = 16 each side).
  const S = Math.min(screenWidth - 40, 420) - 32;

  // ── layout ──────────────────────────────────────────────────────────────
  // The hexagon keeps its full size; labels adapt around it instead. The
  // side (Arms / Legs) labels are confined to the strip between their vertex
  // and the card edge (shrink-to-fit absorbs the narrowness), the top and
  // bottom pairs get a generous vertical gap off the graph plus an outward
  // horizontal spread so the two labels in a pair stay clearly apart. The
  // flat-top hexagon is shorter than it is wide (vertical half-extent
  // R·sin60°), so the chart box hugs the hexagon plus one label row above
  // and below instead of staying square.
  const R = S * 0.3; // outer grid-ring radius
  const GAP_V = 14; // vertical clearance between a top/bottom vertex and its label
  const GAP_SIDE = 6; // horizontal clearance between a side vertex and its label
  const PAIR_SPREAD = 12; // extra outward shift for the top/bottom pairs
  const LABEL_H = 38;
  const LABEL_W = S * 0.3;
  const HEX_HALF_H = R * Math.sin(Math.PI / 3);
  const H = Math.ceil(2 * (HEX_HALF_H + GAP_V + LABEL_H)) + 4;
  const cx = S / 2;
  const cy = H / 2;

  const activeOption =
    STRENGTH_METRIC_OPTIONS.find(o => o.key === metric) ?? STRENGTH_METRIC_OPTIONS[0];

  const totals = useMemo(() => sumTotals(stats), [stats]);
  const prevTotals = useMemo(() => (prevStats ? sumTotals(prevStats) : null), [prevStats]);

  // The previous polygon and the arrows need training on both sides of the
  // comparison: a previous window with at least one completed working set (the
  // baseline), and a current one too — otherwise a not-yet-touched week would
  // open on six ▼s. (Sets are counted for every completed working set,
  // weighted or not, so sets === 0 means the window truly holds no training.)
  const hasTrendBaseline =
    prevStats != null && prevTotals != null && prevTotals.sets > 0 && totals.sets > 0;

  // Per-group raw value (drives the polygon vertex) + display string + trend.
  const points = useMemo(() => {
    return RADAR_GROUPS.map((g, i) => {
      const s = stats[g];
      const raw = metricRaw(s, metric);
      let display: string;
      if (metric === "volume") {
        display = `${fmtVolume(s.volume)} ${unit}`;
      } else if (metric === "frequency") {
        // "3×" (trained 3 times) — the caption above spells out "sessions";
        // the long word would ellipsize past ~9 sessions and eat the arrow.
        display = `${Math.round(s.sessions)}×`;
      } else {
        // Rounded because multi-muscle custom exercises split set credit
        // fractionally across their groups (see computeMuscleGroupStats).
        const n = Math.round(raw);
        display = `${n} ${n === 1 ? "set" : "sets"}`;
      }
      const prevRaw = prevStats ? metricRaw(prevStats[g], metric) : 0;
      const trend: Trend = hasTrendBaseline ? trendFor(raw, prevRaw) : null;
      return { group: g, angle: axisAngle(i), raw, prevRaw, display, trend };
    });
  }, [stats, prevStats, hasTrendBaseline, metric, unit]);

  const hasData = useMemo(() => points.some(p => p.raw > 0), [points]);

  // Hexagonal grid: GRID_LEVELS concentric rings plus a spoke out to each
  // vertex. Straight-sided (polygon) rings, not circles — the spider-chart
  // look the rest of the polygon encoding depends on.
  const grid = useMemo(() => {
    const rings = Array.from({ length: GRID_LEVELS }, (_, k) => {
      const r = ((k + 1) / GRID_LEVELS) * R;
      return polygonPath(cx, cy, RADAR_GROUPS.map(() => r));
    });
    const spokes = RADAR_GROUPS.map((_, i) => {
      const p = polar(cx, cy, R, axisAngle(i));
      return `M ${cx} ${cy} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }).join(" ");
    return { rings, spokes };
  }, [cx, cy, R]);

  // "Smart" vertex radius: the outer ring is the LARGER of two candidates —
  //   1. the absolute benchmark FULL_SCALE_PER_WEEK[metric] × weeks, and
  //   2. the biggest value plotted this window (across both polygons).
  // The benchmark floor stops a quiet week from maxing out (2 sets after one
  // session reads as 2/7 of a solid week — never against the biggest group,
  // which would pin a vertex to the ring even when "biggest" is 2 sessions).
  // The peak candidate takes over once training EXCEEDS the benchmark: with
  // 12/10/8 sets the scale stretches to 12, so only the largest group touches
  // the ring instead of everything past the benchmark clamping there together.
  //
  // weeks is floored at 1 so a partial "this week" (Mon–today) still measures
  // against the FULL weekly benchmark. The peak spans the previous polygon's
  // values too (when drawn), so both polygons share one identical scale,
  // neither ever clamps, and their overlap reads as real change.
  //
  // Untrained (zero) groups still get a small stub (FLOOR), so the polygon
  // stays a closed shape that dips TOWARD the center on that axis instead of
  // degenerating into a line through it (e.g. a Shoulders-heavy week with 0
  // Core and 0 Legs).
  const FLOOR = 0.1;
  const weeks = Math.max(1, windowDays / 7);
  const fullScale = useMemo(() => {
    const perWeek = FULL_SCALE_PER_WEEK[metric];
    // Stats arrive already converted to the display unit, so the kg-denominated
    // volume benchmark must be converted the same way before comparing.
    const benchmark =
      metric === "volume"
        ? toDisplayWeight(perWeek * weeks, unit === "kg")
        : perWeek * weeks;
    const peak = points.reduce(
      (m, p) => Math.max(m, p.raw, hasTrendBaseline ? p.prevRaw : 0),
      0,
    );
    return Math.max(benchmark, peak);
  }, [metric, weeks, unit, points, hasTrendBaseline]);
  const vertexRadius = (raw: number) =>
    Math.max(FLOOR, Math.min(raw / fullScale, 1)) * R;

  const currentPath = useMemo(() => {
    if (!hasData) return null;
    return polygonPath(cx, cy, points.map(p => vertexRadius(p.raw)));
  }, [points, hasData, fullScale, cx, cy, R]);

  const prevPath = useMemo(() => {
    if (!hasTrendBaseline) return null;
    return polygonPath(cx, cy, points.map(p => vertexRadius(p.prevRaw)));
  }, [points, hasTrendBaseline, fullScale, cx, cy, R]);

  return (
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <View style={{ marginRight: 8 }}>{metricIcon(metric, t.ts)}</View>
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>
              {activeOption.label}
            </Text>
          </View>
          <DropdownPicker<StrengthMetricKey>
            value={metric}
            options={STRENGTH_METRIC_OPTIONS}
            onChange={onMetricChange}
            sheetTitle="Metric"
            triggerIcon="chevron-expand-outline"
            renderOptionIcon={k => metricIcon(k, t.ts)}
          />
        </View>

        {/* Just the metric explainer — the week-vs-week comparison is spelled
            out by the "Current Week / Previous Week" legend below instead. */}
        <Text style={[styles.caption, { color: t.ts }]} numberOfLines={1}>
          {METRIC_CAPTIONS[metric]}
        </Text>

        <View style={[styles.chartWrap, { width: S, height: H }]}>
          <Svg width={S} height={H}>
            {grid.rings.map((d, k) => (
              <Path
                key={`ring-${k}`}
                d={d}
                fill="none"
                stroke={t.ts}
                strokeOpacity={k === GRID_LEVELS - 1 ? 0.3 : 0.14}
                strokeWidth={1}
              />
            ))}
            <Path d={grid.spokes} fill="none" stroke={t.ts} strokeOpacity={0.14} strokeWidth={1} />
            {/* Previous window behind, current on top — overlap stays legible. */}
            {prevPath ? (
              <Path
                d={prevPath}
                fill={t.ts}
                fillOpacity={0.14}
                stroke={t.ts}
                strokeOpacity={0.6}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : null}
            {currentPath ? (
              <Path
                d={currentPath}
                fill={ACCT}
                fillOpacity={0.28}
                stroke={ACCT}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>

          {/* Labels sit fully OUTSIDE the hexagon. The top pair (Chest / Back)
              is centered directly above its vertex, the bottom pair (Core /
              Shoulders) directly below, and the side pair (Legs / Arms) fills
              the strip between its vertex and the card edge. */}
          {points.map(p => {
            const v = polar(cx, cy, R, p.angle);
            const rad = (p.angle * Math.PI) / 180;
            const sin = Math.sin(rad);
            // Top/bottom labels center on their vertex pushed PAIR_SPREAD px
            // away from the vertical midline, so the two labels of a pair sit
            // clearly apart instead of crowding the middle.
            const spreadX = v.x + Math.sign(v.x - cx) * PAIR_SPREAD;
            let left: number;
            let top: number;
            let width: number;
            if (sin < -0.5) {
              // top pair — whole box above the vertex
              width = LABEL_W;
              left = Math.max(2, Math.min(spreadX - LABEL_W / 2, S - LABEL_W - 2));
              top = v.y - GAP_V - LABEL_H;
            } else if (sin > 0.5) {
              // bottom pair — whole box below the vertex
              width = LABEL_W;
              left = Math.max(2, Math.min(spreadX - LABEL_W / 2, S - LABEL_W - 2));
              top = v.y + GAP_V;
            } else if (Math.cos(rad) > 0) {
              // right side — from just past the vertex to the card edge
              left = v.x + GAP_SIDE;
              width = S - left - 2;
              top = v.y - LABEL_H / 2;
            } else {
              // left side — from the card edge to just short of the vertex
              left = 2;
              width = v.x - GAP_SIDE - 2;
              top = v.y - LABEL_H / 2;
            }
            return (
              <View
                key={`label-${p.group}`}
                pointerEvents="none"
                style={[styles.label, { width, height: LABEL_H, left, top }]}
              >
                <Text
                  style={[styles.labelValue, { color: t.ts }]}
                  numberOfLines={1}
                  // Long volume strings ("22.5k lbs ▲") shrink instead of
                  // ellipsizing or spilling toward the grid.
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {p.display}
                  {p.trend ? (
                    // Direction is carried by the glyph itself; color is only a
                    // secondary cue (ACCT highlights gains, muted keeps dips calm).
                    <Text style={[styles.labelTrend, { color: p.trend === "up" ? ACCT : t.ts }]}>
                      {p.trend === "up" ? " ▲" : " ▼"}
                    </Text>
                  ) : null}
                </Text>
                <Text
                  style={[styles.labelName, { color: t.tp }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {p.group}
                </Text>
              </View>
            );
          })}
        </View>

        {prevPath ? (
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: ACCT }]} />
            <Text style={[styles.legendText, { color: t.ts }]}>Current Week</Text>
            <View style={[styles.legendDot, styles.legendGap, { backgroundColor: t.ts }]} />
            <Text style={[styles.legendText, { color: t.ts }]}>Previous Week</Text>
          </View>
        ) : null}
      </View>
    </NeuCard>
  );
}

const styles = StyleSheet.create({
  inner: {
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12,
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    flexShrink: 1,
  },
  caption: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
  },
  chartWrap: {
    alignSelf: "center",
    marginTop: 8,
    position: "relative",
  },
  label: {
    position: "absolute",
    justifyContent: "center",
  },
  labelValue: {
    fontFamily: FontFamily.semibold,
    fontSize: 15,
    textAlign: "center",
  },
  labelTrend: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
  },
  labelName: {
    fontFamily: FontFamily.bold,
    fontSize: 14,
    marginTop: 1,
    textAlign: "center",
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  legendGap: {
    marginLeft: 14,
  },
  legendText: {
    fontFamily: FontFamily.regular,
    fontSize: 12,
  },
});
