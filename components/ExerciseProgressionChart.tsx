import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { LinearGradient, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import SegmentedControl from "./SegmentedControl";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { pill, pillGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import { MONTH_NAMES } from "../utils/dates";
import {
  CHART_HEIGHT, GIFTED_TOP_PAD, TOOLTIP_W, Y_AXIS_LABEL_WIDTH,
  changeFromPrevious, chartChange, dotX, dotY, exerciseChartAxis, exerciseChartKey, exerciseChartLabels, exerciseChartLayout,
  fmtChange, metricValue, plottedPoints, tooltipLeft,
} from "../utils/exerciseChartLayout";
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
  /** Stable id of that day, forwarded alongside the label so the full-history
   *  page can scope to THIS day rather than to everything sharing its name. */
  dayId?: string;
  /** ...and its program, since every program's days are d0, d1…: without it
   *  the full-history page listed other programs' first days too. */
  programId?: string;
  history: ExerciseDataPoint[];
  prs: PRs;
  /** "kg" | "lbs" */
  unit: string;
  /** Set when a TRAINER is viewing a client's progress: the full history and
   *  every workout this chart opens read that client's copy, read-only. Without
   *  it they read the viewer's own storage, where a client's ids don't exist. */
  clientId?: string;
  /** Which metric the chart plots. Held by the page, which remembers it
   *  between visits (utils/progressSession.ts). */
  metric: ExerciseMetricKey;
  onMetricChange: (m: ExerciseMetricKey) => void;
}

function fmtShortDate(ymd: string): string {
  // "YYYY-MM-DD" → "3 Mar"
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

// A total moved (a session's, or a set's weight × reps), to the kilo:
// "4,560", never "10053.3".
function fmtTotal(n: number): string {
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "0";
}

// "4 sets", "1 rep".
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Main line of the focused-point tooltip, per metric. Heaviest shows the
// weight × reps of the set it was; Est. 1RM the estimate, rounded as the
// Estimated 1RM record is, with the set it came from on a line of its own
// (tooltipSource); totalReps shows a "reps" suffix instead of the unit. A
// timed hold's "reps" are seconds (ExerciseDataPoint.isHold), so it says so.
function tooltipValue(p: ExerciseDataPoint, m: ExerciseMetricKey, unit: string): string {
  switch (m) {
    case "topWeight":
      return p.isHold ? `${fmtNum(p.topWeight)} ${unit} for ${p.topReps}s` : `${fmtNum(p.topWeight)} ${unit} × ${p.topReps}`;
    case "e1rm":
      return `${fmtNum(Math.round(p.e1rm))} ${unit}`;
    case "sessionVolume":
      return `${fmtNum(p.sessionVolume)} ${unit}`;
    case "totalReps":
      return p.isHold ? `${p.totalReps}s held` : `${p.totalReps} reps`;
  }
}

// The set an estimate came from, under it in the tooltip: an Est. 1RM is a
// number nobody lifted, so it says which set it's worked out from.
function tooltipSource(p: ExerciseDataPoint, m: ExerciseMetricKey, unit: string): string | null {
  return m === "e1rm" ? `from ${fmtNum(p.e1rmWeight)} ${unit} × ${p.e1rmReps}` : null;
}

// The arrow before a change: ▲ up, ▼ down, none when it rounds to nothing.
function changeArrow(dir: "up" | "down" | "flat"): string {
  return dir === "up" ? "▲ " : dir === "down" ? "▼ " : "";
}

// "2026-09-09" → "9 Sep 2026", the tooltip's date line: day first, like the
// axis under it and the rest of the app.
function fmtTooltipDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]} ${y}`;
}

// Focused-dot ring and tooltip geometry. The tooltip is a near-black floating
// card (same in both themes, like iOS chart callouts) with a caret pointing
// down at the focused dot. Its width and where it sits: utils/exerciseChartLayout.ts.
const FOCUSED_DOT_SIZE = 18;
const TOOLTIP_BG = "#1C1D24";
// A point's touch target reaches this far from its dot each way (a 48pt box,
// over Apple's 44pt minimum), less where neighbouring points are closer.
const HIT_HALF = 24;

/**
 * Per-exercise weight-progression line chart with PR tiles below.
 * - The y-axis is zoomed to the sessions plotted (see `axis`), so the change
 *   between them fills the plot, never squeezed below a fifth of the top value.
 * - Tapping a point highlights it and shows date/weight/reps above the chart.
 * - Tapping a PR tile routes to that PR's source workout via /workout-detail.
 */
export default function ExerciseProgressionChart({
  exerciseName,
  dayName,
  dayId,
  programId,
  history,
  prs,
  unit,
  clientId,
  metric,
  onMetricChange,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Every session passed in is plotted — no time-range filter, deliberately.
  // The parent already scopes `history` to the selected program (bounded by
  // its start/completed dates) and workout day, and the whole point of this
  // chart is the full progression across that program's duration. Neither the
  // page-level Volume range nor any local dropdown should slice it. What the
  // metric leaves out is a session with no weight to plot: Reps plots every
  // session, the weight metrics those with weight on the bar (plottedPoints).
  const plotted = useMemo(() => plottedPoints(history, metric), [history, metric]);

  // Clear focus when the underlying data slice or active metric changes.
  useEffect(() => {
    setFocusedIndex(null);
  }, [exerciseName, dayName, plotted.length, metric]);

  // Where the plot, the dots and the pop-up sit, for this many sessions on
  // this screen: one dot in the card's middle, up to five centred as a group,
  // six or more spread edge to edge. Then the dates under the dots ("5 Oct"
  // for short spans, each month's name once past about three months) and the
  // y-axis the values scale to (zoomed to them, from a round bottom that
  // needn't be zero). All utils/exerciseChartLayout.ts.
  const layout = useMemo(() => exerciseChartLayout(plotted.length, screenWidth), [plotted.length, screenWidth]);
  const { chartWidth: CHART_WIDTH, initialSpacing, endSpacing, spacing } = layout;
  const labels = useMemo(() => exerciseChartLabels(plotted.map(p => p.date), spacing), [plotted, spacing]);
  const axis = useMemo(() => exerciseChartAxis(plotted.map(p => metricValue(p, metric))), [plotted, metric]);

  const focused = focusedIndex != null ? plotted[focusedIndex] ?? null : null;

  // How the line moved across the chart, its last dot against its first: the
  // header's "▲ 18% since 12 Sep" (utils/exerciseChartLayout.ts). A tapped
  // dot says how that session went against the one before, in its pop-up.
  const change = useMemo(() => chartChange(history, metric), [history, metric]);
  const focusedChange = focusedIndex != null ? changeFromPrevious(plotted, focusedIndex, metric) : null;

  // Day context leads the subline (e.g. "Push · Sessions logged · 4") so two
  // day-scoped charts for the same exercise name are visually distinct. The
  // subline stays put on focus — the focused point's numbers live in the
  // floating tooltip over the chart instead.
  const headerLabel = (() => {
    const day = dayName?.trim() ? `${dayName.trim()} · ` : "";
    if (history.length === 0) return `${day}No sessions yet`;
    return `${day}Sessions logged · ${history.length}`;
  })();

  const data = useMemo(
    () =>
      plotted.map((p, i) => {
        return {
          // From the axis' bottom: gifted-charts plots from zero, and the
          // axis reads from `axis.min` (its labels are the real values).
          value: metricValue(p, metric) - axis.min,
          label: labels[i],
          showStrip: i === focusedIndex,
          dataPointColor: `${ACCT}E6`,
          dataPointRadius: 3,
          // Focused dot: an enlarged ACCT ring with a white core. Rendered
          // via customDataPoint so gifted-charts positions it exactly on the
          // line (dataPointWidth/Height feed its centering math).
          ...(i === focusedIndex
            ? {
                customDataPoint: () => <View style={styles.focusedDot} />,
                dataPointWidth: FOCUSED_DOT_SIZE,
                dataPointHeight: FOCUSED_DOT_SIZE,
              }
            : null),
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setFocusedIndex(prev => (prev === i ? null : i));
          },
        };
      }),
    [plotted, focusedIndex, labels, metric, axis],
  );

  const goToWorkout = (workoutId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: "/workout-detail", params: { id: workoutId, ...(clientId ? { clientId } : {}) } });
  };

  return (
    <>
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{exerciseName}</Text>
            <Text style={[styles.headerValue, { color: t.ts }]} numberOfLines={1}>
              {headerLabel}
            </Text>
          </View>
          {change ? (() => {
            // Up in the accent, down in grey, as the Strength radar's
            // arrows: a lighter week isn't a warning.
            const c = fmtChange(change.pct);
            const since = fmtShortDate(change.sinceYMD);
            return (
              <View
                style={styles.changeBlock}
                accessible
                accessibilityLabel={c.dir === "flat" ? `No change since ${since}` : `${c.dir === "up" ? "Up" : "Down"} ${c.text} since ${since}`}
              >
                <Text style={[styles.changeValue, { color: c.dir === "up" ? ACCT : t.ts }]} numberOfLines={1}>
                  {`${changeArrow(c.dir)}${c.text}`}
                </Text>
                <Text style={[styles.changeSince, { color: t.ts }]} numberOfLines={1}>{`since ${since}`}</Text>
              </View>
            );
          })() : null}
        </View>

        {history.length === 0 ? (
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              No working sets logged for this exercise yet.
            </Text>
          </View>
        ) : plotted.length === 0 ? (
          // Done, but only at bodyweight: nothing to weigh on this metric.
          <View style={styles.empty}>
            <DumbbellIcon size={28} color={t.ts} />
            <Text style={[styles.emptyText, { color: t.ts }]}>
              {history.length === 1
                ? "Done at bodyweight so far. Reps, below, shows the session."
                : `Done at bodyweight so far. Reps, below, shows all ${history.length} sessions.`}
            </Text>
          </View>
        ) : (
            <View style={{ marginTop: 10, alignSelf: "stretch", position: "relative" }}>
              <LineChart
                // A new chart for every series it draws: gifted-charts opens
                // the line's width once, to the data it mounted with, and a
                // chart kept through a longer series cut it off there
                // (utils/exerciseChartLayout.ts exerciseChartKey).
                key={exerciseChartKey(exerciseName, dayId ?? dayName ?? "", data.length, layout)}
                data={data}
                color={ACCT}
                thickness={2.5}
                // Straight from one session to the next, never `curved`:
                // nothing happens between two sessions, and a curve through a
                // climb and a drop bulged past the real peak and trough,
                // drawing values never lifted (user decision, 2026-10-08).
                areaChart

                // Custom under-line gradient. A single linear gradient spans
                // the area path's bounding box (top of the line's highest
                // point → x-axis), so a per-column fade that tracks the line
                // isn't possible — instead the fade runs the FULL height.
                // Shape: modest green at the line that sheds most of its
                // color in the first third (no solid band), then a long
                // faint tail that only reaches zero at the x-axis. The id
                // must match areaGradientId (gifted-charts fills the area
                // path with url(#<areaGradientId>)).
                areaGradientId="exerciseAreaGrad"
                areaGradientComponent={() => (
                  <LinearGradient id="exerciseAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={ACCT} stopOpacity="0.22" />
                    <Stop offset="0.3" stopColor={ACCT} stopOpacity="0.08" />
                    <Stop offset="0.7" stopColor={ACCT} stopOpacity="0.03" />
                    <Stop offset="1" stopColor={ACCT} stopOpacity="0" />
                  </LinearGradient>
                )}
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
                maxValue={axis.max - axis.min}
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
                A tap anywhere on the chart that isn't on a point hides the
                pop-up: this lies over the whole chart, under the points' own
                targets, so the empty plot, the axes and the dates all land
                here (user request, 2026-10-08). Every tap used to choose a
                point, since each point's target was a full-height column and
                together they tiled the chart, so only the point or its pop-up
                hid it again.
              */}
              <Pressable
                accessible={false}
                onPress={() => setFocusedIndex(null)}
                style={StyleSheet.absoluteFill}
              />

              {/*
                Each point's touch target: a box around its dot, HIT_HALF
                either side, narrowed to the gap between points where they sit
                closer than that, so along the line they tile without
                overlapping. (The dots are radius 3; gifted-charts' own hit
                area is too small to tap.) Another point's box shows its stat;
                the focused one's hides it again. Tap-only, so vertical
                scrolling still passes through to the ScrollView.
              */}
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {plotted.map((p, i) => {
                  const x = dotX(layout, i);
                  const y = dotY(metricValue(p, metric), axis);
                  const half = plotted.length > 1 ? Math.min(HIT_HALF, spacing / 2) : HIT_HALF;
                  const top = Math.max(0, y - HIT_HALF);
                  const bottom = Math.min(y + HIT_HALF, GIFTED_TOP_PAD + CHART_HEIGHT + 12);
                  return (
                    <TouchableOpacity
                      key={`hit-${i}`}
                      activeOpacity={1}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setFocusedIndex(prev => (prev === i ? null : i));
                      }}
                      style={{ position: "absolute", left: x - half, width: half * 2, top, height: bottom - top }}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${exerciseName} on ${fmtShortDate(p.date)}`}
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
                  return (
                    <Text
                      key={i}
                      numberOfLines={1}
                      style={[styles.xLabel, { color: t.ts, left: dotX(layout, i) - 20 }]}
                    >
                      {d.label}
                    </Text>
                  );
                })}
              </View>

              {/*
                Floating tooltip over the focused dot: value line + date on a
                near-black card with a caret pointing down at the dot. A
                zero-size anchor is pinned to the dot's center (same x math as
                the labels/hit columns; y mirrors gifted-charts' point
                placement — see GIFTED_TOP_PAD) and the card hangs above it.
                The card clamps to the wrapper's edges so edge dots don't push
                it outside the NeuCard; the caret stays centered on the dot.
                Tapping the card hides it, as a tap anywhere off a point does.
              */}
              {focused && focusedIndex != null ? (() => {
                const x = dotX(layout, focusedIndex);
                const y = dotY(metricValue(focused, metric), axis);
                const cardLeft = tooltipLeft(layout, x);
                return (
                  <View
                    pointerEvents="box-none"
                    style={[styles.tooltipAnchor, { left: x, top: y }]}
                  >
                    <Pressable
                      onPress={() => setFocusedIndex(null)}
                      style={[styles.tooltipCard, { left: cardLeft - x }]}
                      accessibilityRole="button"
                      accessibilityHint="Hides this"
                    >
                      <Text style={styles.tooltipValue} numberOfLines={1}>
                        {tooltipValue(focused, metric, unit)}
                      </Text>
                      {tooltipSource(focused, metric, unit) ? (
                        <Text style={styles.tooltipDate} numberOfLines={1}>
                          {tooltipSource(focused, metric, unit)}
                        </Text>
                      ) : null}
                      <Text style={styles.tooltipDate} numberOfLines={1}>
                        {fmtTooltipDate(focused.date)}
                        {focusedChange !== null ? (() => {
                          // Against the session before it, in the
                          // header's colours (the first dot has none).
                          const c = fmtChange(focusedChange);
                          return (
                            <Text style={c.dir === "up" ? { color: ACCT } : null}>
                              {`  ·  ${changeArrow(c.dir)}${c.text}`}
                            </Text>
                          );
                        })() : null}
                      </Text>
                    </Pressable>
                    <View pointerEvents="none" style={styles.tooltipCaret} />
                  </View>
                );
              })() : null}
            </View>
        )}

        {/* Metric selector — iOS-style segmented control with a sliding
            thumb (Heaviest / Est. 1RM / Volume / Reps). Same control as
            VolumeBarChart's metric row so the two charts feel consistent. */}
        <SegmentedControl<ExerciseMetricKey>
          options={EXERCISE_METRIC_OPTIONS}
          value={metric}
          onChange={onMetricChange}
          style={{ marginTop: 16 }}
        />
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
        {/* An estimate, never a lift: worked out from the set under it
            (weight × (1 + reps / 30)), so it isn't called a best (user
            request, 2026-10-08). */}
        <PRTile
          label="Estimated 1RM"
          value={prs.oneRepMax ? `${fmtNum(Math.round(prs.oneRepMax.value))} ${unit}` : "—"}
          sub={
            prs.oneRepMax
              ? `${fmtShortDate(prs.oneRepMax.date)} · ${fmtNum(prs.oneRepMax.weight ?? 0)}×${prs.oneRepMax.reps ?? 0}`
              : "—"
          }
          onPress={prs.oneRepMax ? () => goToWorkout(prs.oneRepMax!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
      </View>
      <View style={styles.prRow}>
        {/* The set it was, "90 kg × 8", with what made it the best
            (weight × reps) and when underneath. It showed only the product,
            "720 kg", which read as a weight nobody lifted (user request,
            2026-10-08). */}
        <PRTile
          label="Best Set"
          value={prs.bestSetVolume ? `${fmtNum(prs.bestSetVolume.weight ?? 0)} ${unit} × ${prs.bestSetVolume.reps ?? 0}` : "—"}
          sub={prs.bestSetVolume ? `${fmtTotal(prs.bestSetVolume.value)} ${unit} · ${fmtShortDate(prs.bestSetVolume.date)}` : "—"}
          onPress={prs.bestSetVolume ? () => goToWorkout(prs.bestSetVolume!.workoutId) : null}
          dark={isDark}
          textPrimary={t.tp}
          textSecondary={t.ts}
        />
        {/* The most weight moved on this exercise in one session, with the
            sets and reps that added up to it. As "Best Session" with only
            the total, it said nothing about what the number was. */}
        <PRTile
          label="Most Volume"
          value={prs.bestSessionVolume ? `${fmtTotal(prs.bestSessionVolume.value)} ${unit}` : "—"}
          sub={prs.bestSessionVolume ? `${counted(prs.bestSessionVolume.sets ?? 0, "set")} · ${counted(prs.bestSessionVolume.reps ?? 0, "rep")} · ${fmtShortDate(prs.bestSessionVolume.date)}` : "—"}
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
        router.navigate({
          pathname: "/exercise-history",
          params: { exerciseName, ...(dayName ? { dayName } : {}), ...(dayId ? { dayId } : {}), ...(programId ? { programId } : {}), ...(clientId ? { clientId } : {}) },
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
  changeBlock: { alignItems: "flex-end", marginLeft: 12 },
  changeValue: { fontFamily: FontFamily.bold, fontSize: 16 },
  changeSince: { fontFamily: FontFamily.regular, fontSize: 11, marginTop: 2 },

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

  // "See exercise history" — primary ACCT-filled CTA, in the canonical pill
  // shape (constants/buttons.ts). It was a hand-rolled 20-radius box with its
  // own padding and glow, which made it the one squared-off primary button on
  // the page — and a different button from the exercise summary's own "See
  // Exercise History", which already used pill() + pillGlow. Same numbers now.
  historyBtnWrap: {
    marginTop: 14,
    marginHorizontal: 20,
  },
  historyBtn: { ...pill(), paddingHorizontal: 18, gap: 10, backgroundColor: ACCT, ...pillGlow(ACCT, 0.4), elevation: 8 },
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
  xLabelsRow: {
    position: "relative",
    height: 14,
    marginTop: 2,
  },
  // Focused data point — enlarged ACCT ring with a white core. Rendered by
  // gifted-charts (customDataPoint) so it sits exactly on the line.
  focusedDot: {
    width: FOCUSED_DOT_SIZE,
    height: FOCUSED_DOT_SIZE,
    borderRadius: FOCUSED_DOT_SIZE / 2,
    backgroundColor: "#fff",
    borderWidth: 4.5,
    borderColor: ACCT,
    shadowColor: ACCT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  // Zero-size anchor pinned to the focused dot's center; the card and caret
  // hang off it with absolute offsets so the tooltip floats above the dot.
  tooltipAnchor: {
    position: "absolute",
    width: 0,
    height: 0,
    zIndex: 10,
  },
  tooltipCard: {
    position: "absolute",
    bottom: 21,
    width: TOOLTIP_W,
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: TOOLTIP_BG,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  // Rotated square whose lower corner reads as the caret. Renders after the
  // card so its top half overlaps the card's bottom edge seamlessly. The
  // rotated tip lands ~4px clear of the focused ring's top edge (ring radius
  // 9 + glow), so the caret hovers just above the dot instead of touching it.
  tooltipCaret: {
    position: "absolute",
    bottom: 16,
    left: -6,
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: TOOLTIP_BG,
    transform: [{ rotate: "45deg" }],
  },
  tooltipValue: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: "#fff",
  },
  tooltipDate: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    marginTop: 1,
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
