import React, { useEffect } from "react";
import { View, Text, Alert, StyleSheet, Pressable } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { useTheme } from "../contexts/ThemeContext";
import { useFloatingBars } from "../hooks/useFloatingBars";
import BounceButton from "./BounceButton";
import TrashIcon from "./TrashIcon";
import { FontFamily, ACCT, APP_LIGHT, APP_DARK } from "../constants/theme";

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

export default function WorkoutActiveBar() {
  const { isPaused, elapsedSeconds, pauseTimer, resumeTimer, discardWorkout } = useWorkoutTimer();
  const { isDark } = useTheme();
  const router = useRouter();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Where it sits, and whether it shows, come from the same place the rest
  // timer's do (hooks/useFloatingBars.ts), so the rest timer stacks on top of
  // it rather than pushing it up over itself. That push was what left it
  // half on screen on the Workout page during a rest: 76 up from a 200 drop.
  const { onTabScreen, workoutBarShown: active, workoutBarBottom } = useFloatingBars();

  const bottomSv = useSharedValue(workoutBarBottom);
  useEffect(() => {
    bottomSv.value = withSpring(workoutBarBottom, { damping: 32, stiffness: 280, overshootClamping: true });
  }, [workoutBarBottom, bottomSv]);
  const barY = useSharedValue(200);

  useEffect(() => {
    barY.value = active
      ? withSpring(0, { damping: 32, stiffness: 280, overshootClamping: true })
      : withTiming(200, { duration: 220 });
  }, [active, barY]);

  const animStyle = useAnimatedStyle(() => ({
    bottom: bottomSv.value,
    transform: [{ translateY: barY.value }],
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

  return (
    <Reanimated.View
      style={[styles.outer, animStyle]}
      pointerEvents={active ? "box-none" : "none"}
    >
      <Reanimated.View style={[styles.bar, { backgroundColor: isDark ? APP_DARK.div : "#fff", shadowColor: "#000" }, pressStyle]}>
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
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (isPaused) resumeTimer();
          else pauseTimer();
        }}>
          <View style={[styles.iconBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : APP_LIGHT.div }]}>
            <Ionicons name={isPaused ? "play" : "pause"} size={16} color={t.tp} />
          </View>
        </BounceButton>
        <BounceButton onPress={handleDiscard}>
          <View style={[styles.iconBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : APP_LIGHT.div }]}>
            <TrashIcon size={17} color={t.ts} />
          </View>
        </BounceButton>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  outer:     { position: "absolute", left: 20, right: 20 },
  bar:       {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8,
  },
  timerPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCT },
  dotPaused: { backgroundColor: "#F59E0B" },
  timerText: { fontFamily: FontFamily.bold, fontSize: 18, letterSpacing: 0.5 },
  iconBtn:   { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
