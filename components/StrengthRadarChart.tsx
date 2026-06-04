import { useMemo } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path, Polygon, Circle } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import NeuCard from "./NeuCard";
import DropdownPicker from "./DropdownPicker";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { RADAR_GROUPS } from "../utils/muscleGroups";
import type { MuscleGroupStat, StrengthMetricKey } from "../constants/progress";
import { STRENGTH_METRIC_OPTIONS } from "../constants/progress";
import type { SelectableMuscle } from "../constants/exercises";

interface Props {
  /** Per-muscle-group aggregates (volume / sessions / sets). */
  stats: Record<SelectableMuscle, MuscleGroupStat>;
  /** Σ volume across all groups — used to derive the "load" percentages. */
  totalVolume: number;
  /** "kg" | "lbs" — appended to volume labels. */
  unit: string;
  metric: StrengthMetricKey;
  onMetricChange: (m: StrengthMetricKey) => void;
}

// ─── geometry helpers ────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Center angle for axis i: Chest at top (-90°), then clockwise every 60°.
const axisAngle = (i: number) => -90 + i * 60;

const RAD2DEG = 180 / Math.PI;
const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

// Annular-sector ("petal segment") path between two radii, with softly rounded
// corners. The outer and inner arcs take their own angle pair so the side edges
// can be trimmed by a radius-dependent amount — that's what keeps the gap
// between adjacent wedges a constant *width* (rather than a constant angle,
// which tapers toward center). `cr` is the corner radius: each of the four
// corners backs off `cr` along both edges and is bridged by a quadratic curve
// through the original (sharp) corner, giving the petals a gentle rounded look.
function annularSector(
  cx: number,
  cy: number,
  ri: number,
  ro: number,
  a0o: number,
  a1o: number,
  a0i: number,
  a1i: number,
  cr: number,
): string {
  // Sharp corners (used as the quadratic control points).
  const C1 = polar(cx, cy, ro, a0o); // outer-left
  const C2 = polar(cx, cy, ro, a1o); // outer-right
  const C3 = polar(cx, cy, ri, a1i); // inner-right
  const C4 = polar(cx, cy, ri, a0i); // inner-left

  // Back-off along the arcs (angular) — clamped so it can't exceed the span.
  const dao = Math.min((cr / ro) * RAD2DEG, (a1o - a0o) * 0.4);
  const dai = Math.min((cr / ri) * RAD2DEG, (a1i - a0i) * 0.4);
  const Pout0 = polar(cx, cy, ro, a0o + dao);
  const Pout1 = polar(cx, cy, ro, a1o - dao);
  const Pin3 = polar(cx, cy, ri, a1i - dai);
  const Pin4 = polar(cx, cy, ri, a0i + dai);

  // Back-off along the (near-radial) side edges.
  const lr = Math.hypot(C3.x - C2.x, C3.y - C2.y) || 1;
  const tr = Math.min(0.45, cr / lr);
  const PrT = lerp(C2, C3, tr);
  const PrB = lerp(C3, C2, tr);
  const ll = Math.hypot(C1.x - C4.x, C1.y - C4.y) || 1;
  const tl = Math.min(0.45, cr / ll);
  const PlB = lerp(C4, C1, tl);
  const PlT = lerp(C1, C4, tl);

  const f = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return [
    `M ${f(Pout0)}`,
    `A ${ro} ${ro} 0 0 1 ${f(Pout1)}`, // outer arc
    `Q ${f(C2)} ${f(PrT)}`, // round outer-right
    `L ${f(PrB)}`, // right edge
    `Q ${f(C3)} ${f(Pin3)}`, // round inner-right
    `A ${ri} ${ri} 0 0 0 ${f(Pin4)}`, // inner arc
    `Q ${f(C4)} ${f(PlB)}`, // round inner-left
    `L ${f(PlT)}`, // left edge
    `Q ${f(C1)} ${f(Pout0)}`, // round outer-left
    "Z",
  ].join(" ");
}

// ─── value formatting ──────────────────────────────────────────────────────--

function fmtVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString();
}

/**
 * Strength radar — a 6-axis muscle-group breakdown. The active metric (Total
 * Volume / Workout Frequency / Muscular Load) is chosen via the compact
 * top-right toggle, which opens a bottom sheet (DropdownPicker). The polygon is
 * always normalized to the strongest group, so the shape reads as relative
 * balance regardless of metric; the per-axis labels carry the real numbers.
 */
