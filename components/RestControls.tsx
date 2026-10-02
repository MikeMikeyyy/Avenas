// components/RestControls.tsx
//
// A rest's countdown and buttons, shared by its two homes
// (constants/floatingBars.ts): the pill on the Workout page
// (components/RestTimerBanner.tsx), and the section the workout bar grows to
// hold it everywhere else (components/WorkoutActiveBar.tsx). One countdown and
// one row of buttons, so the two can't drift apart.
//
// The countdown is a line along the top edge, as it always was, now fitted to
// the pill: it follows the edge's own outline and carries on all the way
// through the rounded ends. The old strip ran straight across the full width
// of a rounded card, so the corners cut its ends to points, and a line that
// stopped partway round a curve looked cut off too. A green ring, a gradient
// bar under the time and a wash behind it all were tried in its place, and
// the line won (user decision, 2026-10-02).

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Reanimated, { Easing, useAnimatedProps, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import BounceButton from "./BounceButton";
import { useRestTimer } from "../contexts/RestTimerContext";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { WORKOUT_BAR_H, barButtonFill } from "../constants/floatingBars";

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/** The line's thickness. */
const LINE_W = 3;
/** The bars' corners: the pill's round ends, half its height across, and the
 *  same radius on the taller bar that holds a rest. */
const CORNER = WORKOUT_BAR_H / 2;

/** What the line runs round: the whole pill, or the rest's section at the top
 *  of the taller bar (rounded top corners, straight sides). */
export type RestLineHolder = "pill" | "section";

/** The line's path round a holder `width` by `height`, and its length. It goes
 *  all the way through each curve, never stopping partway round one: on the
 *  pill from the foot of the left end up round it, over the top and down
 *  round the right end to its foot; on the section up the left side, round
 *  the top corners, and down the right side to where the workout's row
 *  begins. Stopped partway round a curve, its end looked cut off. Drawn half
 *  its thickness inside the edge, so it lies flush against it. */
function linePath(holder: RestLineHolder, width: number, height: number): { d: string; length: number } {
  const r = CORNER - LINE_W / 2;
  const e = LINE_W / 2;
  const across = Math.max(0, width - 2 * CORNER);
  const top = `A ${r} ${r} 0 0 1 ${CORNER} ${e} L ${width - CORNER} ${e} A ${r} ${r} 0 0 1 ${width - e} ${CORNER}`;
  if (holder === "pill") {
    const foot = 2 * CORNER - e;
    return {
      d: `M ${CORNER} ${foot} A ${r} ${r} 0 0 1 ${e} ${CORNER} ${top} A ${r} ${r} 0 0 1 ${width - CORNER} ${foot}`,
      length: 2 * Math.PI * r + across,
    };
  }
  const side = Math.max(0, height - CORNER);
  return {
    d: `M ${e} ${height} L ${e} ${CORNER} ${top} L ${width - e} ${height}`,
    length: 2 * side + Math.PI * r + across,
  };
}

/** "01:12", minutes and seconds. */
export function formatRestTime(secs: number): string {
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

/** How much of the rest is left, from 1 down to 0, gliding between the
 *  seconds rather than stepping. */
export function useRestProgress(): SharedValue<number> {
  const { restDisplay, restTotal, restBannerActive } = useRestTimer();
  const progress = useSharedValue(1);
  // A new rest starts full.
  useEffect(() => {
    if (restBannerActive) progress.value = 1;
  }, [restBannerActive, progress]);
  useEffect(() => {
    if (restTotal > 0) {
      progress.value = withTiming(Math.min(1, Math.max(0, restDisplay / restTotal)), { duration: 950, easing: Easing.linear });
    }
  }, [restDisplay, restTotal, progress]);
  return progress;
}

/** The countdown: a green line round the edge of whatever holds it (the pill,
 *  or the bar's rest section, whose top is the bar's), through the rounded
 *  ends, on a faint track of the same path, draining from its right-hand end
 *  back round to its left. The holder clips it at its edge, so its glow falls
 *  inward rather than haloing the bar. */
export function RestLine({ progress, isDark, holder }: {
  progress: SharedValue<number>;
  isDark: boolean;
  holder: RestLineHolder;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const { d, length } = linePath(holder, width, height);
  const drain = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value) }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {width > 0 && height > 0 && (
        <>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Path d={d} stroke={barButtonFill(isDark)} strokeWidth={LINE_W} strokeLinecap="round" fill="none" />
          </Svg>
          {/* Its own layer for the glow: a shadow on a view with no fill
              follows what it draws, so only the green line glows. */}
          <View style={[StyleSheet.absoluteFill, styles.lineGlow, { shadowOpacity: isDark ? 0.45 : 0.6 }]}>
            <Svg width={width} height={height}>
              <AnimatedPath
                d={d}
                stroke={ACCT}
                strokeWidth={LINE_W}
                strokeLinecap="round"
                strokeDasharray={[length, length]}
                fill="none"
                animatedProps={drain}
              />
            </Svg>
          </View>
        </>
      )}
    </View>
  );
}

