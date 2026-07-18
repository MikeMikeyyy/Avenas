import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { niceAxis } from "../utils/niceAxis";
import { MONTH_NAMES } from "../utils/dates";
import type {
  ExerciseDataPoint,
  ExerciseMetricKey,
  PRs,
} from "../constants/progress";
import { EXERCISE_METRIC_OPTIONS } from "../constants/progress";

interface Props {
  exerciseName: string;
  /**
   * Workout-day label the `history`/`prs` are scoped to (progress is tracked
   * per (day, exercise) pair — see ExerciseSelection). Shown in the header so
   * "Lateral Raises on Push" and "Lateral Raises on Arms" read as distinct,
   * and forwarded to the full-history page so it stays on the same slice.
   */
  dayName?: string;
  history: ExerciseDataPoint[];
  prs: PRs;
  /** "kg" | "lbs" */
  unit: string;
}

function fmtShortDate(ymd: string): string {
  // "YYYY-MM-DD" → "3 Mar"
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

function fmtAxisDate(ymd: string): string {
  // Compact x-axis label: "3/14"
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${m}/${d}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

// Per-metric y-value lookup so axis / data / focused-header all read from a
// single source of truth.
function metricValue(p: ExerciseDataPoint, m: ExerciseMetricKey): number {
  switch (m) {
    case "topWeight":     return p.topWeight;
    case "bestSetVolume": return p.bestSetVolume;
    case "sessionVolume": return p.sessionVolume;
    case "totalReps":     return p.totalReps;
  }
}

// Build an axis pinned to an EXACT max (not rounded up to a "nice" number) —
// the progression chart's first-point-centered scaling needs precise point
// placement, and niceAxis's round-up would leave the line anywhere between
// 50% and ~100% depending on where the value falls under the next nice
// ceiling. Tick labels mirror niceAxis's "k"-suffix rules so the two styles
// read the same.
function exactAxis(exactMax: number) {
  const stepValue = exactMax / 4;
  const fmtTick = (v: number): string => {
    if (v === 0) return "0";
    if (exactMax >= 1000) {
      const n = v / 1000;
      return Number.isInteger(n) ? `${n}k` : `${n.toFixed(1)}k`;
    }
    if (exactMax >= 10) return Number.isInteger(v) ? `${v}` : `${Math.round(v)}`;
    return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  };
  return {
    max: exactMax,
    stepValue,
    labels: [0, 1, 2, 3, 4].map(i => fmtTick(stepValue * i)),
  };
}

// Format the focused-point header per metric. `unit` is appended only to the
// weight-based metrics; totalReps shows a "reps" suffix instead. For Best
// Set the user wants the weight × reps combination that produced the best
// volume, not just the product.
function formatFocused(p: ExerciseDataPoint, m: ExerciseMetricKey, unit: string): string {
  const d = fmtShortDate(p.date);
  switch (m) {
    case "topWeight":
      return `${d}  ·  ${fmtNum(p.topWeight)} ${unit} × ${p.topReps}`;
    case "bestSetVolume":
      return `${d}  ·  ${fmtNum(p.bestSetWeight)} ${unit} × ${p.bestSetReps}`;
    case "sessionVolume":
      return `${d}  ·  ${fmtNum(p.sessionVolume)} ${unit}`;
    case "totalReps":
      return `${d}  ·  ${p.totalReps} reps`;
  }
}

/**
 * Per-exercise weight-progression line chart with PR tiles below.
 * - Y-axis uses first-point-centered exact scaling (see `axis`): the first
 *   visible session sits on the middle gridline until the trend outgrows it,
 *   then the peak anchors at 90% of the plot.
 * - Tapping a point highlights it and shows date/weight/reps above the chart.
 * - Tapping a PR tile routes to that PR's source workout via /workout-detail.
 */
export default function ExerciseProgressionChart({ exerciseName, dayName, history, prs, unit }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Which metric the chart plots. Default to the original behavior (heaviest
  // working set per session).
  const [metric, setMetric] = useState<ExerciseMetricKey>("topWeight");

  // Every session passed in is plotted — no time-range filter, deliberately.
  // The parent already scopes `history` to the selected program (bounded by
  // its start/completed dates) and workout day, and the whole point of this
  // chart is the full progression across that program's duration. Neither the
  // page-level Volume range nor any local dropdown should slice it.

  // Clear focus when the underlying data slice or active metric changes.
  useEffect(() => {
    setFocusedIndex(null);
  }, [exerciseName, dayName, history.length, metric]);

  // Label style: compact "M/D" for short spans; once the plotted history
  // crosses ~3 calendar months, month names read better.
  const monthLabels = useMemo(() => {
    if (history.length < 2) return false;
    const [y1, m1] = history[0].date.split("-").map(Number);
    const [y2, m2] = history[history.length - 1].date.split("-").map(Number);
    if (![y1, m1, y2, m2].every(Number.isFinite)) return false;
    return (y2 - y1) * 12 + (m2 - m1) >= 3;
  }, [history]);

  const axis = useMemo(() => {
    const max = history.reduce((m, p) => {
      const v = metricValue(p, metric);
      return v > m ? v : m;
    }, 0);

    // Empty history → niceAxis's default empty axis (clean 0–100 grid).
    if (max <= 0) return niceAxis(max, 4);

    // First-point-centered scaling, uniform across all four metrics (each has
    // its own scale — kg, reps, kg·reps — so only an exact axis can place
    // them consistently; niceAxis's round-up left the line anywhere from the
    // middle to flush with the top depending on the value):
    //   - The FIRST session anchors the middle gridline (axis max =
    //     2× its value): a lone dot sits dead-center, a flat run stays
    //     centered, and later, higher sessions climb from the center toward
    //     the top — the incline reads immediately.
    //   - Once the trend outgrows that anchor (peak > 2× first), the peak
    //     takes over and sits at 90% of the plot, with earlier sessions
    //     falling to the middle/bottom. The 0.9 also hands the regimes over
    //     smoothly: at peak = 2×first the first point reads 50% → 45%.
    // Every point is positive here (collectExerciseHistory drops zero-volume
    // sessions), so `first` can't be 0.
    const first = metricValue(history[0], metric);
    return exactAxis(max <= first * 2 ? first * 2 : max / 0.9);
  }, [history, metric]);

  const focused = focusedIndex != null ? history[focusedIndex] ?? null : null;

  // Day context leads the subline (e.g. "Push · Sessions logged · 4") so two
  // day-scoped charts for the same exercise name are visually distinct.
  const headerLabel = (() => {
    const day = dayName?.trim() ? `${dayName.trim()} · ` : "";
    if (focused) return `${day}${formatFocused(focused, metric, unit)}`;
    if (history.length === 0) return `${day}No sessions yet`;
    return `${day}Sessions logged · ${history.length}`;
  })();

  // Target ~5 visible x-axis labels regardless of how many points exist.
  // Stride 1 → every point labelled; larger strides space them out.
  const stride = Math.max(1, Math.ceil(history.length / 5));

  const data = useMemo(
    () =>
      history.map((p, i) => {
        // Month-spanning history labels with the short month name (e.g.
        // "Mar"); shorter spans use compact "M/D".
        const labelText = (() => {
          if (i % stride !== 0) return "";
          if (monthLabels) {
            const [, m] = p.date.split("-").map(Number);
            if (!Number.isFinite(m)) return "";
            return MONTH_NAMES[(m - 1) % 12].slice(0, 3);
          }
          return fmtAxisDate(p.date);
        })();
        return {
          value: metricValue(p, metric),
          label: labelText,
          showStrip: i === focusedIndex,
          // Highlight the focused dot with a brighter ACCT.
          dataPointColor: i === focusedIndex ? ACCT : `${ACCT}E6`,
          dataPointRadius: i === focusedIndex ? 5 : 3,
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setFocusedIndex(prev => (prev === i ? null : i));
          },
        };
      }),
    [history, focusedIndex, stride, monthLabels, metric],
  );

  const cardWidth = Math.min(screenWidth - 40, 420);

  // Layout constants — kept in sync with the LineChart props below so we can
  // compute the available data area where the dots actually live.
  const Y_AXIS_LABEL_WIDTH = 32;
  const CHART_HEIGHT = 170;
  const CHART_WIDTH = cardWidth - 80;
  const DATA_AREA_WIDTH = CHART_WIDTH - Y_AXIS_LABEL_WIDTH;
  // NeuCard inner content area = cardWidth minus the card's 16px horizontal
  // padding on each side. This is the visual "center" the user perceives.
  const WRAPPER_WIDTH = cardWidth - 32;

  // Dynamic spacing so the points always feel balanced inside the chart:
  //   • 1 point  → at the wrapper's true horizontal midpoint (= the card's
  //                visual center). Robust regardless of whether gifted-charts
  //                stretches the chart to fill the wrapper or honors its
  //                `width` prop, because the dot sits where the user reads
  //                "the middle of the card" either way.
  //   • 2..5 pts → constant per-point gap (same as the filled 6-point gap),
  //                with the group centered around that same midpoint.
  //   • 6+ pts   → edge-to-edge of the plot zone: first point near left,
  //                last near right.
  //   • >6 pts   → spacing shrinks naturally so all points fit.
  //
  // `endSpacing` is ALWAYS pinned to MIN_PAD — a large endSpacing makes
  // gifted-charts render the chart wider than the `width` prop suggests
  // (its x-axis line stretches to fit the reserved right margin), which
  // re-extends the chart to the card's right edge.
  const { initialSpacing, endSpacing, spacing } = useMemo(() => {
    const MIN_PAD = 12;
    const FILL_AT_N = 6;
    const n = data.length;
    // For the dot to sit AT the wrapper's horizontal midpoint, expressed as
    // an `initialSpacing` offset from the y-axis line:
    //   dot_x_in_wrapper = Y_AXIS_LABEL_WIDTH + initialSpacing = WRAPPER_WIDTH/2
    //   → initialSpacing = WRAPPER_WIDTH/2 - Y_AXIS_LABEL_WIDTH
    const cardCenterInPlotCoords = WRAPPER_WIDTH / 2 - Y_AXIS_LABEL_WIDTH;
    if (n <= 1) {
      return {
        initialSpacing: cardCenterInPlotCoords,
        endSpacing: MIN_PAD,
        spacing: 0,
      };
    }
    if (n >= FILL_AT_N) {
      return {
        initialSpacing: MIN_PAD,
        endSpacing: MIN_PAD,
        spacing: (DATA_AREA_WIDTH - 2 * MIN_PAD) / (n - 1),
      };
    }
    const filledSpacing = (DATA_AREA_WIDTH - 2 * MIN_PAD) / (FILL_AT_N - 1);
    const groupWidth = (n - 1) * filledSpacing;
    const initialSpacing = cardCenterInPlotCoords - groupWidth / 2;
    return { initialSpacing, endSpacing: MIN_PAD, spacing: filledSpacing };
  }, [data.length, WRAPPER_WIDTH, Y_AXIS_LABEL_WIDTH, DATA_AREA_WIDTH]);

  const goToWorkout = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/workout-detail", params: { id: workoutId } });
  };

  return (
    <>
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{exerciseName}</Text>
            <Text style={[styles.headerValue, { color: focused ? ACCT : t.ts }]} numberOfLines={1}>
              {headerLabel}
            </Text>
          </View>
        </View>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              No working sets logged for this exercise yet.
            </Text>
          </View>
        ) : (
            <View style={{ marginTop: 10, alignSelf: "stretch", position: "relative" }}>
              <LineChart
                data={data}
                color={ACCT}
                thickness={2.5}
                curved
                areaChart
                startFillColor={ACCT}
                endFillColor={ACCT}
                startOpacity={0.25}
                endOpacity={0.02}
                isAnimated
                animationDuration={400}
                yAxisThickness={1}
                xAxisThickness={1}
                yAxisColor={t.div}
                xAxisColor={t.div}
                rulesType="dashed"
                rulesColor={t.div}
                rulesThickness={1}
                dashWidth={3}
                dashGap={4}
                yAxisLabelTexts={axis.labels}
                maxValue={axis.max}
                stepValue={axis.stepValue}
                noOfSections={4}
                // We render x-axis labels ourselves below; suppress the
                // chart's reserved built-in label band so our custom row
                // sits flush against the x-axis line.
                xAxisLabelsHeight={0}
                yAxisTextStyle={{ color: t.ts, fontFamily: FontFamily.regular, fontSize: 10 }}
                // gifted-charts' LineChart draws its x-axis line further past
                // `width` than BarChart does, so even with matching `width`
                // and `yAxisLabelWidth` the line touches the card's right
                // edge. Subtracting an extra 32px (=yAxisLabelWidth) brings
                // the LineChart's right edge in line with the BarChart above.
                yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
                initialSpacing={initialSpacing}
                endSpacing={endSpacing}
                spacing={spacing}
                focusEnabled
                showStripOnFocus
                stripColor={t.div}
                hideDataPoints={false}
                dataPointsColor={ACCT}
                dataPointsRadius={3}
              />

              {/*
                Touch overlay. The visible dots are tiny (radius 3), so relying
                on gifted-charts' per-point hit area makes them very hard to
                tap. Instead we tile transparent full-height columns across the
                plot — one per point, centered on the same dot x the custom
                x-labels use — so a tap anywhere in a point's vertical band
                focuses it. The dots/line below stay visible; these are tap-only
                targets so vertical scrolling still passes through to the
                ScrollView.
              */}
              <View
                pointerEvents="box-none"
                style={[styles.hitOverlay, { height: CHART_HEIGHT }]}
              >
                {data.map((_, i) => {
                  const dotX = Y_AXIS_LABEL_WIDTH + initialSpacing + i * spacing;
                  const left = i === 0 ? 0 : dotX - spacing / 2;
                  const right = i === data.length - 1 ? CHART_WIDTH : dotX + spacing / 2;
                  const width = Math.max(0, right - left);
                  const p = history[i];
                  return (
                    <TouchableOpacity
                      key={`hit-${i}`}
                      activeOpacity={1}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setFocusedIndex(prev => (prev === i ? null : i));
                      }}
                      style={{ position: "absolute", top: 0, height: CHART_HEIGHT, left, width }}
                      accessibilityRole="button"
                      accessibilityLabel={p ? `Show ${exerciseName} on ${fmtShortDate(p.date)}` : undefined}
                    />
                  );
                })}
              </View>

              {/*
                Custom x-axis labels. gifted-charts' built-in LineChart label
                rendering doesn't reliably show labels for short series (and
                doesn't honor our custom `initialSpacing`/`spacing` for label
                positions when it does), so we draw our own below the chart
                using the SAME positioning math the chart uses for the dots.
              */}
              <View pointerEvents="none" style={styles.xLabelsRow}>
                {data.map((d, i) => {
                  if (!d.label) return null;
                  const dotX = Y_AXIS_LABEL_WIDTH + initialSpacing + i * spacing;
                  return (
                    <Text
                      key={i}
                      numberOfLines={1}
                      style={[styles.xLabel, { color: t.ts, left: dotX - 20 }]}
                    >
                      {d.label}
                    </Text>
                  );
                })}
              </View>
            </View>
        )}

        {/* Metric selector — Heaviest / Best Set / Volume / Reps. Same
            discrete-button pattern as VolumeBarChart's metric row above:
            inactive buttons are NeuCard pills, the active one is an
            ACCT-filled pill with a matching shadow glow. */}
        <View style={styles.metricRow}>
          {EXERCISE_METRIC_OPTIONS.map(opt => {
            const active = opt.key === metric;
            return (
              <BounceButton
                key={opt.key}
                style={styles.metricBtnWrap}
                onPress={() => setMetric(opt.key)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${opt.label}`}
              >
                {active ? (
                  <View style={styles.metricBtnActive}>
                    <Text style={[styles.metricBtnLabel, { color: "#fff" }]} numberOfLines={1}>
                      {opt.label}
                    </Text>
                  </View>
                ) : (
                  <NeuCard dark={isDark} radius={12} shadowSize="sm">
                    <View style={styles.metricBtn}>
                      <Text style={[styles.metricBtnLabel, { color: t.tp }]} numberOfLines={1}>
                        {opt.label}
                      </Text>
                    </View>
                  </NeuCard>
                )}
              </BounceButton>
            );
          })}
        </View>
      </View>
    </NeuCard>

    {/* Section header for the PR block. */}
    <Text style={[styles.prHeader, { color: t.tp }]}>Personal Records</Text>

    {/* PR tiles — sit BELOW the chart card in a 2×2 grid, derived from the
        same full scoped history the chart plots. */}
    <View style={styles.prGrid}>
      <View style={styles.prRow}>
        <PRTile
          label="Heaviest"
          value={prs.heaviest ? `${fmtNum(prs.heaviest.value)} ${unit}` : "—"}
          sub={prs.heaviest ? fmtShortDate(prs.heaviest.date) : "—"}
          onPress={prs.heaviest ? () => goToWorkout(prs.heaviest!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
        <PRTile
          label="Best 1RM"
          value={prs.oneRepMax ? `${fmtNum(Math.round(prs.oneRepMax.value))} ${unit}` : "—"}
          sub={
            prs.oneRepMax
              ? `${fmtShortDate(prs.oneRepMax.date)}  ·  ${fmtNum(prs.oneRepMax.weight ?? 0)}×${prs.oneRepMax.reps ?? 0}`
              : "—"
          }
          onPress={prs.oneRepMax ? () => goToWorkout(prs.oneRepMax!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
      </View>
      <View style={styles.prRow}>
        <PRTile
          label="Best Set"
          value={prs.bestSetVolume ? `${fmtNum(prs.bestSetVolume.value)} ${unit}` : "—"}
          sub={prs.bestSetVolume ? fmtShortDate(prs.bestSetVolume.date) : "—"}
          onPress={prs.bestSetVolume ? () => goToWorkout(prs.bestSetVolume!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
        <PRTile
          label="Best Session"
          value={prs.bestSessionVolume ? `${fmtNum(prs.bestSessionVolume.value)} ${unit}` : "—"}
          sub={prs.bestSessionVolume ? fmtShortDate(prs.bestSessionVolume.date) : "—"}
          onPress={prs.bestSessionVolume ? () => goToWorkout(prs.bestSessionVolume!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
      </View>
    </View>

    {/* "See exercise history" — primary CTA. ACCT-filled with a matching
        shadow glow so it stands apart from the neutral NeuCards around it
        (per CLAUDE.md: "primary = ACCT bg + ACCT shadow glow"). */}
    <BounceButton
      style={styles.historyBtnWrap}
      onPress={() => {
        router.push({
          pathname: "/exercise-history",
          params: { exerciseName, ...(dayName ? { dayName } : {}) },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`See full history for ${exerciseName}`}
    >
      <View style={styles.historyBtn}>
        <Text style={styles.historyBtnLabel} numberOfLines={1}>
          See Exercise History
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </View>
    </BounceButton>
    </>
  );
}

function PRTile({
  label,
  value,
  sub,
  onPress,
  dark,
  textPrimary,
  textSecondary,
}: {
  label: string;
  value: string;
  sub: string;
  onPress: (() => void) | null;
  dark: boolean;
  textPrimary: string;
  textSecondary: string;
}) {
  const inner = (
    <NeuCard dark={dark} radius={14} shadowSize="sm">
      <View style={styles.prInner}>
        <Text style={[styles.prLabel, { color: textSecondary }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.prValue, { color: textPrimary }]} numberOfLines={1}>{value}</Text>
        <Text style={[styles.prSub, { color: textSecondary }]} numberOfLines={1}>{sub}</Text>
      </View>
    </NeuCard>
  );
  if (!onPress) {
    return <View style={styles.prCell}>{inner}</View>;
  }
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.prCell} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      {inner}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  title: { fontFamily: FontFamily.bold, fontSize: 18 },
  headerValue: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },

  // Metric selector row — Heaviest / Best Set / Volume / Reps. Mirror of the
  // VolumeBarChart metric row so the two charts feel visually consistent.
  metricRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 8,
  },
  metricBtnWrap: {
    flex: 1,
  },
  metricBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  metricBtnActive: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: ACCT,
    shadowColor: ACCT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  metricBtnLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
  },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    textAlign: "center",
  },

  // "Personal Records" section header above the PR grid. Same bold-18
  // family as DayExerciseList's "Exercise Progress" header so the two
  // section blocks read as siblings.
  prHeader: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    marginHorizontal: 20,
    marginTop: 36,
    marginBottom: 12,
  },

  // PR tile grid — 2 columns × 2 rows. Outer container holds the per-row
  // spacing; each inner `prRow` is a flex row of two tiles.
  prGrid: {
    marginHorizontal: 20,
    gap: 8,
  },
  prRow: {
    flexDirection: "row",
    gap: 8,
  },

  // "See exercise history" — primary ACCT-filled CTA. The shadow glow
  // matches the active metric button so primary actions feel consistent
  // across the page. Sits clearly apart from the surrounding NeuCards.
  historyBtnWrap: {
    marginTop: 14,
    marginHorizontal: 20,
  },
  historyBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
    borderRadius: 20,
    backgroundColor: ACCT,
    shadowColor: ACCT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 8,
    elevation: 8,
  },
  historyBtnLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: "#fff",
    flex: 1,
    textAlign: "center",
  },

  // Custom x-axis label row — sits directly below the LineChart, with each
  // label absolutely positioned at its data point's x coordinate. marginTop
  // matches the horizontal gap gifted-charts puts between the y-axis line
  // and its y-axis labels, so the two axes feel visually consistent.
  // Transparent tap-target layer sized to the LineChart's plot. Columns are
  // absolutely positioned children, so this just needs to pin to the top-left
  // of the chart; its height is set inline to CHART_HEIGHT.
  hitOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  xLabelsRow: {
    position: "relative",
    height: 14,
    marginTop: 2,
  },
  xLabel: {
    position: "absolute",
    top: 0,
    width: 40, // 40px box centered on the data point (left offset is dotX-20)
    textAlign: "center",
    fontSize: 10,
    fontFamily: FontFamily.regular,
  },
  prCell: { flex: 1 },
  prInner: { padding: 12, alignItems: "flex-start" },
  prLabel: { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.5 },
  prValue: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: 4 },
  prSub: { fontFamily: FontFamily.regular, fontSize: 10, marginTop: 2 },
});