export default function StrengthRadarChart({
  stats,
  totalVolume,
  unit,
  metric,
  onMetricChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { width: screenWidth } = useWindowDimensions();

  // Square the chart to the card's inner content width (card = screen − 40
  // margins; NeuCard inner padding = 16 each side).
  const S = Math.min(screenWidth - 40, 420) - 32;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.27; // outer petal radius
  const labelR = S * 0.4; // labels sit on this ring, radially aligned to each axis

  const activeOption =
    STRENGTH_METRIC_OPTIONS.find(o => o.key === metric) ?? STRENGTH_METRIC_OPTIONS[0];

  // Per-group raw value (drives polygon radius) + display string (the label).
  const points = useMemo(() => {
    return RADAR_GROUPS.map((g, i) => {
      const s = stats[g];
      let raw: number;
      let display: string;
      if (metric === "volume") {
        raw = s.volume;
        display = `${fmtVolume(s.volume)} ${unit}`;
      } else if (metric === "frequency") {
        raw = s.sessions;
        display = `${Math.round(s.sessions)} sessions`;
      } else {
        const pct = totalVolume > 0 ? (s.volume / totalVolume) * 100 : 0;
        raw = pct;
        display = `${Math.round(pct)}%`;
      }
      return { group: g, angle: axisAngle(i), raw, display };
    });
  }, [stats, totalVolume, metric, unit]);

  const maxRaw = useMemo(
    () => points.reduce((m, p) => (p.raw > m ? p.raw : m), 0),
    [points],
  );
  const hasData = maxRaw > 0;

  // Decorative petal base: 6 wedges × 3 concentric ring segments.
  // The side-gap between adjacent wedges is a constant *width* (≈2·g px) at
  // every radius: the angular trim per edge = g / r, so larger radii trim a
  // smaller angle. Clamped so the innermost ring can't over-trim past 0°.
  const petals = useMemo(() => {
    const hole = R * 0.16; // small center hole
    const ringGap = R * 0.04;
    const g = S * 0.009; // half-gap, in px (constant across radii)
    const band = (R - hole - 2 * ringGap) / 3;
    const cr = Math.min(band * 0.4, S * 0.014); // corner radius — a little curve
    const halfGapDeg = (r: number) => Math.min(24, (g / r) * RAD2DEG);
    const paths: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = axisAngle(i);
      for (let k = 0; k < 3; k++) {
        const ri = hole + k * (band + ringGap);
        const ro = ri + band;
        const to = halfGapDeg(ro);
        const ti = halfGapDeg(ri);
        paths.push(
          annularSector(cx, cy, ri, ro, c - 30 + to, c + 30 - to, c - 30 + ti, c + 30 - ti, cr),
        );
      }
    }
    return paths;
  }, [cx, cy, R, S]);

  // Data polygon vertices (normalized to the strongest group).
  const polygonPts = useMemo(() => {
    if (!hasData) return "";
    return points
      .map(p => {
        const r = (p.raw / maxRaw) * R;
        const { x, y } = polar(cx, cy, r, p.angle);
        return `${x},${y}`;
      })
      .join(" ");
  }, [points, maxRaw, hasData, cx, cy, R]);

  // Labels are placed on a ring (labelR) radially aligned with each axis, so
  // each one sits just outside the petal it describes. Boxes are centered on
  // the polar point and clamped so they never run off the card edge.
  const LABEL_H = 38;
  const LABEL_W = S * 0.3;

  // Leading header icon per metric: a heavy weight for Total Volume, a rotating
  // icon for Workout Frequency (distinct from the swap arrows used elsewhere),
  // and the app's canonical dumbbell for Muscular Load.
  const ICON_SIZE = 18;
  const metricIcon =
    metric === "volume" ? (
      <MaterialCommunityIcons name="weight" size={ICON_SIZE} color={t.ts} />
    ) : metric === "frequency" ? (
      <MaterialCommunityIcons name="autorenew" size={ICON_SIZE + 1} color={t.ts} />
    ) : (
      <DumbbellIcon size={ICON_SIZE} color={t.ts} />
    );

  return (
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <View style={{ marginRight: 8 }}>{metricIcon}</View>
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
          />
        </View>

        <View style={[styles.chartWrap, { width: S, height: S }]}>
          <Svg width={S} height={S}>
            {petals.map((d, idx) => (
              <Path key={`petal-${idx}`} d={d} fill={t.ts} fillOpacity={0.1} />
            ))}
            {hasData ? (
              <>
                <Polygon
                  points={polygonPts}
                  fill={ACCT}
                  fillOpacity={0.18}
                  stroke={ACCT}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {points.map(p => {
                  const r = (p.raw / maxRaw) * R;
                  const { x, y } = polar(cx, cy, r, p.angle);
                  return <Circle key={`dot-${p.group}`} cx={x} cy={y} r={3.5} fill={ACCT} />;
                })}
              </>
            ) : null}
          </Svg>

          {/* Labels sit OUTSIDE the petals, each radially aligned to its axis. */}
          {points.map(p => {
            const { x, y } = polar(cx, cy, labelR, p.angle);
            const left = Math.max(2, Math.min(x - LABEL_W / 2, S - LABEL_W - 2));
            const top = y - LABEL_H / 2;
            return (
              <View
                key={`label-${p.group}`}
                pointerEvents="none"
                style={[styles.label, { width: LABEL_W, height: LABEL_H, left, top }]}
              >
                <Text style={[styles.labelValue, { color: t.ts }]} numberOfLines={1}>
                  {p.display}
                </Text>
                <Text style={[styles.labelName, { color: t.tp }]} numberOfLines={1}>
                  {p.group}
                </Text>
              </View>
            );
          })}
        </View>
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
  labelName: {
    fontFamily: FontFamily.bold,
    fontSize: 14,
    marginTop: 1,
    textAlign: "center",
  },
});
