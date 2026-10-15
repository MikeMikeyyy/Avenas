// components/progress/CompareLiftList.tsx
//
// Exercise Progress while comparing two programs: every exercise at once,
// start to finish (option A on the Program Compare canvas, user pick,
// 2026-10-14). The ones both programs did come first, each with how much its
// top set went up in each and a small chart of both lines, green over blue,
// laid out by the times it came round as the full chart is, dotted through a
// session missed; then the ones only in either. A tap charts the exercise in
// full below.

import { useCallback, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import NeuCard from "../NeuCard";
import {
  ACCT, APP_DARK, APP_LIGHT, CUE_INK, CUE_INK_DARK, FontFamily, NEU_BG, NEU_BG_DARK,
  compareBlue, compareBlueText,
} from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { ExerciseDataPoint } from "../../constants/progress";
import type { CustomExercise } from "../../constants/exercises";
import { isDeletedExercise } from "../../utils/customExercises";
import { liftChange, liftSlots, type CompareLift, type LiftSlot } from "../../utils/programCompare";
import { missedOnLine } from "../../utils/compareChartLayout";
import { playEntrance } from "./chartEntrance";
import { useRevealOnScroll } from "./revealOnScroll";
import { fmtGain } from "./CompareGlanceCard";

const W = 96;
const H = 36;
const PAD = 4;
/** The pause between the first little chart coming into sight and all of
 *  them drawing out, so there's time to look. */
const DRAW_PAUSE_MS = 1000;
/** Each program's band, green's over blue's, and the space between them. */
const LANE_GAP = 6;
const LANE_H = (H - 2 * PAD - LANE_GAP) / 2;
const LANE_TOP = { green: PAD, blue: PAD + LANE_H + LANE_GAP } as const;
/** A lift only one program did: its band in the middle (user request,
 *  2026-10-14: high in green's band, it read as half of a pair). */
const ALONE_TOP = (H - LANE_H) / 2;

/** What a lift's little chart plots at each place in its row: its top set, or
 *  at bodyweight the best set's reps; nothing where it was missed. */
function valuesOf(row: readonly LiftSlot[], weighted: boolean): (number | null)[] {
  return row.map(({ point: p }) => {
    if (!p) return null;
    return weighted ? (p.topWeight > 0 ? p.topWeight : null) : p.sets.reduce((m, s) => (s.reps > m ? s.reps : m), 0);
  });
}

/** A lift's two lines in a few points, laid out by its places as the chart is.
 *  Green's in a band over blue's, always (user request, 2026-10-14: at the same
 *  weight the two lines met, and blue's read as joined to green's dot), both
 *  bands on one scale, so the higher still sits higher in its own. A missed
 *  session is an empty dotted circle in its place, and the line goes dotted
 *  through it to the next session, or out to it before the first session or
 *  after the last (missedOnLine): a line only ever runs between two marks,
 *  never out to nothing (user requests, the same day). */
function MiniChart({ lift, missed, isDark, shown, onSeen }: {
  lift: CompareLift;
  missed: { green: string[]; blue: string[] };
  isDark: boolean;
  /** How far the whole list's lines have drawn out, 0 to 1. */
  shown: SharedValue<number>;
  /** It's been scrolled into sight. */
  onSeen: () => void;
}) {
  // Drawn out left to right with every other one in the list, once the
  // first of them is seen (CompareLiftList).
  const { ref, onLayout } = useRevealOnScroll(onSeen);
  const revealStyle = useAnimatedStyle(() => ({ width: shown.value * W }));

  const weighted = [...lift.green, ...lift.blue].some(p => p.topWeight > 0);
  const gRow = liftSlots(lift.green, missed.green);
  const bRow = liftSlots(lift.blue, missed.blue);
  const g = valuesOf(gRow, weighted);
  const b = valuesOf(bRow, weighted);
  const n = Math.max(gRow.length, bRow.length, 2);
  const all = [...g, ...b].filter((v): v is number => v !== null);
  // Only one program's line to draw: it sits in the middle, not in its band.
  const alone = g.every(v => v === null) || b.every(v => v === null);
  const card = isDark ? NEU_BG_DARK : NEU_BG;
  if (all.length === 0) return <View style={{ width: W, height: H }} />;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!(hi > lo)) { hi += 1; lo -= 1; }
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  // Every session a full dot (blue's a ring) and every missed one an empty
  // dotted circle, smaller when the places crowd so they stay apart.
  const r = Math.max(1.6, Math.min(3, (W - 2 * PAD) / (n - 1) / 3));

  const lineOf = (vs: (number | null)[], row: readonly LiftSlot[], color: string, side: "green" | "blue") => {
    const top = alone ? ALONE_TOP : LANE_TOP[side];
    const y = (v: number) => top + LANE_H - ((v - lo) / (hi - lo)) * LANE_H;
    const drawn = vs.map((v, i) => ({ v, i })).filter((d): d is { v: number; i: number } => d.v !== null);
    if (drawn.length === 0) return null;
    const runs: { i: number; v: number }[][] = [[drawn[0]]];
    const dotted: [number, number, number, number][] = [];
    for (let k = 1; k < drawn.length; k++) {
      const a = drawn[k - 1];
      const c = drawn[k];
      if (row.slice(a.i + 1, c.i).some(s => s.missed !== undefined)) {
        dotted.push([x(a.i), y(a.v), x(c.i), y(c.v)]);
        runs.push([c]);
      } else {
        runs[runs.length - 1].push(c);
      }
    }
    const { rings, ends } = missedOnLine(row, drawn.map(d => ({ slot: d.i, v: d.v })));
    for (const e of ends) dotted.push([x(e.from), y(e.v), x(e.to), y(e.v)]);
    return {
      lines: (
        <>
          {runs.filter(r => r.length > 1).map((r, k) => (
            <Polyline
              key={`${side}-run-${k}`}
              points={r.map(d => `${x(d.i)},${y(d.v)}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {dotted.map(([x1, y1, x2, y2], k) => (
            <Line key={`${side}-dot-${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.6} strokeDasharray={[2, 3]} strokeLinecap="round" />
          ))}
        </>
      ),
      mark: (
        <>
          {rings.map(m => (
            <Circle key={`${side}-missed-${m.slot}`} cx={x(m.slot)} cy={y(m.v)} r={r - 0.2} fill={card} stroke={color} strokeWidth={1.3} strokeDasharray={[1.6, 1.4]} />
          ))}
          {drawn.map(d => (side === "green"
            ? <Circle key={`${side}-done-${d.i}`} cx={x(d.i)} cy={y(d.v)} r={r} fill={color} />
            : <Circle key={`${side}-done-${d.i}`} cx={x(d.i)} cy={y(d.v)} r={r - 0.4} fill={card} stroke={color} strokeWidth={1.6} />
          ))}
        </>
      ),
    };
  };
  const green = lineOf(g, gRow, ACCT, "green");
  const blue = lineOf(b, bRow, compareBlue(isDark), "blue");

  return (
    <View ref={ref} onLayout={onLayout} style={styles.mini}>
      <Reanimated.View style={[styles.miniReveal, revealStyle]}>
        <Svg width={W} height={H} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {green?.lines}
          {blue?.lines}
          {green?.mark}
          {blue?.mark}
        </Svg>
      </Reanimated.View>
    </View>
  );
}

interface Props {
  lifts: { both: CompareLift[]; onlyGreen: CompareLift[]; onlyBlue: CompareLift[] };
  /** The days each lift was missed on, by its key (utils/programCompare.ts missedDates). */
  missed: Record<string, { green: string[]; blue: string[] }>;
  names: { green: string; blue: string };
  selected: string | null;
  onSelect: (key: string) => void;
  /** Every custom exercise a lift can be, deleted ones included: a deleted
   *  one says so, which also tells it apart from a new one given its name. */
  customExercises: CustomExercise[];
}

export default function CompareLiftList({ lifts, missed, names, selected, onSelect, customExercises }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Green's words in its dot's own green (user decision, 2026-10-14).
  const gInk = ACCT;
  const bInk = compareBlueText(isDark);
  const cue = isDark ? CUE_INK_DARK : CUE_INK;

  // Every little chart draws out together, a moment after the first of them
  // is scrolled into sight, so the whole list can be watched coming in (user
  // request, 2026-10-14: drawn one by one as each was reached, a short scroll
  // set off only some).
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const started = useRef(false);
  const onSeen = useCallback(() => {
    if (started.current) return;
    started.current = true;
    playEntrance(shown, "draw", DRAW_PAUSE_MS, reduceMotion);
  }, [reduceMotion, shown]);

  const stat =(points: readonly ExerciseDataPoint[], ink: string) => {
    const n = points.length;
    const change = liftChange(points);
    const sessions = `${n} ${n === 1 ? "session" : "sessions"}`;
    return (
      <Text style={[styles.stat, { color: cue }]} numberOfLines={1}>
        {change !== null ? (
          <>
            <Text style={[styles.gain, { color: change > 0 ? ink : cue }]}>{fmtGain(change)}</Text>
            {` in ${sessions}`}
          </>
        ) : sessions}
      </Text>
    );
  };

  const row = (lift: CompareLift, last: boolean) => {
    const sel = lift.key === selected;
    const m = missed[lift.key] ?? { green: [], blue: [] };
    const deleted = isDeletedExercise(lift, customExercises);
    return (
      <View key={lift.key}>
        <TouchableOpacity
          activeOpacity={0.6}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(lift.key);
          }}
          style={styles.row}
          accessibilityRole="button"
          accessibilityState={{ selected: sel }}
          accessibilityLabel={`${lift.name}${deleted ? ", a deleted exercise" : ""}. ${lift.green.length ? `${names.green}: ${lift.green.length} sessions.` : ""} ${lift.blue.length ? `${names.blue}: ${lift.blue.length} sessions.` : ""} Shows its chart`}
        >
          <View style={styles.text}>
            <Text style={[styles.name, { color: sel ? gInk : t.tp }]} numberOfLines={1}>
              {lift.name}
              {deleted ? <Text style={[styles.deletedNote, { color: cue }]}>{" · Deleted"}</Text> : null}
            </Text>
            {lift.green.length ? (
              <View style={styles.statRow}>
                <View style={[styles.dot, { backgroundColor: ACCT }]} />
                {stat(lift.green, gInk)}
              </View>
            ) : null}
            {lift.blue.length ? (
              <View style={styles.statRow}>
                <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />
                {stat(lift.blue, bInk)}
              </View>
            ) : null}
          </View>
          <MiniChart lift={lift} missed={m} isDark={isDark} shown={shown} onSeen={onSeen} />
          <Ionicons name="chevron-forward" size={14} color={t.ts} />
        </TouchableOpacity>
        {!last ? <View style={[styles.divider, { backgroundColor: t.div }]} /> : null}
      </View>
    );
  };

  const section = (title: string, marker: "green" | "blue" | null, list: CompareLift[]) => (
    list.length ? (
      <View key={title}>
        <View style={styles.sectionRow}>
          {marker === "green" ? <View style={[styles.dot, { backgroundColor: ACCT }]} /> : null}
          {marker === "blue" ? <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} /> : null}
          <Text style={[styles.section, { color: cue }]}>{title}</Text>
        </View>
        <NeuCard dark={isDark} radius={20}>
          <View style={styles.cardInner}>{list.map((l, i) => row(l, i === list.length - 1))}</View>
        </NeuCard>
      </View>
    ) : null
  );

  const none = !lifts.both.length && !lifts.onlyGreen.length && !lifts.onlyBlue.length;
  return (
    <View style={styles.wrap}>
      <Text style={[styles.header, { color: t.tp }]}>Exercise Progress</Text>
      <Text style={[styles.sub, { color: t.ts }]}>Top set, from the 1st session to the last</Text>
      {none ? (
        <Text style={[styles.empty, { color: t.ts }]}>No exercises logged in either program yet.</Text>
      ) : null}
      {section("In both programs", null, lifts.both)}
      {section(`Only in ${names.green}`, "green", lifts.onlyGreen)}
      {section(`Only in ${names.blue}`, "blue", lifts.onlyBlue)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 28 },
  header: { fontFamily: FontFamily.bold, fontSize: 18 },
  sub: { fontFamily: FontFamily.semibold, fontSize: 13, marginTop: 2 },
  empty: { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 16, textAlign: "center" },
  // "Only in <program>" wraps rather than cutting the name short, its dot
  // centred on it.
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 20, marginBottom: 10, marginLeft: 6 },
  section: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: "uppercase" },
  cardInner: { paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 20 },
  deletedNote: { fontFamily: FontFamily.regular, fontSize: 13 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  stat: { flexShrink: 1, fontFamily: FontFamily.regular, fontSize: 12, lineHeight: 16 },
  gain: { fontFamily: FontFamily.bold },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  ring: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.6 },
  divider: { height: 1 },
  // The little chart, and what it's shown through as it draws out.
  mini: { width: W, height: H },
  miniReveal: { height: H, overflow: "hidden" },
});