/** The time left, with REST beside it on the same baseline. REST sat over
 *  the time in the bar's top left, where it looked squeezed into the corner. */
export function RestTime({ seconds, size, isDark }: { seconds: number; size: number; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const label = formatRestTime(seconds);
  return (
    <View style={styles.time} accessible accessibilityLabel={`Rest, ${label} left`}>
      <Text style={[styles.timeText, { color: t.tp, fontSize: size, lineHeight: Math.round(size * 1.22) }]}>{label}</Text>
      <Text style={[styles.timeLabel, { color: t.ts }]}>REST</Text>
    </View>
  );
}

/** −15s, +15s and Skip. Plain touchables outside any scroll view, so they work
 *  with the keyboard up and leave it there. BounceButton gives the haptic. */
export function RestActions({ isDark }: { isDark: boolean }) {
  const { adjustRestTimer, dismissRestTimer } = useRestTimer();
  const ink = isDark ? APP_DARK.tp : APP_LIGHT.tp;
  const fill = { backgroundColor: barButtonFill(isDark) };
  return (
    <View style={styles.actions}>
      <BounceButton onPress={() => adjustRestTimer(-15)} style={[styles.chip, fill]} accessibilityRole="button" accessibilityLabel="15 seconds less rest">
        <Text style={[styles.chipText, { color: ink }]}>−15s</Text>
      </BounceButton>
      <BounceButton onPress={() => adjustRestTimer(15)} style={[styles.chip, fill]} accessibilityRole="button" accessibilityLabel="15 seconds more rest">
        <Text style={[styles.chipText, { color: ink }]}>+15s</Text>
      </BounceButton>
      <BounceButton onPress={dismissRestTimer} style={styles.skip} accessibilityRole="button" accessibilityLabel="Skip the rest">
        <Text style={styles.skipText}>Skip</Text>
      </BounceButton>
    </View>
  );
}

// The buttons are 36pt tall, the workout bar's own: 18pt lines and 9pt above
// and below (a BounceButton takes a set height onto its touch area, not its
// fill, so the height comes from padding).
const styles = StyleSheet.create({
  lineGlow:  { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowRadius: 4 },
  time:      { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  timeText:  { fontFamily: FontFamily.bold, letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  timeLabel: { fontFamily: FontFamily.bold, fontSize: 11, letterSpacing: 1.2 },
  actions:   { flexDirection: "row", alignItems: "center", gap: 6 },
  chip:      { borderRadius: PILL_RADIUS, paddingHorizontal: 11, paddingVertical: 9 },
  chipText:  { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  skip:      {
    borderRadius: PILL_RADIUS, paddingHorizontal: 15, paddingVertical: 9, backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  skipText:  { fontFamily: FontFamily.bold, fontSize: 13, lineHeight: 18, color: "#fff" },
});
