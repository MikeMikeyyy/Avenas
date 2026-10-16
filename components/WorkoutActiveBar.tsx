import React, { useEffect } from "react";
import { View, Text, Alert, StyleSheet, Pressable } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, Extrapolation } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTheme } from "../contexts/ThemeContext";
import { useFloatingBars } from "../hooks/useFloatingBars";
import { useOpenWorkoutTimer } from "../hooks/useOpenWorkoutTimer";
import { useUpNext } from "../hooks/useWorkoutTimerStore";
import BounceButton from "./BounceButton";
import TrashIcon from "./TrashIcon";
import { RestActions, RestDrainLine, RestTime, formatRestTime, useRestProgress } from "./RestControls";
import { upNextTail } from "../utils/workoutTimer";
import { FontFamily, ACCT, APP_LIGHT, APP_DARK, CUE_INK, CUE_INK_DARK } from "../constants/theme";
import {
  BAR_INSET_X, BAR_SHADOW, REST_DIVIDER_H, REST_SECTION_H, WORKOUT_BAR_H, barButtonFill,
} from "../constants/floatingBars";

function fmtTime(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

// The timer side's touch area reaches the bar's edges (its padding) and the gap
// before the pause button, so a tap anywhere but the two buttons opens the workout.
const OPEN_HIT_SLOP = { top: 10, bottom: 10, left: 14, right: 8 };
// BounceButton's give, on the UI thread: a quick dip, then a springy return.
const PRESS_IN = { damping: 30, stiffness: 600 };
const PRESS_OUT = { damping: 12, stiffness: 250 };
// The bar's own moves: the spring it rises and grows on, and how fast it goes.
const RISE = { damping: 32, stiffness: 280, overshootClamping: true };

export default function WorkoutActiveBar() {
  const { isPaused, elapsedSeconds, pauseTimer, resumeTimer, discardWorkout } = useWorkoutTimer();
  const { restDisplay, restBannerActive } = useRestTimer();
  const { isDark } = useTheme();
  const router = useRouter();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Where it sits, and whether it shows, come from the same place the rest
  // pill's do (hooks/useFloatingBars.ts), so the two never cover each other.
  const { onTabScreen, workoutBarShown: active, workoutBarBottom, workoutBarHideY, restInBar } = useFloatingBars();

  const bottomSv = useSharedValue(workoutBarBottom);
  useEffect(() => {
    bottomSv.value = withSpring(workoutBarBottom, RISE);
  }, [workoutBarBottom, bottomSv]);
  const barY = useSharedValue(workoutBarHideY);

  useEffect(() => {
    barY.value = active ? withSpring(0, RISE) : withTiming(workoutBarHideY, { duration: 220 });
  }, [active, barY, workoutBarHideY]);

  const animStyle = useAnimatedStyle(() => ({
    bottom: bottomSv.value,
    transform: [{ translateY: barY.value }],
  }));

  // A rest between sets shows in here off the Workout page: the bar grows
  // upward to hold its countdown and buttons, the workout's row staying where
  // it was, and gives it back as the rest ends (or to the rest pill, above the
  // keyboard while that's up). The section sits on the workout's row, so the
  // bar's top edge sweeps down over it as it closes.
  const resting = restBannerActive && restInBar;
  const restOpen = useSharedValue(resting ? 1 : 0);
  useEffect(() => {
    restOpen.value = resting ? withSpring(1, RISE) : withTiming(0, { duration: 250 });
  }, [resting, restOpen]);
  const progress = useRestProgress();
  // The set that's next, which only this bigger card has room for (the pill on
  // the Workout page leaves it out; user decision, 2026-10-15). The Workout tab
  // publishes it (utils/workoutTimerStore.ts).
  const upNext = useUpNext();
  const openTimer = useOpenWorkoutTimer();
  const sizeStyle = useAnimatedStyle(() => ({
    height: WORKOUT_BAR_H + (REST_SECTION_H + REST_DIVIDER_H) * restOpen.value,
  }));
  // The countdown fades in once there's room for it, and out before the edge
  // reaches it.
  const restFade = useAnimatedStyle(() => ({
    opacity: interpolate(restOpen.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
  }));

  // A tap on the bar takes you back into the session, on the exercise you're up
  // to. `upTo` is new on every tap, and the Workout screen answers it by
  // scrolling there (its "Where you're up to"). From a screen pushed over the
  // tabs, dismissTo pops back to them: navigate would push a second copy of the
  // whole tab bar on top.
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  const openWorkout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const href = { pathname: "/(tabs)/workout", params: { upTo: String(Date.now()) } } as const;
    if (onTabScreen) router.navigate(href);
    else router.dismissTo(href);
  };

  const handleDiscard = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Discard Workout", "All progress will be lost. Are you sure?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard", style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          // Takes a running rest with it (RestTimerContext).
          discardWorkout();
        },
      },
    ]);
  };

  const buttonFill = { backgroundColor: barButtonFill(isDark) };

  return (
    <Reanimated.View
      style={[styles.outer, animStyle]}
      pointerEvents={active ? "box-none" : "none"}
    >
      {/* Two views, like the nav bar: the outer casts the shadow, the inner
          clips (iOS drops a shadow on a view that clips). */}
      <Reanimated.View style={[styles.bar, BAR_SHADOW, { backgroundColor: t.nav, borderColor: t.navEdge }, sizeStyle, pressStyle]}>
        <View style={styles.clip}>
          <Reanimated.View style={[styles.restSection, restFade]} pointerEvents={resting ? "box-none" : "none"}>
            <View style={styles.restTop}>
              {/* The time opens the timer on the rest. */}
              <Pressable
                style={styles.restOpen}
                onPress={openTimer}
                accessibilityRole="button"
                accessibilityLabel={`Rest, ${formatRestTime(restDisplay)} left`}
                accessibilityHint="Opens the timer"
              >
                <RestTime seconds={restDisplay} size={24} isDark={isDark} />
              </Pressable>
              <RestActions isDark={isDark} />
            </View>
            {upNext ? (
              // The name is what gives way; the set and its numbers stay whole.
              <View style={styles.upNext} accessible accessibilityLabel={`Up next: ${upNext.exerciseName}, ${upNext.setLabel}${upNext.numbers ? `, ${upNext.numbers}` : ""}`}>
                <Text style={[styles.upNextLabel, { color: isDark ? CUE_INK_DARK : CUE_INK }]}>UP NEXT</Text>
                <Text style={[styles.upNextName, { color: t.tp }]} numberOfLines={1}>{upNext.exerciseName}</Text>
                <Text style={[styles.upNextTail, { color: isDark ? CUE_INK_DARK : CUE_INK }]} numberOfLines={1}>{upNextTail(upNext)}</Text>
              </View>
            ) : null}
          </Reanimated.View>
          <Reanimated.View style={[styles.divider, { backgroundColor: t.div }, restFade]} />
          {/* The countdown: the line between the rest and the workout's row,
              in the timer's gradient, draining from the right. */}
          <Reanimated.View style={[styles.drainHolder, restFade]} pointerEvents="none">
            <RestDrainLine progress={progress} />
          </Reanimated.View>
          <View style={styles.workoutRow}>
            {/* The timer side is the way back in. The whole bar gives under your
                finger, like a BounceButton; the two buttons keep their own taps. */}
            <Pressable
              style={styles.timerPill}
              hitSlop={OPEN_HIT_SLOP}
              onPressIn={() => { pressScale.value = withSpring(0.97, PRESS_IN); }}
              onPressOut={() => { pressScale.value = withSpring(1, PRESS_OUT); }}
              onPress={openWorkout}
              accessibilityRole="button"
              accessibilityLabel="Open workout"
              accessibilityValue={{ text: fmtTime(elapsedSeconds) }}
              accessibilityHint="Goes to the exercise you're up to"
            >
              <View style={[styles.dot, isPaused && styles.dotPaused]} />
              <Text style={[styles.timerText, { color: t.tp }]}>{fmtTime(elapsedSeconds)}</Text>
            </Pressable>
            <BounceButton onPress={() => {
              if (isPaused) resumeTimer();
              else pauseTimer();
            }}>
              <View style={[styles.iconBtn, buttonFill]}>
                <Ionicons name={isPaused ? "play" : "pause"} size={16} color={t.tp} />
              </View>
            </BounceButton>
            <BounceButton onPress={handleDiscard}>
              <View style={[styles.iconBtn, buttonFill]}>
                <TrashIcon size={17} color={t.ts} />
              </View>
            </BounceButton>
          </View>
        </View>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  outer:      { position: "absolute", left: BAR_INSET_X, right: BAR_INSET_X },
  bar:        { borderRadius: WORKOUT_BAR_H / 2, borderWidth: StyleSheet.hairlineWidth },
  clip:       { ...StyleSheet.absoluteFill, borderRadius: WORKOUT_BAR_H / 2, overflow: "hidden" },
  // Everything stands on the bar's bottom edge, which stays put as it grows.
  restSection: {
    position: "absolute", left: 0, right: 0, bottom: WORKOUT_BAR_H + REST_DIVIDER_H, height: REST_SECTION_H,
    justifyContent: "center", paddingLeft: 18, paddingRight: 10,
  },
  restTop:    { flexDirection: "row", alignItems: "center", gap: 14 },
  restOpen:   { flex: 1 },
  upNext:     { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 1, paddingRight: 8 },
  upNextLabel: { fontFamily: FontFamily.bold, fontSize: 10, letterSpacing: 1.1 },
  upNextName: { flexShrink: 1, fontFamily: FontFamily.bold, fontSize: 12 },
  upNextTail: { flexShrink: 0, fontFamily: FontFamily.semibold, fontSize: 12 },
  divider:    { position: "absolute", left: 16, right: 16, bottom: WORKOUT_BAR_H, height: REST_DIVIDER_H },
  // Over the divider, centred on it.
  drainHolder: { position: "absolute", left: 16, right: 16, bottom: WORKOUT_BAR_H - 1, height: 3 },
  workoutRow: {
    position: "absolute", left: 0, right: 0, bottom: 0, height: WORKOUT_BAR_H,
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14,
  },
  timerPill:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCT },
  dotPaused:  { backgroundColor: "#F59E0B" },
  timerText:  { fontFamily: FontFamily.bold, fontSize: 18, letterSpacing: 0.5 },
  iconBtn:    { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
