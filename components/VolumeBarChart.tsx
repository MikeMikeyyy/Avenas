import { useState, useMemo, useEffect, useRef } from "react";
import { View, Text, StyleSheet, useWindowDimensions, LayoutChangeEvent } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, SharedValue } from "react-native-reanimated";
import { BarChart } from "react-native-gifted-charts";
import * as Haptics from "expo-haptics";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DropdownPicker from "./DropdownPicker";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { niceAxis } from "../utils/niceAxis";
import { MONTH_NAMES, fmtDuration } from "../utils/dates";
import type { MetricKey, RangeKey, VolumeBucket } from "../constants/progress";
import { METRIC_OPTIONS, RANGE_OPTIONS } from "../constants/progress";

interface Props {
  buckets: VolumeBucket[];
  /** "kg" | "lbs" — only displayed when `metric === "volume"`. */
  unit: string;
  /**
   * The "natural" maximum bar count for the active range — e.g. Month = 4
   * Week-of-Month slots, 3M = 3 months, Week = 7 days. Used to compute
   * spacing as if every slot were filled, so partial states (e.g. only 2
   * Week buckets so far this month) sit at their proper left positions
   * instead of stretching to the chart's edges. Falls back to buckets.length.
   */
  slotsCount?: number;
  /**
   * Human-readable phrasing of the active range for the empty state, e.g.
   * "this week" / "last week" / "in the last month" / "in the last 3 months".
   * Slotted into "No <metric> logged <rangeText> yet." so the copy reads
   * naturally per range.
   */
  rangeText?: string;
  /** Which metric the bars currently represent. */
  metric: MetricKey;
  /** Callback when the user taps a different metric tab below the chart. */
  onMetricChange: (m: MetricKey) => void;
  /** Active time-range key. */
  range: RangeKey;
  /** Callback when the user picks a different range from the dropdown. */
  onRangeChange: (r: RangeKey) => void;
}

// Per-metric labels/copy. Centralised here so every site that varies on metric
// reads from the same place.
const METRIC_TITLES: Record<MetricKey, string> = {
  volume: "Volume",
  reps: "Reps",
  duration: "Duration",
};

// Used in "No <noun> logged <range> yet.": "volume" / "reps" / "sessions"
// ("sessions" reads better than "duration" in that copy).
const METRIC_EMPTY_NOUNS: Record<MetricKey, string> = {
  volume: "volume",
  reps: "reps",
  duration: "sessions",
};

// Match against transparency hex so the unfocused bars are slightly faded
// (consistent with iOS segmented selection style).
const UNFOCUSED_ALPHA_HEX = "A6"; // ~65%

// "2026-05-11" → "May 11"
function fmtMonDay(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return `${MONTH_NAMES[(m - 1) % 12]} ${d}`;
}

// Range label: "May 11" for a single day, "May 11 – May 17" otherwise.
function fmtRange(startYMD: string, endYMD: string): string {
  if (startYMD === endYMD) return fmtMonDay(startYMD);
  return `${fmtMonDay(startYMD)} – ${fmtMonDay(endYMD)}`;
}

function formatTons(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return Math.round(n).toLocaleString();
}

// Format a bucket aggregate (`total`) according to the active metric.
// - volume:   tonnage formatted with the active unit ("12.5k kg")
// - reps:     integer count with a "reps" suffix ("540 reps")
// - duration: minutes converted back to seconds for fmtDuration ("1h 23m")
function formatTotalForMetric(n: number, metric: MetricKey, unit: string): string {
  if (metric === "volume") return `${formatTons(n)} ${unit}`;
  if (metric === "reps") return `${Math.round(n).toLocaleString()} reps`;
  return fmtDuration(Math.round(n) * 60);
}

/**
 * Metric bar chart with smart Y-axis and tap-to-highlight. The active metric
 * (Volume / Reps / Duration) is selected via the segmented control rendered
 * below the chart.
 * - Tapping a bar highlights it and shows the bucket's metric value above.
 * - Tapping the focused bar again deselects.
 * - Y-axis ticks come from niceAxis() so they're clean round numbers.
 */
