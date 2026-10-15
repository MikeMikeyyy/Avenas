// components/progress/ExerciseChartPlot.tsx
//
// The exercise chart's plot (components/ExerciseProgressionChart.tsx): its
// three tabs, drawn here rather than by a chart library. Every session has a
// numbered slot of the same width, and past what fits, the row scrolls
// sideways under the y-axis and opens on the newest (user decision,
// 2026-10-12). Its labels, taps and pop-up have to move with the row, and a
// library that scrolls inside itself leaves them nothing to follow; the line
// chart this replaced already needed its labels, taps and pop-up drawn by hand
// around gifted-charts, its top padding mirrored, and a new chart per series
// (it opened its line's width once per mount and cut longer series off). The
// geometry is utils/exerciseChartLayout.ts, which the training simulation
// checks.
//
// When a scroll settles on other sessions, the y-axis fits them: every path
// eases to the new scale on the UI thread (useAnimatedProps over a shared
// min/max), while the numbers fade from their old places to the new.
//
// Each tab's record is gold, and every few seconds light passes over it: a
// glint up the bar or block, a sparkle on the dot.
//
// Each tab comes in as it opens (components/progress/chartEntrance.ts): the
// bars and blocks rise from the baseline, the numbers on them following, and
// Strength's line draws itself out left to right across what's on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TouchableOpacity, useWindowDimensions } from "react-native";
import Reanimated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import {
  ACCT, APP_DARK, APP_LIGHT, FontFamily, GOLD, GOLD_DARK, GOLD_SHINE, NEU_BG, NEU_BG_DARK, accentTextColor,
} from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { ExerciseDataPoint, ExerciseMetricKey } from "../../constants/progress";
import {
  BAR_WIDTH, BLOCK_GAP, CHART_HEIGHT, CHART_TOTAL_H, DOT_R, GLINT_BANDS, LABEL_H, LINE_STROKE, PLOT_TOP, SESSION_SPACING,
  TOOLTIP_W, Y_AXIS_LABEL_WIDTH, areaPathD, barGlintD, barsPathD, blockGlintD, blocksPathD, changeFromPrevious, dotsPathD,
  drawsOn, exerciseChartAxis, exerciseChartGeometry, fmtChange, linePathD, popupLeft, setStacks, slotX, sparkleD,
  strengthDots, strengthLabel, valueY, visibleSlots, volumeBars, windowAxis,
  type ExerciseChartGeometry,
} from "../../utils/exerciseChartLayout";
import { MONTH_NAMES } from "../../utils/dates";
import { trimNumber } from "../../utils/units";
import { useChartEntrance } from "./chartEntrance";

const AnimatedPath = Reanimated.createAnimatedComponent(Path);
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

/** How long the axis takes to fit the sessions a scroll settled on. */
const AXIS_MS = 260;
/** The fade at an edge the row runs on past. */
const FADE_W = 18;
/** A dot's touch target reaches this far above and below it (a 48pt box,
 *  over Apple's 44pt minimum); across, it's the session's whole slot. */
const HIT_HALF = 24;
const FOCUSED_DOT = 18;
/** The pop-up: a near-black card, the same in both themes, like iOS chart
 *  callouts. */
const TOOLTIP_BG = "#1C1D24";
/** The gold record's shine (user request, 2026-10-13): how often it comes
 *  round, how soon after the tab opens it first does, and how long a glint
 *  takes to run up a bar or block and a sparkle to twinkle. */
const SHINE_EVERY_MS = 10000;
const SHINE_FIRST_MS = 800;
const GLINT_MS = 1000;
const SPARKLE_MS = 900;
/** The gold dot's size, and its sparkle: how far its points reach, and how far
 *  up and right of the dot's centre it sits (on the dot's edge). Kept small,
 *  a glimmer rather than a flash (user request, 2026-10-13). */
const GOLD_DOT_R = 4.5;
const SPARKLE_R = 6;
const SPARKLE_AT = 3.5;
/** How white the gold dot flashes under its sparkle, at its brightest. */
const GOLD_FLASH = 0.4;

/** The record each tab marks in gold, by session (and set, on Sets). */
export type ChartRecords = {
  heaviest: string | null;
  mostVolume: string | null;
  mostReps: { workoutId: string; set: number } | null;
};

type Props = {
  exerciseName: string;
  /** Every session, oldest first, in the unit shown. */
  points: ExerciseDataPoint[];
  metric: ExerciseMetricKey;
  /** "kg" | "lbs" */
  unit: string;
  /** Which exercise on which day: another one opens on its newest session. */
  seriesKey: string;
  records: ChartRecords;
};

