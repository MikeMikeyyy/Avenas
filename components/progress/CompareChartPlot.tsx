// components/progress/CompareChartPlot.tsx
//
// The exercise chart with two programs on it, for the Progress page comparing
// two programs (utils/compareChartLayout.ts places everything). Green's
// sessions and blue's share the numbered slots, so each program's 4th session
// stands over the same number; Strength is two lines (blue's dots are rings,
// so the two read apart without colour), Sets and Volume are pairs, green's on
// the left. A session that came round and wasn't done keeps its slot: on
// Strength it's an empty dotted circle on the line, which goes dotted through
// it or out to it, with a word at the foot over a run of them ("Missed", "2
// missed"; left off where a mark sits low there); on Sets and Volume that
// program's half of the slot holds an empty bar, dashed and lined, as tall as
// its session before.
//
// It scrolls, fits its y-axis and comes in like the exercise chart
// (components/progress/ExerciseChartPlot.tsx): every path eases to the new
// scale on the UI thread when a scroll settles, and as a tab opens the bars
// and blocks rise and the lines draw out left to right. It opens on green's latest
// session, with the next slot beside it, so blue's next session shows what's
// ahead. A tap on a slot shows both programs' sessions there; a tap anywhere
// else, or on the pop-up, hides it. No gold here: the colours mean programs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TouchableOpacity, useWindowDimensions } from "react-native";
import Reanimated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Pattern, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import {
  ACCT, APP_DARK, APP_LIGHT, COMPARE_BLUE_DARK, CUE_INK, CUE_INK_DARK, FontFamily, NEU_BG, NEU_BG_DARK,
  accentTextColor, compareBlue, compareBlueText,
} from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { ExerciseDataPoint, ExerciseMetricKey } from "../../constants/progress";
import {
  CHART_HEIGHT, CHART_TOTAL_H, DOT_R, LABEL_H, LINE_STROKE, PLOT_TOP, SESSION_SPACING, Y_AXIS_LABEL_WIDTH,
  dotsPathD, drawsOn, exerciseChartAxis, exerciseChartGeometry, setsTotal, slotX, valueY, visibleSlots,
  type ExerciseChartGeometry,
} from "../../utils/exerciseChartLayout";
import {
  COMPARE_TOOLTIP_W, PAIR_OFFSET, PAIR_W, compareOpenX, compareWindowAxis, missedBarValue, missedBars, missedRuns,
  pairBarsPathD, pairBlocksPathD, segmentsPathD, strengthLine,
} from "../../utils/compareChartLayout";
import type { LiftSlot } from "../../utils/programCompare";
import { MONTH_NAMES } from "../../utils/dates";
import { trimNumber } from "../../utils/units";
import { useChartEntrance } from "./chartEntrance";
import { ordinal } from "../../utils/workoutSummary";

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/** How long the axis takes to fit the sessions a scroll settled on (the
 *  exercise chart's). */
const AXIS_MS = 260;
/** The fade at an edge the row runs on past. */
const FADE_W = 18;
/** The pop-up: a near-black card, the same in both themes. */
const TOOLTIP_BG = "#1C1D24";
const FOCUSED_DOT = 16;
const RING_W = 2;
/** A missed session's word: how wide it reads, where it sits over the foot of
 *  the plot (blue's higher where both programs missed there), and how close
 *  above it a dot can sit before the word gives way to it. */
const MISSED_LABEL_W = 50;
const MISSED_WORD_Y = 19;
const MISSED_WORD_Y_RAISED = 33;
const MISSED_CLEAR = 15;

type Props = {
  exerciseName: string;
  /** Each program's row of it: every time it came round, a session (in the
   *  unit shown) or a miss, oldest first (utils/programCompare.ts liftSlots). */
  green: LiftSlot[];
  blue: LiftSlot[];
  metric: ExerciseMetricKey;
  /** "kg" | "lbs" */
  unit: string;
  /** Which exercise in which pair of programs: another opens afresh. */
  seriesKey: string;
};

/** "2026-09-28" → "28 Sep". */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return `${d} ${MONTH_NAMES[(m - 1) % 12]}`;
}

