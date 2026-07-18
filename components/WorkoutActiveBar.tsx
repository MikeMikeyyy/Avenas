import React, { useEffect } from "react";
import { View, Text, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSegments } from "expo-router";
import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTheme } from "../contexts/ThemeContext";
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

export default function WorkoutActiveBar() {
  const { isRunning, isPaused, elapsedSeconds, pauseTimer, resumeTimer, discardWorkout } = useWorkoutTimer();
  const { dismissRestTimer, restBannerActive } = useRestTimer();
  const { isDark } = useTheme();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const onTabScreen = segments.includes("(tabs)" as never);
  const onWorkoutTab = segments[segments.length - 1] === "workout";

  const bottomSv = useSharedValue(onTabScreen ? 112 : insets.bottom + 16);
  useEffect(() => {
    bottomSv.value = withSpring(onTabScreen ? 112 : insets.bottom + 16, { damping: 32, stiffness: 280, overshootClamping: true });
  }, [onTabScreen, insets.bottom, bottomSv]);
  const active = (isRunning || isPaused) && !onWorkoutTab;
  const barY = useSharedValue(200);

  useEffect(() => {
    barY.value = active
      ? withSpring(0, { damping: 32, stiffness: 280, overshootClamping: true })
      : withTiming(200, { duration: 220 });
  }, [active, barY]);

  const bottomOffset = useSharedValue(0);
  useEffect(() => {
    bottomOffset.value = withSpring(restBannerActive ? -76 : 0, { damping: 32, stiffness: 280 });
  }, [restBannerActive, bottomOffset]);

  const animStyle = useAnimatedStyle(() => ({
    bottom: bottomSv.value,
    transform: [{ translateY: barY.value + bottomOffset.value }],
  }));

  const handleDiscard = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Discard Workout", "All progress will be lost. Are you sure?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard", style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          dismissRestTimer();
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
      <View style={[styles.bar, { backgroundColor: isDark ? APP_DARK.div : "#fff", shadowColor: "#000" }]}>
        <View style={styles.timerPill}>
          <View style={[styles.dot, isPaused && styles.dotPaused]} />
          <Text style={[styles.timerText, { color: t.tp }]}>{fmtTime(elapsedSeconds)}</Text>
        </View>
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
      </View>
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
