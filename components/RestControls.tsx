// components/RestControls.tsx
//
// A rest's countdown and buttons, shared by its two homes
// (constants/floatingBars.ts): the pill on the Workout page
// (components/RestTimerBanner.tsx), and the section the workout bar grows to
// hold it everywhere else (components/WorkoutActiveBar.tsx). One countdown and
// one row of buttons, so the two can't drift apart.
//
// The rest drains in the timer's aurora gradient (sky into mint, the Workout
// tab's timer ring; user decisions, 2026-10-15, the Workout Timer canvas): on
// the pill a small ring in its rounded left end (`RestRing`), on the workout
// bar a line where the rest meets the workout's row (`RestDrainLine`). It was a
// green line round the pill's edge, through the rounded ends, which the user
// went off once the timer had its ring.

import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Reanimated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";

import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import { useRestTimer } from "../contexts/RestTimerContext";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, TIMER_GRADIENT } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { barButtonFill } from "../constants/floatingBars";

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

/** The pill's ring: in its rounded left end, centred on the end's own curve. */
export const REST_RING = 38;
const RING_W = 4;
const RING_R = REST_RING / 2 - RING_W / 2 - 1;

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

/** The pill's countdown: a gradient ring round a small dumbbell, draining
 *  anticlockwise back to the top, the timer's dial in miniature. */
export function RestRing({ progress, isDark }: { progress: SharedValue<number>; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const c = REST_RING / 2;
  const circ = 2 * Math.PI * RING_R;
  const drain = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - progress.value) }));
  return (
    <View style={styles.ring} pointerEvents="none">
      <Svg width={REST_RING} height={REST_RING} style={StyleSheet.absoluteFill}>
        <Circle cx={c} cy={c} r={RING_R} stroke={barButtonFill(isDark)} strokeWidth={RING_W} fill="none" />
      </Svg>
      {/* Its own layer for the glow: a shadow on a view with no fill follows
          what it draws, so only the gradient glows, not the track. */}
      <View style={[StyleSheet.absoluteFill, styles.glow, { shadowOpacity: isDark ? 0.4 : 0.5 }]}>
        <Svg width={REST_RING} height={REST_RING}>
          <Defs>
            <SvgGradient id="restRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={TIMER_GRADIENT[0]} />
              <Stop offset="1" stopColor={TIMER_GRADIENT[1]} />
            </SvgGradient>
          </Defs>
          <AnimatedCircle
            cx={c}
            cy={c}
            r={RING_R}
            stroke="url(#restRing)"
            strokeWidth={RING_W}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[circ, circ]}
            rotation={-90}
            origin={`${c}, ${c}`}
            animatedProps={drain}
          />
        </Svg>
      </View>
      <DumbbellIcon size={15} color={t.ts} />
    </View>
  );
}

/** The workout bar's countdown: a gradient line over the hairline between the
 *  rest and the workout's row, draining from its right-hand end. Its holder
 *  places it; the hairline under it is the bar's own. */
export function RestDrainLine({ progress }: { progress: SharedValue<number> }) {
  const drain = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  return (
    <Reanimated.View style={[styles.drain, drain]} pointerEvents="none">
      <LinearGradient colors={TIMER_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.drainFill} />
    </Reanimated.View>
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
  ring:      { width: REST_RING, height: REST_RING, alignItems: "center", justifyContent: "center" },
  glow:      { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowRadius: 3 },
  drain:     {
    height: 3, transformOrigin: "left",
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 4,
  },
  drainFill: { flex: 1, borderRadius: 1.5 },
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