export default function VolumeBarChart({ buckets, unit, slotsCount, rangeText, metric, onMetricChange, range, onRangeChange }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const { width: screenWidth } = useWindowDimensions();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Reset focused index if the bucket count changes (range / scope switch).
  useEffect(() => {
    setFocusedIndex(null);
  }, [buckets.length]);

  const axis = useMemo(() => {
    const max = buckets.reduce((m, b) => (b.total > m ? b.total : m), 0);
    return niceAxis(max, 4);
  }, [buckets]);

  const total = useMemo(() => buckets.reduce((s, b) => s + b.total, 0), [buckets]);
  const hasData = total > 0;

  // Smooth height transition between the empty state and the chart state.
  // Only the active state is mounted. On hasData flip we snap the wrapper to
  // the previous state's measured height (clipping the newly-mounted content)
  // then animate to the new state's *fresh* onLayout-reported height. The
  // wrapper stays pinned at that height afterwards and tracks any natural
  // size changes via onLayout, so there's no end-of-animation snap.
  const bodyHeight = useSharedValue<number>(-1); // -1 = auto, used only before first measurement
  const measured = useRef<{ data: number; empty: number }>({ data: 0, empty: 0 });
  const prevHasData = useRef<boolean>(hasData);
  // Tracks whether withTiming is currently driving bodyHeight. While true,
  // onLayout must NOT overwrite bodyHeight or it would cancel the animation.
  const animating = useRef<boolean>(false);
  const clearAnimating = () => {
    animating.current = false;
  };
  // When we transition into a state we've never measured, we snap the wrapper
  // to the previous state's height and stash it here. The next onLayout for
  // the new state triggers the actual animation to its real height.
  const pendingFrom = useRef<number | null>(null);

  useEffect(() => {
    if (prevHasData.current === hasData) return;
    const from = prevHasData.current ? measured.current.data : measured.current.empty;
    prevHasData.current = hasData;
    if (from <= 0) {
      // No prior measurement to animate from — let layout settle naturally.
      pendingFrom.current = null;
      return;
    }
    // Always defer the target to the new state's fresh onLayout. The chart's
    // natural height can shift between visits (axis labels, bucket count,
    // text wrapping in the empty state), so animating to a cached value would
    // overshoot and require a corrective snap at the end — visible as flicker.
    // Snap to `from` now so the new content is clipped to the previous height;
    // onMeasureBody will pick up from here and animate to the real height.
    bodyHeight.value = from;
    pendingFrom.current = from;
  }, [hasData, bodyHeight]);

  const animatedBodyStyle = useAnimatedStyle(() => {
    if (bodyHeight.value < 0) return { overflow: "hidden" as const };
    return { height: bodyHeight.value, overflow: "hidden" as const };
  });

  const onMeasureBody = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    if (hasData) measured.current.data = h;
    else measured.current.empty = h;
    // Deferred animation: we transitioned into this state before it had been
    // measured, so the useEffect couldn't pick a `to`. Now that we know it,
    // animate from the stashed `from` to the just-measured height.
    //
    // Duration matches the glow bar anim (350ms) so the bars finish growing
    // BEFORE the wrapper stops expanding — otherwise the bars look like they
    // undershoot finalH at the moment the height anim ends, then snap up.
    if (pendingFrom.current != null) {
      const from = pendingFrom.current;
      pendingFrom.current = null;
      animating.current = true;
      bodyHeight.value = from;
      bodyHeight.value = withTiming(h, { duration: 350 }, finished => {
        "worklet";
        if (finished) runOnJS(clearAnimating)();
      });
      return;
    }
    // First-ever measurement on initial mount.
    if (bodyHeight.value < 0) {
      bodyHeight.value = h;
      return;
    }
    // Mid-animation: if the chart's natural height shifts (gifted-charts'
    // internal bar animation completing triggers a re-layout near t=350ms),
    // retarget the height anim to the fresh value so the wrapper doesn't
    // end at a stale target and snap at the end. Ignore sub-pixel jitter.
    if (animating.current) {
      if (Math.abs(bodyHeight.value - h) > 1) {
        bodyHeight.value = withTiming(h, { duration: 150 }, finished => {
          "worklet";
          if (finished) runOnJS(clearAnimating)();
        });
      }
      return;
    }
    // Steady state: do NOT push every onLayout into bodyHeight. Gifted-charts
    // triggers small layout passes (axis labels, internal bar anim, range
    // switches with data) and even sub-pixel deltas show up as a 1-frame
    // height jitter. The cached `measured.current.*` values are still kept
    // up to date so the next hasData flip animates from accurate from/to.
  };

  // Stable key that changes ONLY when the bucket window (range / scope) changes.
  // Used to force-remount BarChart so gifted-charts replays the grow-from-zero
  // entry animation on every bar — not just the bars whose values shifted.
  // Notably this excludes `focusedIndex`, so tapping a bar doesn't remount.
  // Includes `slotsCount` so a Month → 3M switch with the same bar count still
  // triggers a remount.
  const chartKey = useMemo(() => {
    if (buckets.length === 0) return "empty";
    const first = buckets[0];
    const last = buckets[buckets.length - 1];
    return `${buckets.length}|${slotsCount ?? buckets.length}|${first.startYMD}|${last.endYMD}|${axis.max}`;
  }, [buckets, axis.max, slotsCount]);

  // Available horizontal space inside the NeuCard. Chart sets its own internal
  // padding so we just provide a width hint and let it lay out.
  const cardWidth = Math.min(screenWidth - 40, 420);

  // Layout math: lay bars out as if every slot in the range were filled, so
  // partial states (e.g. only 2 of 4 weeks this month) sit at their natural
  // left-anchored positions instead of stretching to fill the whole chart.
  // The "natural" slot count comes from the parent via `slotsCount`; the
  // actual bar count (`buckets.length`) may be smaller for partial windows.
  const Y_AXIS_LABEL_WIDTH = 32;
  const INITIAL_SPACING = 12;
  const END_SPACING = 12;
  const CHART_WIDTH = cardWidth - 48;
  const plotWidth = CHART_WIDTH - Y_AXIS_LABEL_WIDTH;
  // Render slots: actual bars first, then transparent placeholders out to
  // slotsCount so the chart reserves the full range's horizontal space.
  const renderedN = Math.max(1, slotsCount ?? buckets.length);
  // Bar-width sizing is driven by the slot count, not the actual bar count,
  // so 2-of-4 weeks and 4-of-4 weeks use the same bar width.
  const barWidth = renderedN <= 3 ? 48 : renderedN <= 4 ? 40 : renderedN <= 7 ? 26 : 14;
  // Evenly distribute remaining horizontal space across slots.
  const gapSpace = plotWidth - INITIAL_SPACING - END_SPACING - barWidth * renderedN;
  const spacing = renderedN > 1 ? Math.max(6, gapSpace / (renderedN - 1)) : 0;

  // Build the data with the focused bar painted in ACCT and the rest in
  // ACCT @ ~65% alpha. We re-render whenever focusedIndex changes — `key` on
  // the BarChart ensures animation runs cleanly per transition.
  //
  // Padding: when buckets.length < slotsCount we append transparent zero-value
  // bars so the chart reserves the full slot grid. These placeholders are
  // non-interactive (no onPress) and have an empty label.
  const data = useMemo(() => {
    // Gifted-charts bars are kept transparent — the visible bars come from the
    // glow overlay below (which is the only way to get a true coloured halo,
    // since gifted-charts clips its internal bar container with overflow:hidden
    // and swallows per-bar shadows). Gifted-charts still owns the press
    // surface and animation timing; the overlay mirrors that timing exactly.
    const real = buckets.map((b, i) => ({
      value: Math.round(b.total),
      label: b.label,
      frontColor: "transparent",
      onPress: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setFocusedIndex(prev => (prev === i ? null : i));
      },
    }));
    const pad = Math.max(0, renderedN - real.length);
    for (let i = 0; i < pad; i++) {
      real.push({
        value: 0,
        label: "",
        frontColor: "transparent",
        // Placeholder slots aren't interactive.
        onPress: () => {},
      });
    }
    return real;
  }, [buckets, focusedIndex, renderedN]);

  // Header line: focused bar's value, or the range total.
  // When there's no data and nothing focused, return an empty string so the
  // top-right slot stays blank (the chart's own empty-state already conveys it).
  const headerLabel = (() => {
    if (focusedIndex == null) {
      return hasData ? `Range total · ${formatTotalForMetric(total, metric, unit)}` : "";
    }
    const b = buckets[focusedIndex];
    if (!b) return "";
    return `${fmtRange(b.startYMD, b.endYMD)} · ${formatTotalForMetric(b.total, metric, unit)}`;
  })();

  return (
    <NeuCard dark={isDark} radius={20} style={{ marginHorizontal: 20, marginTop: 16 }}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.title, { color: t.tp }]}>{METRIC_TITLES[metric]}</Text>
            <Text style={[styles.headerValue, { color: focusedIndex == null ? t.ts : ACCT }]} numberOfLines={1}>
              {headerLabel}
            </Text>
          </View>
          <DropdownPicker<RangeKey>
            value={range}
            options={RANGE_OPTIONS}
            onChange={onRangeChange}
            sheetTitle="Time range"
          />
        </View>

        <Reanimated.View style={[styles.bodyWrap, animatedBodyStyle]}>
          <View onLayout={onMeasureBody}>
          {hasData ? (
            <View style={{ marginTop: 25, alignSelf: "stretch", position: "relative" }}>
            <BarChart
              key={chartKey}
              data={data}
              barWidth={barWidth}
              spacing={spacing}
              initialSpacing={INITIAL_SPACING}
              endSpacing={END_SPACING}
              yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
              barBorderRadius={4}
              noOfSections={4}
              maxValue={axis.max}
              stepValue={axis.stepValue}
              yAxisLabelTexts={axis.labels}
              yAxisThickness={1}
              xAxisThickness={1}
              yAxisColor={t.div}
              xAxisColor={t.div}
              rulesType="dashed"
              rulesColor={t.div}
              rulesThickness={1}
              dashWidth={3}
              dashGap={4}
              xAxisLabelTextStyle={{ color: t.ts, fontFamily: FontFamily.regular, fontSize: 11 }}
              yAxisTextStyle={{ color: t.ts, fontFamily: FontFamily.regular, fontSize: 11 }}
              // `isAnimated` left off: gifted-charts' bar animation also fades
              // in the x-axis labels (Mon/Tue/...) along with the bars. Our
              // glow overlay handles the visible bar grow-in independently,
              // so dropping the chart's own animation lets labels appear
              // instantly without changing the visual bar behavior.
              width={CHART_WIDTH}
              height={180}
              disableScroll={buckets.length <= 12}
            />
            {/*
              Glow bars — rendered ON TOP of the BarChart and ARE the visible bars.
              The underlying gifted-charts bars are transparent (frontColor:
              "transparent") and exist only as the press surface and animation
              timer. We can't use per-bar `barStyle` shadows on gifted-charts
              because it clips its internal bar container with overflow:hidden,
              swallowing the shadow.
              `pointerEvents="none"` lets taps pass through to the transparent
              bars below so onPress still fires.
            */}
            {/* key={chartKey} remounts the layer on every range/scope switch
                so the shared progress value starts fresh at 0 — same fresh-
                start guarantee the old useMemo'd Animated.Value gave us. */}
            <GlowBars
              key={chartKey}
              buckets={buckets}
              axisMax={axis.max}
              barWidth={barWidth}
              spacing={spacing}
              yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
              initialSpacing={INITIAL_SPACING}
              focusedIndex={focusedIndex}
            />
            </View>
          ) : (
            <View style={styles.empty}>
              <DumbbellIcon size={28} color={t.ts} />
              <Text style={[styles.emptyText, { color: t.ts }]}>
                {`No ${METRIC_EMPTY_NOUNS[metric]} logged ${rangeText ?? "in this range"} yet.`}
              </Text>
            </View>
          )}
          </View>
        </Reanimated.View>

        {/* Metric selector — three discrete NeuCard buttons so each option
            reads clearly as a tappable button. Active one is ACCT-filled
            with a matching glow; inactive ones get the standard neumorphic
            card treatment. */}
        <View style={styles.metricRow}>
          {METRIC_OPTIONS.map(opt => {
            const active = opt.key === metric;
            return (
              <BounceButton
                key={opt.key}
                style={styles.metricBtnWrap}
                onPress={() => onMetricChange(opt.key)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${opt.label}`}
              >
                {active ? (
                  <View style={styles.metricBtnActive}>
                    <Text style={[styles.metricBtnLabel, { color: "#0f1a14" }]} numberOfLines={1}>
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
  );
}

// `height={180}` on BarChart is the PLOT-only height; x-axis labels render
// below it, so the wrapper is taller than 180. PLOT_BOTTOM = distance from
// wrapper bottom up to the plot's baseline (top of the x-axis labels band).
const PLOT_BOTTOM = 24;
const PLOT_HEIGHT = 180;

// Glow overlay layer. Owns a single Reanimated shared value that all bars
// read; running on the UI thread (worklet) avoids the end-of-animation JS↔UI
// race that the react-native `Animated.Value` + `useNativeDriver: false`
// height interpolation had (final frame settled via `setNativeProps` from JS
// could collide with React's reconciler and produce a 1-frame snap).
// `key={chartKey}` on the call site remounts this component on every range/
// scope switch so the shared value starts fresh at 0.
function GlowBars({
  buckets,
  axisMax,
  barWidth,
  spacing,
  yAxisLabelWidth,
  initialSpacing,
  focusedIndex,
}: {
  buckets: VolumeBucket[];
  axisMax: number;
  barWidth: number;
  spacing: number;
  yAxisLabelWidth: number;
  initialSpacing: number;
  focusedIndex: number | null;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 350 });
  }, [progress]);

  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
    >
      {buckets.map((b, i) => {
        const isFocused = i === focusedIndex;
        const finalH = axisMax > 0 ? (b.total / axisMax) * PLOT_HEIGHT : 0;
        const x = yAxisLabelWidth + initialSpacing + i * (barWidth + spacing);
        return (
          <GlowBar
            key={`glow-${i}`}
            progress={progress}
            finalH={finalH}
            x={x}
            width={barWidth}
            isFocused={isFocused}
          />
        );
      })}
    </View>
  );
}

function GlowBar({
  progress,
  finalH,
  x,
  width,
  isFocused,
}: {
  progress: SharedValue<number>;
  finalH: number;
  x: number;
  width: number;
  isFocused: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    height: progress.value * finalH,
  }));
  return (
    <Reanimated.View
      style={[
        {
          position: "absolute",
          left: x,
          bottom: PLOT_BOTTOM,
          width,
          backgroundColor: isFocused ? ACCT : `${ACCT}${UNFOCUSED_ALPHA_HEX}`,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          shadowColor: ACCT,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isFocused ? 0.7 : 0.55,
          shadowRadius: 5,
          elevation: 10,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  inner: {
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
  },
  headerValue: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    marginTop: 2,
  },
  bodyWrap: {
    alignSelf: "stretch",
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    gap: 8,
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
    textAlign: "center",
  },
  metricRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 8,
  },
  metricBtnWrap: {
    flex: 1,
  },
  // Inactive button — sits inside a NeuCard.
  metricBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  // Active button — ACCT-filled pill with a matching shadow glow so the
  // selected metric reads as the "primary" action of the three.
  metricBtnActive: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
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
});