/** "2026-09-09" → "9 Sep 2026", the pop-up's date: day first, as the rest of
 *  the app writes it. */
function fmtLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (![y, m, d].every(Number.isFinite)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]} ${y}`;
}

/** A total moved, to the kilo: "1,540". */
function fmtTotal(n: number): string {
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "0";
}

/** "4 sets", "1 rep". */
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export default function ExerciseChartPlot(props: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const n = props.points.length;
  const g = useMemo(() => exerciseChartGeometry(n, screenWidth), [n, screenWidth]);
  // Where the row last came to rest, kept across the tabs (every session keeps
  // its slot on all three); another exercise, or a new session, opens on the
  // newest again.
  const seriesId = `${props.seriesKey}|${n}|${g.viewportWidth}`;
  const [settled, setSettled] = useState<{ id: string; x: number } | null>(null);
  const scrollX = settled?.id === seriesId ? Math.min(settled.x, g.maxScrollX) : g.maxScrollX;
  const onSettle = useCallback((x: number) => setSettled({ id: seriesId, x }), [seriesId]);
  // A tab or series of its own: the axis and its animation start afresh.
  return <PlotBody key={`${seriesId}|${props.metric}`} {...props} g={g} scrollX={scrollX} onSettle={onSettle} />;
}

type Focus = { slot: number; set?: number };

function PlotBody({
  exerciseName, points, metric, unit, records, g, scrollX, onSettle,
}: Props & { g: ExerciseChartGeometry; scrollX: number; onSettle: (x: number) => void }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const gold = isDark ? GOLD_DARK : GOLD;
  const reduceMotion = useReducedMotion();
  const n = points.length;
  const fmtW = (w: number) => trimNumber(w, unit === "kg" ? 2 : 1);

  // ── The y-axis: fitted to the sessions on screen ────────────────────────
  const win = visibleSlots(g, n, scrollX);
  const axis = useMemo(
    // A screen of sessions with nothing on this tab (bodyweight ones on
    // Strength) reads against every session's axis.
    () => windowAxis(points, metric, win.first, win.last) ?? windowAxis(points, metric, 0, n - 1) ?? exerciseChartAxis([]),
    [points, metric, win.first, win.last, n],
  );
  const axisKey = `${axis.min}|${axis.max}|${axis.sections}`;
  const aMin = useSharedValue(axis.min);
  const aMax = useSharedValue(axis.max);
  useEffect(() => {
    if (reduceMotion) {
      aMin.value = axis.min;
      aMax.value = axis.max;
      return;
    }
    const ease = { duration: AXIS_MS, easing: Easing.out(Easing.cubic) };
    aMin.value = withTiming(axis.min, ease);
    aMax.value = withTiming(axis.max, ease);
  }, [axis.min, axis.max, reduceMotion, aMin, aMax]);

  // ── Taps ─────────────────────────────────────────────────────────────────
  const [focus, setFocus] = useState<Focus | null>(null);
  const clearFocus = useCallback(() => setFocus(null), []);
  const toggle = useCallback((next: Focus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFocus(prev => (prev && prev.slot === next.slot && prev.set === next.set ? null : next));
  }, []);

  // ── The scroll ───────────────────────────────────────────────────────────
  // It opens where the row last came to rest (on the newest, the first time)
  // and reports where it settles: a drag let go still waits a moment for a
  // fling, so the axis fits once, where it stops.
  const [initialX] = useState(scrollX);
  const scrollRef = useAnimatedRef<Reanimated.ScrollView>();
  const sx = useSharedValue(initialX);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);
  const settleNow = useCallback((x: number) => {
    cancelSettle();
    onSettle(x);
  }, [cancelSettle, onSettle]);
  const settleSoon = useCallback((x: number) => {
    cancelSettle();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      onSettle(x);
    }, 120);
  }, [cancelSettle, onSettle]);
  useEffect(() => cancelSettle, [cancelSettle]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: e => {
      sx.value = e.contentOffset.x;
    },
    onBeginDrag: () => {
      runOnJS(clearFocus)();
      runOnJS(cancelSettle)();
    },
    onEndDrag: e => {
      runOnJS(settleSoon)(e.contentOffset.x);
    },
    onMomentumBegin: () => {
      runOnJS(cancelSettle)();
    },
    onMomentumEnd: e => {
      runOnJS(settleNow)(e.contentOffset.x);
    },
  });
  // Android takes no contentOffset before the content is laid out.
  const placed = useRef(false);
  const onContentSizeChange = useCallback(() => {
    if (placed.current) return;
    placed.current = true;
    if (initialX > 0) scrollRef.current?.scrollTo({ x: initialX, animated: false });
  }, [initialX, scrollRef]);
  const maxScroll = g.maxScrollX;
  const leftFade = useAnimatedStyle(() => ({
    opacity: interpolate(sx.value, [0, FADE_W], [0, 1], Extrapolation.CLAMP),
  }));
  const rightFade = useAnimatedStyle(() => ({
    opacity: interpolate(maxScroll - sx.value, [0, FADE_W], [0, 1], Extrapolation.CLAMP),
  }));

  // ── What's drawn, as the paths take it ──────────────────────────────────
  // Values, not positions: the paths place them on the axis as it eases.
  const shapes = useMemo(() => {
    const s = {
      lineXs: [] as number[], lineVs: [] as number[],
      dotXs: [] as number[], dotVs: [] as number[],
      goldX: -1, goldV: 0,
      blocks: [] as number[], lighterBlocks: [] as number[], goldBlock: [] as number[],
      barXs: [] as number[], barVs: [] as number[],
    };
    points.forEach((p, slot) => {
      const x = slotX(g, slot);
      if (metric === "strength" && drawsOn(p, "strength")) {
        s.lineXs.push(x);
        s.lineVs.push(p.topWeight);
        if (s.goldX < 0 && p.workoutId === records.heaviest) {
          s.goldX = x;
          s.goldV = p.topWeight;
        } else {
          s.dotXs.push(x);
          s.dotVs.push(p.topWeight);
        }
      } else if (metric === "volume" && drawsOn(p, "volume")) {
        if (s.goldX < 0 && p.workoutId === records.mostVolume) {
          s.goldX = x;
          s.goldV = p.sessionVolume;
        } else {
          s.barXs.push(x);
          s.barVs.push(p.sessionVolume);
        }
      } else if (metric === "sets") {
        const heaviest = p.sets.reduce((m, q) => (q.weight > m ? q.weight : m), 0);
        let cum = 0;
        p.sets.forEach((q, set) => {
          const block = [x, cum, cum + q.reps];
          cum += q.reps;
          if (records.mostReps && p.workoutId === records.mostReps.workoutId && set === records.mostReps.set) s.goldBlock = block;
          else (q.weight < heaviest - 1e-9 ? s.lighterBlocks : s.blocks).push(...block);
        });
      }
    });
    return s;
  }, [points, metric, g, records]);

  const lineProps = useAnimatedProps(() => ({ d: linePathD(shapes.lineXs, shapes.lineVs, aMin.value, aMax.value) }), [shapes]);
  const areaProps = useAnimatedProps(() => ({ d: areaPathD(shapes.lineXs, shapes.lineVs, aMin.value, aMax.value) }), [shapes]);
  const dotsProps = useAnimatedProps(() => ({ d: dotsPathD(shapes.dotXs, shapes.dotVs, aMin.value, aMax.value, DOT_R) }), [shapes]);
  const goldHaloProps = useAnimatedProps(() => ({ cy: valueY(shapes.goldV, aMin.value, aMax.value) }), [shapes]);
  const goldDotProps = useAnimatedProps(() => ({ cy: valueY(shapes.goldV, aMin.value, aMax.value) }), [shapes]);
  // ── How the tab comes in: the bars and blocks rise, the line draws out ──
  const enter = useChartEntrance(metric === "strength" ? "draw" : "rise");
  // Strength's drawing is shown from the left as far as the line has drawn,
  // starting where the row opens, so it draws across what's on screen.
  const revealStyle = useAnimatedStyle(() => ({
    width: metric !== "strength" || enter.value >= 1 ? g.contentWidth : initialX + enter.value * g.viewportWidth,
  }));
  // The numbers on the bars and blocks come in as they finish rising.
  const onDrawingStyle = useAnimatedStyle(() => ({
    opacity: metric === "strength" ? 1 : interpolate(enter.value, [0.65, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const blocksProps = useAnimatedProps(() => ({ d: blocksPathD(shapes.blocks, aMin.value, aMax.value, enter.value) }), [shapes]);
  const lighterProps = useAnimatedProps(() => ({ d: blocksPathD(shapes.lighterBlocks, aMin.value, aMax.value, enter.value) }), [shapes]);
  const goldBlockProps = useAnimatedProps(() => ({ d: blocksPathD(shapes.goldBlock, aMin.value, aMax.value, enter.value) }), [shapes]);
  const barsProps = useAnimatedProps(() => ({ d: barsPathD(shapes.barXs, shapes.barVs, aMin.value, aMax.value, enter.value) }), [shapes]);
  const goldBarProps = useAnimatedProps(() => ({
    d: shapes.goldX < 0 ? "" : barsPathD([shapes.goldX], [shapes.goldV], aMin.value, aMax.value, enter.value),
  }), [shapes]);

  // ── The record's shine ───────────────────────────────────────────────────
  // Every few seconds a glint of light runs up the gold bar or block, and a
  // sparkle twinkles on the gold dot: that one's the record (user request,
  // 2026-10-13). A timer starts each, so nothing runs in between, and only
  // while the screen is on show; never under Reduce Motion. Like the shapes
  // they cross, they follow the axis as it eases.
  const shine = useSharedValue(0);
  const hasRecord = metric === "sets" ? shapes.goldBlock.length === 3 : shapes.goldX >= 0;
  useFocusEffect(useCallback(() => {
    if (reduceMotion || !hasRecord) return;
    // The sparkle swells and fades on a curve of its own; the glint eases.
    const run = metric === "strength"
      ? { duration: SPARKLE_MS, easing: Easing.linear }
      : { duration: GLINT_MS, easing: Easing.inOut(Easing.sin) };
    let timer = setTimeout(function next() {
      shine.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, run));
      timer = setTimeout(next, SHINE_EVERY_MS);
    }, SHINE_FIRST_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(shine);
      shine.value = 0;
    };
  }, [reduceMotion, hasRecord, metric, shine]));
  // Each band's props read the shine and the axis themselves and hand them
  // in: Reanimated redraws only for shared values its callback reads directly,
  // not ones read inside a function it calls. Read in here, the glint was
  // drawn once, before it started, and never again (user report, 2026-10-13).
  const glintAt = (band: number, p: number, min: number, max: number): string => {
    "worklet";
    const { width, offset } = GLINT_BANDS[band];
    if (metric === "volume" && shapes.goldX >= 0) return barGlintD(shapes.goldX, shapes.goldV, min, max, p, width, offset);
    if (metric === "sets") return blockGlintD(shapes.goldBlock, min, max, p, width, offset);
    return "";
  };
  const glintWideProps = useAnimatedProps(() => ({ d: glintAt(0, shine.value, aMin.value, aMax.value) }), [shapes, metric]);
  const glintMidProps = useAnimatedProps(() => ({ d: glintAt(1, shine.value, aMin.value, aMax.value) }), [shapes, metric]);
  const glintNarrowProps = useAnimatedProps(() => ({ d: glintAt(2, shine.value, aMin.value, aMax.value) }), [shapes, metric]);
  const glintTrailProps = useAnimatedProps(() => ({ d: glintAt(3, shine.value, aMin.value, aMax.value) }), [shapes, metric]);
  // The sparkle: up from nothing and back, turning an eighth of a turn as it
  // goes, the dot under it lighting with it.
  const sparkleProps = useAnimatedProps(() => {
    const p = shine.value;
    const swell = p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0;
    const cy = valueY(shapes.goldV, aMin.value, aMax.value);
    return { d: sparkleD(shapes.goldX + SPARKLE_AT, cy - SPARKLE_AT, SPARKLE_R * swell, (Math.PI / 4) * p) };
  }, [shapes]);
  const goldFlashProps = useAnimatedProps(() => {
    const p = shine.value;
    return {
      cy: valueY(shapes.goldV, aMin.value, aMax.value),
      opacity: p > 0 && p < 1 ? GOLD_FLASH * Math.sin(Math.PI * p) : 0,
    };
  }, [shapes]);

  // Where things sit on the settled axis: the labels, the taps, the pop-up.
  const dots = useMemo(() => (metric === "strength" ? strengthDots(points, g, axis) : []), [points, metric, g, axis]);
  const stacks = useMemo(() => (metric === "sets" ? setStacks(points, g, axis) : []), [points, metric, g, axis]);
  const bars = useMemo(() => (metric === "volume" ? volumeBars(points, g, axis) : []), [points, metric, g, axis]);

  const blockText = accentTextColor(isDark);
  const holdUnit = (p: ExerciseDataPoint) => !!p.isHold;

  // ── The pop-up over a tapped session ─────────────────────────────────────
  const popup = (() => {
    if (!focus) return null;
    const p = points[focus.slot];
    if (!p) return null;
    const x = Y_AXIS_LABEL_WIDTH + slotX(g, focus.slot) - scrollX;
    let y: number;
    let title: string;
    const lines: string[] = [];
    let dateLine = fmtLongDate(p.date);
    let change: number | null = null;
    if (metric === "strength") {
      const dot = dots.find(d => d.slot === focus.slot);
      if (!dot) return null;
      y = dot.y;
      title = holdUnit(p) ? `${fmtW(p.topWeight)} ${unit} for ${p.topReps}s` : `${fmtW(p.topWeight)} ${unit} × ${p.topReps}`;
      // An estimate, so it says so (user decision, 2026-10-08).
      if (p.e1rm > 0) lines.push(`Est. 1RM ${Math.round(p.e1rm)} ${unit}`);
      change = changeFromPrevious(points, focus.slot, metric);
    } else if (metric === "sets") {
      const block = stacks[focus.slot]?.blocks[focus.set ?? 0];
      if (!block) return null;
      y = block.y;
      title = holdUnit(p)
        ? (block.weight > 0 ? `${fmtW(block.weight)} ${unit} for ${block.reps}s` : `${block.reps}s held`)
        : (block.weight > 0 ? `${fmtW(block.weight)} ${unit} × ${block.reps}` : `Bodyweight × ${block.reps}`);
      dateLine = `Set ${block.set + 1} · ${dateLine}`;
    } else {
      const bar = bars.find(b => b.slot === focus.slot);
      if (!bar) return null;
      y = bar.y;
      title = `${fmtTotal(p.sessionVolume)} ${unit}`;
      lines.push(`${counted(p.weightedSets, "set")} · ${counted(p.weightedReps, "rep")}`);
      change = changeFromPrevious(points, focus.slot, metric);
    }
    // Over the session, or under it where over would cover the card's title.
    const cardH = 18 + 20 + 17 * (lines.length + 1);
    const below = y - 21 - cardH < -28;
    const left = popupLeft(g, x) - x;
    const c = change !== null ? fmtChange(change) : null;
    return (
      <View pointerEvents="box-none" style={[styles.anchor, { left: x, top: y }]}>
        <Pressable
          onPress={clearFocus}
          style={[styles.card, below ? { top: 21 } : { bottom: 21 }, { left }]}
          accessibilityRole="button"
          accessibilityHint="Hides this"
        >
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          {lines.map(l => (
            <Text key={l} style={styles.cardLine} numberOfLines={1}>{l}</Text>
          ))}
          <Text style={styles.cardLine} numberOfLines={1}>
            {dateLine}
            {c ? (
              <Text style={c.dir === "up" ? { color: ACCT } : null}>
                {`  ·  ${c.dir === "up" ? "▲ " : c.dir === "down" ? "▼ " : ""}${c.text}`}
              </Text>
            ) : null}
          </Text>
        </Pressable>
        <View pointerEvents="none" style={[styles.caret, below ? { top: 16 } : { bottom: 16 }]} />
      </View>
    );
  })();

  // ── Drawing ──────────────────────────────────────────────────────────────
  const base = PLOT_TOP + CHART_HEIGHT;
  const focusedBar = metric === "volume" && focus ? bars.find(b => b.slot === focus.slot) ?? null : null;
  const focusedBlock = metric === "sets" && focus ? stacks[focus.slot]?.blocks[focus.set ?? 0] ?? null : null;
  const focusedDot = metric === "strength" && focus ? dots.find(d => d.slot === focus.slot) ?? null : null;
  const rules = Array.from({ length: axis.sections }, (_, i) => base - ((i + 1) / axis.sections) * CHART_HEIGHT);
  const fade = isDark ? NEU_BG_DARK : NEU_BG;
  // The glint's bands over the gold bar or block, the faintest and widest
  // first, then the streak trailing it.
  const glint = [glintWideProps, glintMidProps, glintNarrowProps, glintTrailProps].map((animatedProps, i) => (
    <AnimatedPath key={`glint${i}`} animatedProps={animatedProps} fill={GOLD_SHINE} fillOpacity={GLINT_BANDS[i].opacity} />
  ));

  return (
    <Reanimated.View
      entering={reduceMotion ? undefined : FadeIn.duration(180)}
      style={{ width: g.wrapperWidth, height: CHART_TOTAL_H }}
    >
      {/* The grid and its numbers stay put while the row scrolls under them;
          a new axis fades in over the old. */}
      <Reanimated.View
        key={axisKey}
        entering={reduceMotion ? undefined : FadeIn.duration(AXIS_MS)}
        exiting={reduceMotion ? undefined : FadeOut.duration(AXIS_MS * 0.6)}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      >
        <Svg width={g.viewportWidth} height={CHART_TOTAL_H} style={{ position: "absolute", left: Y_AXIS_LABEL_WIDTH }}>
          {rules.map(y => (
            <Line key={y} x1={0} x2={g.viewportWidth} y1={y} y2={y} stroke={t.div} strokeWidth={1} strokeDasharray={[3, 4]} />
          ))}
        </Svg>
        {axis.labels.map((label, i) => (
          <Text
            key={`${label}-${i}`}
            style={[styles.yLabel, { color: t.ts, top: base - (i / axis.sections) * CHART_HEIGHT - LABEL_H / 2 }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ))}
      </Reanimated.View>
      <Svg width={g.wrapperWidth} height={CHART_TOTAL_H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Line x1={Y_AXIS_LABEL_WIDTH + 0.5} x2={Y_AXIS_LABEL_WIDTH + 0.5} y1={PLOT_TOP} y2={base} stroke={t.div} strokeWidth={1} />
        <Line x1={Y_AXIS_LABEL_WIDTH} x2={g.wrapperWidth} y1={base + 0.5} y2={base + 0.5} stroke={t.div} strokeWidth={1} />
      </Svg>

      <Reanimated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: initialX, y: 0 }}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={g.maxScrollX > 0}
        style={[styles.scroller, { width: g.viewportWidth }]}
      >
        <View style={{ width: g.contentWidth, height: CHART_TOTAL_H }}>
          {/* A tap anywhere that isn't on a session hides the pop-up (user
              request, 2026-10-08). */}
          <Pressable accessible={false} onPress={clearFocus} style={StyleSheet.absoluteFill} />

          {/* The drawing and the numbers on it, shown as far as Strength's line
              has drawn out (all of it on the other tabs). */}
          <Reanimated.View pointerEvents="none" style={[styles.reveal, revealStyle]}>
          <Svg width={g.contentWidth} height={CHART_TOTAL_H} style={styles.revealed} pointerEvents="none">
            {metric === "strength" ? (
              <>
                <Defs>
                  {/* Modest green at the line, shedding most of it in the first
                      third, then a long faint tail to the baseline. */}
                  <LinearGradient id="exerciseArea" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={ACCT} stopOpacity={0.22} />
                    <Stop offset="0.3" stopColor={ACCT} stopOpacity={0.08} />
                    <Stop offset="0.7" stopColor={ACCT} stopOpacity={0.03} />
                    <Stop offset="1" stopColor={ACCT} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <AnimatedPath animatedProps={areaProps} fill="url(#exerciseArea)" />
                <AnimatedPath
                  animatedProps={lineProps}
                  fill="none"
                  stroke={ACCT}
                  strokeWidth={LINE_STROKE}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <AnimatedPath animatedProps={dotsProps} fill={ACCT} />
                {shapes.goldX >= 0 ? (
                  <>
                    <AnimatedCircle animatedProps={goldHaloProps} cx={shapes.goldX} r={8.5} fill={gold} fillOpacity={isDark ? 0.2 : 0.25} />
                    <AnimatedCircle animatedProps={goldDotProps} cx={shapes.goldX} r={GOLD_DOT_R} fill={gold} />
                    <AnimatedCircle animatedProps={goldFlashProps} cx={shapes.goldX} r={GOLD_DOT_R} fill={GOLD_SHINE} />
                    {/* Edged in the gold, so it shows off the dot on a light card too. */}
                    <AnimatedPath animatedProps={sparkleProps} fill={GOLD_SHINE} stroke={gold} strokeWidth={1} strokeLinejoin="round" />
                  </>
                ) : null}
                {focusedDot ? (
                  <>
                    <Circle cx={focusedDot.x} cy={focusedDot.y} r={FOCUSED_DOT / 2 + 2} fill={ACCT} fillOpacity={0.18} />
                    <Circle cx={focusedDot.x} cy={focusedDot.y} r={(FOCUSED_DOT - 4.5) / 2} fill="#fff" stroke={ACCT} strokeWidth={4.5} />
                  </>
                ) : null}
              </>
            ) : metric === "sets" ? (
              <>
                <AnimatedPath animatedProps={blocksProps} fill={ACCT} fillOpacity={isDark ? 0.24 : 0.3} />
                {/* A lighter set than the session's heaviest (a back-off set):
                    paler, so the weight over the stack can't pass for it. */}
                <AnimatedPath animatedProps={lighterProps} fill={ACCT} fillOpacity={isDark ? 0.1 : 0.13} />
                <AnimatedPath animatedProps={goldBlockProps} fill={gold} />
                {hasRecord ? glint : null}
                {focusedBlock && focus && stacks[focus.slot] ? (
                  <Rect
                    x={stacks[focus.slot].x - BAR_WIDTH / 2 - 1}
                    y={focusedBlock.y - 1}
                    width={BAR_WIDTH + 2}
                    height={focusedBlock.h + 2}
                    rx={5}
                    fill="none"
                    stroke={ACCT}
                    strokeWidth={2}
                  />
                ) : null}
              </>
            ) : (
              <>
                {/* Tapped, the other bars step back, as on the Volume chart
                    above. */}
                <AnimatedPath animatedProps={barsProps} fill={ACCT} fillOpacity={focusedBar ? 0.45 : 1} />
                <AnimatedPath animatedProps={goldBarProps} fill={gold} />
                {hasRecord ? glint : null}
                {focusedBar && points[focusedBar.slot]?.workoutId !== records.mostVolume ? (
                  <Path d={barsPathD([focusedBar.x], [points[focusedBar.slot].sessionVolume], axis.min, axis.max)} fill={ACCT} />
                ) : null}
              </>
            )}
          </Svg>

          {/* The numbers that sit on the drawing: reps over each dot, each
              set's reps and the weight over each stack, the kilos over each
              bar. Placed on the settled axis, they fade across when it
              changes, and come in as the bars finish rising. */}
          <Reanimated.View pointerEvents="none" style={[styles.revealed, { width: g.contentWidth, height: CHART_TOTAL_H }, onDrawingStyle]}>
          <Reanimated.View
            key={axisKey}
            entering={reduceMotion ? undefined : FadeIn.duration(AXIS_MS)}
            exiting={reduceMotion ? undefined : FadeOut.duration(AXIS_MS * 0.6)}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          >
            {dots.map(d => (
              <Text key={d.slot} style={[styles.label, { left: d.labelX - SESSION_SPACING / 2, top: d.labelY - LABEL_H / 2, color: t.ts }]}>
                {strengthLabel(points[d.slot])}
              </Text>
            ))}
            {stacks.map(st => {
              const p = points[st.slot];
              const over = st.heaviest > 0 ? `${fmtW(st.heaviest)} ${unit}` : holdUnit(p) ? "" : "BW";
              return (
                <View key={st.slot} style={StyleSheet.absoluteFill}>
                  {st.blocks.map(b => {
                    if (b.h < 12) return null;
                    const isGold = !!records.mostReps && p.workoutId === records.mostReps.workoutId && b.set === records.mostReps.set;
                    const small = b.h < 16;
                    return (
                      <Text
                        key={b.set}
                        style={[
                          small ? styles.blockSmall : styles.block,
                          { left: st.x - SESSION_SPACING / 2, top: b.y + b.h / 2 - (small ? 6 : 7), color: isGold ? APP_LIGHT.tp : blockText },
                        ]}
                      >
                        {b.reps}
                      </Text>
                    );
                  })}
                  {over ? (
                    <Text style={[styles.stackLabel, { left: st.x - SESSION_SPACING / 2, top: st.labelY - LABEL_H / 2, color: t.tp }]} numberOfLines={1}>
                      {over}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            {bars.map(b => (
              <Text key={b.slot} style={[styles.label, { left: b.x - SESSION_SPACING / 2, top: b.labelY - LABEL_H / 2, color: t.ts }]} numberOfLines={1}>
                {fmtTotal(points[b.slot].sessionVolume)}
              </Text>
            ))}
          </Reanimated.View>
          </Reanimated.View>
          </Reanimated.View>

          {/* Each session's number: the Nth time it was done on this day. A
              session with nothing on this tab keeps its number, faded. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {points.map((p, slot) => (
              <Text
                key={slot}
                style={[
                  styles.number,
                  { left: slotX(g, slot) - SESSION_SPACING / 2, top: base + 3, color: t.ts, opacity: drawsOn(p, metric) ? 1 : 0.45 },
                ]}
              >
                {slot + 1}
              </Text>
            ))}
          </View>

          {/* Each session's touch target, on the settled axis. */}
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {dots.map(d => {
              const top = Math.max(0, d.y - HIT_HALF);
              return (
                <TouchableOpacity
                  key={d.slot}
                  activeOpacity={1}
                  onPress={() => toggle({ slot: d.slot })}
                  style={{ position: "absolute", left: d.x - SESSION_SPACING / 2, width: SESSION_SPACING, top, height: Math.min(d.y + HIT_HALF, base + 12) - top }}
                  accessibilityRole="button"
                  accessibilityLabel={`${exerciseName}, session ${d.slot + 1}`}
                />
              );
            })}
            {stacks.flatMap(st => st.blocks.map((b, i) => {
              // Each block, from the gap under it up to the gap over it; the
              // top one reaches up over its weight too.
              const top = i === st.blocks.length - 1 ? Math.max(0, b.y - 20) : b.y - BLOCK_GAP / 2;
              const bottom = b.y + b.h + BLOCK_GAP / 2;
              return (
                <TouchableOpacity
                  key={`${st.slot}-${b.set}`}
                  activeOpacity={1}
                  onPress={() => toggle({ slot: st.slot, set: b.set })}
                  style={{ position: "absolute", left: st.x - SESSION_SPACING / 2, width: SESSION_SPACING, top, height: Math.max(8, bottom - top) }}
                  accessibilityRole="button"
                  accessibilityLabel={`${exerciseName}, session ${st.slot + 1}, set ${b.set + 1}`}
                />
              );
            }))}
            {bars.map(b => {
              const top = Math.max(0, Math.min(b.y - 20, base - 36));
              return (
                <TouchableOpacity
                  key={b.slot}
                  activeOpacity={1}
                  onPress={() => toggle({ slot: b.slot })}
                  style={{ position: "absolute", left: b.x - SESSION_SPACING / 2, width: SESSION_SPACING, top, height: base + 4 - top }}
                  accessibilityRole="button"
                  accessibilityLabel={`${exerciseName}, session ${b.slot + 1}`}
                />
              );
            })}
          </View>
        </View>
      </Reanimated.ScrollView>

      {/* Fades at an edge the row runs on past. */}
      <Reanimated.View pointerEvents="none" style={[styles.edge, { left: Y_AXIS_LABEL_WIDTH + 1 }, leftFade]}>
        <Svg width={FADE_W} height={CHART_TOTAL_H}>
          <Defs>
            <LinearGradient id="exerciseFadeL" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fade} stopOpacity={1} />
              <Stop offset="1" stopColor={fade} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={FADE_W} height={CHART_TOTAL_H} fill="url(#exerciseFadeL)" />
        </Svg>
      </Reanimated.View>
      <Reanimated.View pointerEvents="none" style={[styles.edge, { left: g.wrapperWidth - FADE_W }, rightFade]}>
        <Svg width={FADE_W} height={CHART_TOTAL_H}>
          <Defs>
            <LinearGradient id="exerciseFadeR" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fade} stopOpacity={0} />
              <Stop offset="1" stopColor={fade} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={FADE_W} height={CHART_TOTAL_H} fill="url(#exerciseFadeR)" />
        </Svg>
      </Reanimated.View>

      {popup}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  scroller: {
    position: "absolute",
    left: Y_AXIS_LABEL_WIDTH,
    top: 0,
    height: CHART_TOTAL_H,
  },
  // What the drawing is shown through as Strength's line draws out: its width
  // grows, its contents keep their own.
  reveal: {
    position: "absolute",
    left: 0,
    top: 0,
    height: CHART_TOTAL_H,
    overflow: "hidden",
  },
  revealed: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  edge: {
    position: "absolute",
    top: 0,
    width: FADE_W,
    height: CHART_TOTAL_H,
  },
  yLabel: {
    position: "absolute",
    left: 0,
    width: Y_AXIS_LABEL_WIDTH - 6,
    height: LABEL_H,
    lineHeight: LABEL_H,
    textAlign: "right",
    fontFamily: FontFamily.regular,
    fontSize: 10,
    includeFontPadding: false,
  },
  label: {
    position: "absolute",
    width: SESSION_SPACING,
    height: LABEL_H,
    lineHeight: LABEL_H,
    textAlign: "center",
    fontFamily: FontFamily.bold,
    fontSize: 10,
    includeFontPadding: false,
  },
  stackLabel: {
    position: "absolute",
    width: SESSION_SPACING,
    height: LABEL_H,
    lineHeight: LABEL_H,
    textAlign: "center",
    fontFamily: FontFamily.semibold,
    fontSize: 10,
    includeFontPadding: false,
  },
  block: {
    position: "absolute",
    width: SESSION_SPACING,
    height: 14,
    lineHeight: 14,
    textAlign: "center",
    fontFamily: FontFamily.bold,
    fontSize: 11,
    includeFontPadding: false,
  },
  blockSmall: {
    position: "absolute",
    width: SESSION_SPACING,
    height: 12,
    lineHeight: 12,
    textAlign: "center",
    fontFamily: FontFamily.bold,
    fontSize: 9,
    includeFontPadding: false,
  },
  number: {
    position: "absolute",
    width: SESSION_SPACING,
    height: 14,
    lineHeight: 14,
    textAlign: "center",
    fontFamily: FontFamily.regular,
    fontSize: 10,
    includeFontPadding: false,
  },
  // Zero-size anchor pinned to the tapped session; the card and caret hang off
  // it, over it or under it.
  anchor: {
    position: "absolute",
    width: 0,
    height: 0,
    zIndex: 10,
  },
  card: {
    position: "absolute",
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
  // A rotated square whose corner reads as the caret, over the card's edge.
  caret: {
    position: "absolute",
    left: -6,
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: TOOLTIP_BG,
    transform: [{ rotate: "45deg" }],
  },
  cardTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: "#fff",
  },
  cardLine: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: "rgba(255,255,255,0.55)",
    marginTop: 1,
  },
});