const fmtTotal = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "0");
const bestReps = (p: ExerciseDataPoint) => p.sets.reduce((m, s) => (s.reps > m ? s.reps : m), 0);

export default function CompareChartPlot(props: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const n = Math.max(props.green.length, props.blue.length);
  const g = useMemo(() => exerciseChartGeometry(n, screenWidth), [n, screenWidth]);
  // Where the row last came to rest, kept across the tabs; another exercise,
  // or a new session, opens on green's latest again.
  const seriesId = `${props.seriesKey}|${props.green.length}|${props.blue.length}|${g.viewportWidth}`;
  const [settled, setSettled] = useState<{ id: string; x: number } | null>(null);
  const scrollX = settled?.id === seriesId ? Math.min(settled.x, g.maxScrollX) : compareOpenX(g, props.green.length, n);
  const onSettle = useCallback((x: number) => setSettled({ id: seriesId, x }), [seriesId]);
  return <PlotBody key={`${seriesId}|${props.metric}`} {...props} g={g} n={n} scrollX={scrollX} onSettle={onSettle} />;
}

function PlotBody({
  exerciseName, green, blue, metric, unit, g, n, scrollX, onSettle,
}: Props & { g: ExerciseChartGeometry; n: number; scrollX: number; onSettle: (x: number) => void }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reduceMotion = useReducedMotion();
  const blueMark = compareBlue(isDark);
  const card = isDark ? NEU_BG_DARK : NEU_BG;
  const fmtW = (w: number) => trimNumber(w, unit === "kg" ? 2 : 1);

  // ── The y-axis: fitted to both programs' sessions on screen ────────────
  const win = visibleSlots(g, n, scrollX);
  const axis = useMemo(
    () => compareWindowAxis(green, blue, metric, win.first, win.last)
      ?? compareWindowAxis(green, blue, metric, 0, n - 1)
      ?? exerciseChartAxis([]),
    [green, blue, metric, win.first, win.last, n],
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
  const [focus, setFocus] = useState<number | null>(null);
  const clearFocus = useCallback(() => setFocus(null), []);
  const toggle = useCallback((slot: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFocus(prev => (prev === slot ? null : slot));
  }, []);

  // ── The scroll (as the exercise chart's) ─────────────────────────────────
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

  // ── What's drawn, as values the paths place on the easing axis ──────────
  const shapes = useMemo(() => {
    const gl = strengthLine(green, g);
    const bl = strengthLine(blue, g);
    const sets = (slots: LiftSlot[], offset: number) => {
      const full: number[] = [];
      const lighter: number[] = [];
      slots.forEach(({ point: p }, slot) => {
        if (!p) return;
        const x = slotX(g, slot) + offset;
        const heaviest = p.sets.reduce((m, q) => (q.weight > m ? q.weight : m), 0);
        let cum = 0;
        p.sets.forEach(q => {
          const block = [x, cum, cum + q.reps];
          cum += q.reps;
          (q.weight < heaviest - 1e-9 ? lighter : full).push(...block);
        });
      });
      return { full, lighter };
    };
    const bars = (slots: LiftSlot[], offset: number) => {
      const xs: number[] = [];
      const vs: number[] = [];
      slots.forEach(({ point: p }, slot) => {
        if (!p || !drawsOn(p, "volume")) return;
        xs.push(slotX(g, slot) + offset);
        vs.push(p.sessionVolume);
      });
      return { xs, vs };
    };
    // The empty bars of the sessions missed, on whichever bar tab is up.
    const missedOn = metric === "strength" ? "volume" : metric;
    return {
      gl, bl,
      gSets: sets(green, -PAIR_OFFSET), bSets: sets(blue, PAIR_OFFSET),
      gBars: bars(green, -PAIR_OFFSET), bBars: bars(blue, PAIR_OFFSET),
      gMissed: missedBars(green, missedOn, -PAIR_OFFSET, g), bMissed: missedBars(blue, missedOn, PAIR_OFFSET, g),
    };
  }, [green, blue, metric, g]);

  const gSolidProps = useAnimatedProps(() => ({ d: segmentsPathD(shapes.gl.solid, aMin.value, aMax.value) }), [shapes]);
  const gDottedProps = useAnimatedProps(() => ({ d: segmentsPathD(shapes.gl.dotted, aMin.value, aMax.value) }), [shapes]);
  const gDotsProps = useAnimatedProps(() => ({ d: dotsPathD(shapes.gl.xs, shapes.gl.vs, aMin.value, aMax.value, DOT_R + 0.2) }), [shapes]);
  const bSolidProps = useAnimatedProps(() => ({ d: segmentsPathD(shapes.bl.solid, aMin.value, aMax.value) }), [shapes]);
  const bDottedProps = useAnimatedProps(() => ({ d: segmentsPathD(shapes.bl.dotted, aMin.value, aMax.value) }), [shapes]);
  const bRingsProps = useAnimatedProps(() => ({ d: dotsPathD(shapes.bl.xs, shapes.bl.vs, aMin.value, aMax.value, DOT_R + 0.2) }), [shapes]);
  const gMissedRingsProps = useAnimatedProps(() => ({ d: dotsPathD(shapes.gl.missedXs, shapes.gl.missedVs, aMin.value, aMax.value, DOT_R + 1) }), [shapes]);
  const bMissedRingsProps = useAnimatedProps(() => ({ d: dotsPathD(shapes.bl.missedXs, shapes.bl.missedVs, aMin.value, aMax.value, DOT_R + 1) }), [shapes]);
  // ── How the tab comes in (chartEntrance.ts): the bars and blocks rise, the
  // lines draw out left to right across what's on screen. ─────────────────
  const enter = useChartEntrance(metric === "strength" ? "draw" : "rise");
  const revealStyle = useAnimatedStyle(() => ({
    width: metric !== "strength" || enter.value >= 1 ? g.contentWidth : initialX + enter.value * g.viewportWidth,
  }));
  // The numbers on the bars and blocks come in as they finish rising.
  const onDrawingStyle = useAnimatedStyle(() => ({
    opacity: metric === "strength" ? 1 : interpolate(enter.value, [0.65, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const gBlocksProps = useAnimatedProps(() => ({ d: pairBlocksPathD(shapes.gSets.full, aMin.value, aMax.value, enter.value) }), [shapes]);
  const gLighterProps = useAnimatedProps(() => ({ d: pairBlocksPathD(shapes.gSets.lighter, aMin.value, aMax.value, enter.value) }), [shapes]);
  const bBlocksProps = useAnimatedProps(() => ({ d: pairBlocksPathD(shapes.bSets.full, aMin.value, aMax.value, enter.value) }), [shapes]);
  const bLighterProps = useAnimatedProps(() => ({ d: pairBlocksPathD(shapes.bSets.lighter, aMin.value, aMax.value, enter.value) }), [shapes]);
  const gBarsProps = useAnimatedProps(() => ({ d: pairBarsPathD(shapes.gBars.xs, shapes.gBars.vs, aMin.value, aMax.value, enter.value) }), [shapes]);
  const bBarsProps = useAnimatedProps(() => ({ d: pairBarsPathD(shapes.bBars.xs, shapes.bBars.vs, aMin.value, aMax.value, enter.value) }), [shapes]);
  const gMissedProps = useAnimatedProps(() => ({ d: pairBarsPathD(shapes.gMissed.xs, shapes.gMissed.vs, aMin.value, aMax.value, enter.value) }), [shapes]);
  const bMissedProps = useAnimatedProps(() => ({ d: pairBarsPathD(shapes.bMissed.xs, shapes.bMissed.vs, aMin.value, aMax.value, enter.value) }), [shapes]);

  // ── The missed sessions' words on Strength, at the foot of the plot: one
  // over each run of them, unless a mark sits low there (both programs' runs
  // in one place: blue's word above). ─────────────────────────────────────
  const base = PLOT_TOP + CHART_HEIGHT;
  const missed = useMemo(() => {
    if (metric !== "strength") return { words: [] as { key: string; x: number; y: number; label: string }[] };
    const runs = missedRuns(green, blue, g);
    // Every dot and empty circle drawn, to keep the words clear of them and
    // of the lines between them.
    const marks = [shapes.gl, shapes.bl].flatMap(l => [
      ...l.xs.map((x, i) => ({ x, y: valueY(l.vs[i], axis.min, axis.max) })),
      ...l.missedXs.map((x, i) => ({ x, y: valueY(l.missedVs[i], axis.min, axis.max) })),
    ]);
    const words = runs
      .map(r => {
        const shared = r.side === "blue" && runs.some(o => o.side === "green" && o.slots.some(k => r.slots.includes(k)));
        return { key: `${r.side}-${r.slots[0]}`, x: r.x, y: base - (shared ? MISSED_WORD_Y_RAISED : MISSED_WORD_Y), label: r.label };
      })
      .filter(w => !marks.some(d => Math.abs(d.x - w.x) < MISSED_LABEL_W / 2 + SESSION_SPACING && d.y > w.y - MISSED_CLEAR));
    return { words };
  }, [metric, green, blue, g, shapes, axis.min, axis.max, base]);
  const cueInk = isDark ? CUE_INK_DARK : CUE_INK;

  // ── The pop-up over a tapped slot ────────────────────────────────────────
  const popup = (() => {
    if (focus === null) return null;
    const gs = green[focus];
    const bs = blue[focus];
    if (!gs && !bs) return null;
    const gp = gs?.point;
    const bp = bs?.point;
    const x = Y_AXIS_LABEL_WIDTH + slotX(g, focus) - scrollX;
    const tops: number[] = [];
    const valueOf = (s: LiftSlot | undefined): string => {
      const p = s?.point;
      if (s?.missed) return "Missed";
      if (!p) return "Not done yet";
      if (metric === "strength") {
        if (p.isHold) return p.topWeight > 0 ? `${fmtW(p.topWeight)} ${unit} for ${p.topReps}s` : `${bestReps(p)}s held`;
        return p.topWeight > 0 ? `${fmtW(p.topWeight)} ${unit} × ${p.topReps}` : `Bodyweight × ${bestReps(p)}`;
      }
      if (metric === "sets") return `${p.sets.length} ${p.sets.length === 1 ? "set" : "sets"} · ${setsTotal(p)}${p.isHold ? "s" : " reps"}`;
      return p.sessionVolume > 0 ? `${fmtTotal(p.sessionVolume)} ${unit}` : "No volume";
    };
    for (const [s, slots] of [[gs, green], [bs, blue]] as const) {
      const p = s?.point;
      if (s?.missed && metric !== "strength") {
        const v = missedBarValue(slots, focus, metric);
        if (v !== null) tops.push(valueY(v, axis.min, axis.max));
      }
      if (!p) continue;
      if (metric === "strength" && drawsOn(p, "strength")) tops.push(valueY(p.topWeight, axis.min, axis.max));
      else if (metric === "sets") tops.push(valueY(setsTotal(p), axis.min, axis.max));
      else if (metric === "volume" && drawsOn(p, "volume")) tops.push(valueY(p.sessionVolume, axis.min, axis.max));
    }
    const y = tops.length ? Math.min(...tops) : base;
    // "3rd session · 2.5 kg ahead": Strength only, when both lifted a weight.
    let title = `${ordinal(focus + 1)} session`;
    if (metric === "strength" && gp && bp && gp.topWeight > 0 && bp.topWeight > 0 && !gp.isHold && !bp.isHold) {
      const diff = gp.topWeight - bp.topWeight;
      title += Math.abs(diff) < 1e-6 ? " · level" : ` · ${fmtW(Math.abs(diff))} ${unit} ${diff > 0 ? "ahead" : "behind"}`;
    }
    const cardH = 18 + 16 + 2 * 21;
    const below = y - 21 - cardH < -28;
    const left = Math.min(Math.max(x - COMPARE_TOOLTIP_W / 2, -6), g.wrapperWidth - COMPARE_TOOLTIP_W + 6) - x;
    // A session done or missed says its day; one not reached yet says so.
    const row = (s: LiftSlot | undefined, side: "green" | "blue") => {
      const day = s?.point?.date ?? s?.missed;
      return (
        <View style={styles.cardRow}>
          <View style={side === "green" ? styles.cardDotGreen : styles.cardRing} />
          <Text style={[styles.cardValue, !s?.point && styles.cardNone]} numberOfLines={1}>{valueOf(s)}</Text>
          {day ? <Text style={styles.cardDate} numberOfLines={1}>{shortDate(day)}</Text> : null}
        </View>
      );
    };
    return (
      <View pointerEvents="box-none" style={[styles.anchor, { left: x, top: y }]}>
        <Pressable
          onPress={clearFocus}
          style={[styles.card, below ? { top: 21 } : { bottom: 21 }, { left }]}
          accessibilityRole="button"
          accessibilityHint="Hides this"
        >
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          {row(gs, "green")}
          {row(bs, "blue")}
        </Pressable>
        <View pointerEvents="none" style={[styles.caret, below ? { top: 16 } : { bottom: 16 }]} />
      </View>
    );
  })();

  // ── Drawing ──────────────────────────────────────────────────────────────
  const rules = Array.from({ length: axis.sections }, (_, i) => base - ((i + 1) / axis.sections) * CHART_HEIGHT);
  const fade = isDark ? NEU_BG_DARK : NEU_BG;
  const focusX = focus !== null ? slotX(g, focus) : null;
  const focusPoint = (slots: LiftSlot[]): ExerciseDataPoint | undefined => (focus !== null ? slots[focus]?.point : undefined);
  const fg = focusPoint(green);
  const fb = focusPoint(blue);
  const focusDots = metric === "strength" && focus !== null
    ? [
        fg && drawsOn(fg, "strength") ? { side: "green" as const, y: valueY(fg.topWeight, axis.min, axis.max) } : null,
        fb && drawsOn(fb, "strength") ? { side: "blue" as const, y: valueY(fb.topWeight, axis.min, axis.max) } : null,
      ].filter((d): d is { side: "green" | "blue"; y: number } => d !== null)
    : [];

  // Each set's reps on its block, where the block is tall enough to hold them.
  const blockLabels = useMemo(() => {
    if (metric !== "sets") return [];
    const out: { key: string; x: number; y: number; reps: number; side: "green" | "blue" }[] = [];
    const walk = (slots: LiftSlot[], offset: number, side: "green" | "blue") => slots.forEach(({ point: p }, slot) => {
      if (!p) return;
      let cum = 0;
      p.sets.forEach((q, set) => {
        const bottom = valueY(cum, axis.min, axis.max);
        cum += q.reps;
        const top = valueY(cum, axis.min, axis.max);
        if (bottom - top >= 14) out.push({ key: `${side}-${slot}-${set}`, x: slotX(g, slot) + offset, y: (top + bottom) / 2, reps: q.reps, side });
      });
    });
    walk(green, -PAIR_OFFSET, "green");
    walk(blue, PAIR_OFFSET, "blue");
    return out;
  }, [metric, green, blue, g, axis.min, axis.max]);

  return (
    <Reanimated.View
      entering={reduceMotion ? undefined : FadeIn.duration(180)}
      style={{ width: g.wrapperWidth, height: CHART_TOTAL_H }}
    >
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
          <Pressable accessible={false} onPress={clearFocus} style={StyleSheet.absoluteFill} />

          {/* The drawing and the numbers on it, shown as far as Strength's
              lines have drawn out (all of it on the other tabs). */}
          <Reanimated.View pointerEvents="none" style={[styles.reveal, revealStyle]}>
          <Svg width={g.contentWidth} height={CHART_TOTAL_H} style={styles.revealed} pointerEvents="none">
            {/* A missed session's empty bar: thin diagonal lines in its
                program's colour, no fill. */}
            <Defs>
              <Pattern id="cmpMissedG" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <Line x1={0} y1={0} x2={0} y2={6} stroke={ACCT} strokeWidth={1.6} strokeOpacity={0.5} />
              </Pattern>
              <Pattern id="cmpMissedB" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <Line x1={0} y1={0} x2={0} y2={6} stroke={blueMark} strokeWidth={1.6} strokeOpacity={0.5} />
              </Pattern>
            </Defs>
            {focusX !== null ? (
              <Line x1={focusX} x2={focusX} y1={PLOT_TOP} y2={base} stroke={t.ts} strokeOpacity={0.35} strokeWidth={1} />
            ) : null}
            {metric === "strength" ? (
              <>
                {/* Blue under green, so where they meet green's on top. A
                    missed session is an empty dotted circle on its line. */}
                <AnimatedPath animatedProps={bSolidProps} fill="none" stroke={blueMark} strokeWidth={LINE_STROKE} strokeLinecap="round" />
                <AnimatedPath animatedProps={bDottedProps} fill="none" stroke={blueMark} strokeWidth={2} strokeDasharray={[3, 4]} strokeLinecap="round" />
                <AnimatedPath animatedProps={bMissedRingsProps} fill={card} stroke={blueMark} strokeWidth={1.6} strokeDasharray={[2.4, 1.8]} />
                <AnimatedPath animatedProps={bRingsProps} fill={card} stroke={blueMark} strokeWidth={RING_W} />
                <AnimatedPath animatedProps={gSolidProps} fill="none" stroke={ACCT} strokeWidth={LINE_STROKE} strokeLinecap="round" />
                <AnimatedPath animatedProps={gDottedProps} fill="none" stroke={ACCT} strokeWidth={2} strokeDasharray={[3, 4]} strokeLinecap="round" />
                <AnimatedPath animatedProps={gMissedRingsProps} fill={card} stroke={ACCT} strokeWidth={1.6} strokeDasharray={[2.4, 1.8]} />
                <AnimatedPath animatedProps={gDotsProps} fill={ACCT} />
                {focusDots.map(d => (
                  d.side === "green" ? (
                    <G key="g">
                      <Circle cx={focusX!} cy={d.y} r={FOCUSED_DOT / 2 + 2} fill={ACCT} fillOpacity={0.2} />
                      <Circle cx={focusX!} cy={d.y} r={5} fill={ACCT} />
                    </G>
                  ) : (
                    <Circle key="b" cx={focusX!} cy={d.y} r={5.5} fill={card} stroke={blueMark} strokeWidth={2.5} />
                  )
                ))}
              </>
            ) : metric === "sets" ? (
              <>
                <AnimatedPath animatedProps={gBlocksProps} fill={ACCT} fillOpacity={isDark ? 0.26 : 0.32} />
                <AnimatedPath animatedProps={gLighterProps} fill={ACCT} fillOpacity={isDark ? 0.11 : 0.14} />
                <AnimatedPath animatedProps={bBlocksProps} fill={blueMark} fillOpacity={isDark ? 0.3 : 0.3} />
                <AnimatedPath animatedProps={bLighterProps} fill={blueMark} fillOpacity={isDark ? 0.12 : 0.13} />
                <AnimatedPath animatedProps={gMissedProps} fill="url(#cmpMissedG)" stroke={ACCT} strokeWidth={1.3} strokeDasharray={[3, 2.5]} />
                <AnimatedPath animatedProps={bMissedProps} fill="url(#cmpMissedB)" stroke={blueMark} strokeWidth={1.3} strokeDasharray={[3, 2.5]} />
              </>
            ) : (
              <>
                <AnimatedPath animatedProps={gBarsProps} fill={ACCT} />
                <AnimatedPath animatedProps={bBarsProps} fill={blueMark} />
                <AnimatedPath animatedProps={gMissedProps} fill="url(#cmpMissedG)" stroke={ACCT} strokeWidth={1.3} strokeDasharray={[3, 2.5]} />
                <AnimatedPath animatedProps={bMissedProps} fill="url(#cmpMissedB)" stroke={blueMark} strokeWidth={1.3} strokeDasharray={[3, 2.5]} />
              </>
            )}

          </Svg>

          {/* The numbers on the drawing, on the settled axis: each set's reps
              on its block, and what a missed mark stands for, coming in as
              the bars finish rising. Green's reps keep the deeper green: they
              sit on its pale green block, where the dot's green would all but
              vanish. */}
          <Reanimated.View pointerEvents="none" style={[styles.revealed, { width: g.contentWidth, height: CHART_TOTAL_H }, onDrawingStyle]}>
          <Reanimated.View
            key={axisKey}
            entering={reduceMotion ? undefined : FadeIn.duration(AXIS_MS)}
            exiting={reduceMotion ? undefined : FadeOut.duration(AXIS_MS * 0.6)}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          >
            {blockLabels.map(b => (
              <Text
                key={b.key}
                style={[styles.block, { left: b.x - PAIR_W, top: b.y - 7, color: b.side === "green" ? accentTextColor(isDark) : compareBlueText(isDark) }]}
              >
                {b.reps}
              </Text>
            ))}
          </Reanimated.View>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {missed.words.map(w => (
              <Text
                key={w.key}
                style={[styles.missed, { left: w.x - SESSION_SPACING, top: w.y - LABEL_H / 2, color: cueInk }]}
                numberOfLines={1}
              >
                {w.label}
              </Text>
            ))}
          </View>
          </Reanimated.View>
          </Reanimated.View>

          {/* Each slot's number: the Nth session of each program. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Array.from({ length: n }, (_, slot) => (
              <Text
                key={slot}
                style={[styles.number, { left: slotX(g, slot) - SESSION_SPACING / 2, top: base + 3, color: focus === slot ? t.tp : t.ts }]}
              >
                {slot + 1}
              </Text>
            ))}
          </View>

          {/* Each slot's touch target: its whole column. */}
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {Array.from({ length: n }, (_, slot) => (
              <TouchableOpacity
                key={slot}
                activeOpacity={1}
                onPress={() => toggle(slot)}
                style={{ position: "absolute", left: slotX(g, slot) - SESSION_SPACING / 2, width: SESSION_SPACING, top: 0, height: base + 16 }}
                accessibilityRole="button"
                accessibilityLabel={`${exerciseName}, session ${slot + 1} of each program`}
              />
            ))}
          </View>
        </View>
      </Reanimated.ScrollView>

      <Reanimated.View pointerEvents="none" style={[styles.edge, { left: Y_AXIS_LABEL_WIDTH + 1 }, leftFade]}>
        <Svg width={FADE_W} height={CHART_TOTAL_H}>
          <Defs>
            <LinearGradient id="compareFadeL" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fade} stopOpacity={1} />
              <Stop offset="1" stopColor={fade} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={FADE_W} height={CHART_TOTAL_H} fill="url(#compareFadeL)" />
        </Svg>
      </Reanimated.View>
      <Reanimated.View pointerEvents="none" style={[styles.edge, { left: g.wrapperWidth - FADE_W }, rightFade]}>
        <Svg width={FADE_W} height={CHART_TOTAL_H}>
          <Defs>
            <LinearGradient id="compareFadeR" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={fade} stopOpacity={0} />
              <Stop offset="1" stopColor={fade} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={FADE_W} height={CHART_TOTAL_H} fill="url(#compareFadeR)" />
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
  // What the drawing is shown through as Strength's lines draw out: its
  // width grows, its contents keep their own.
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
  block: {
    position: "absolute",
    width: PAIR_W * 2,
    height: 14,
    lineHeight: 14,
    textAlign: "center",
    fontFamily: FontFamily.bold,
    fontSize: 10,
    includeFontPadding: false,
  },
  missed: {
    position: "absolute",
    width: SESSION_SPACING * 2,
    height: LABEL_H,
    lineHeight: LABEL_H,
    textAlign: "center",
    fontFamily: FontFamily.semibold,
    fontSize: 10,
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
  anchor: {
    position: "absolute",
    width: 0,
    height: 0,
    zIndex: 10,
  },
  card: {
    position: "absolute",
    width: COMPARE_TOOLTIP_W,
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
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: "rgba(255,255,255,0.6)",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 2,
    height: 19,
  },
  cardDotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCT,
  },
  cardRing: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COMPARE_BLUE_DARK,
  },
  cardValue: {
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: 15,
    color: "#fff",
  },
  cardNone: {
    fontFamily: FontFamily.semibold,
    fontSize: 13,
    color: "rgba(255,255,255,0.55)",
  },
  cardDate: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
  },
});
