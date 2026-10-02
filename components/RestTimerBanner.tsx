import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, Easing, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import * as Haptics from "expo-haptics";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTheme } from "../contexts/ThemeContext";
import { useFloatingBars } from "../hooks/useFloatingBars";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import { FontFamily, ACCT, APP_LIGHT, APP_DARK } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { ABOVE_KEYBOARD_TOOLS } from "../constants/floatingBars";

function fmtTime(secs: number): string {
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

export default function RestTimerBanner() {
  const { restDisplay, restTotal, restBannerActive, dismissRestTimer, adjustRestTimer } = useRestTimer();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const progressPct = useSharedValue(1);
  const cardWidth = useSharedValue(0);

  // A new rest starts full.
  useEffect(() => {
    if (restBannerActive) progressPct.value = 1;
  }, [restBannerActive, progressPct]);

  useEffect(() => {
    if (restTotal > 0) {
      const pct = Math.max(0, restDisplay / restTotal);
      progressPct.value = withTiming(pct, { duration: 950, easing: Easing.linear });
    }
  }, [restDisplay, restTotal]);

  const progressFillStyle = useAnimatedStyle(() => ({
    right: cardWidth.value * (1 - progressPct.value),
  }));

  // Where it sits (constants/floatingBars.ts): on top of the workout bar while
  // that shows (the other tabs, a pushed screen), straight above the tab bar on
  // the Workout page. With the keyboard up it rides above the keyboard's own
  // tools (the down key, and the Workout page's ‹ ›), moving with the keyboard
  // on the UI thread. Its buttons never take focus from a text field, so Skip
  // and ±15s answer with the keyboard up and leave it there.
  const { restBottom } = useFloatingBars();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const stackBottom = useSharedValue(restBottom);
  useEffect(() => {
    stackBottom.value = withSpring(restBottom, { damping: 32, stiffness: 280, overshootClamping: true });
  }, [restBottom, stackBottom]);
  const positionStyle = useAnimatedStyle(() => {
    const keyboard = -keyboardHeight.value; // 0 closed, the keyboard's height open
    return { bottom: keyboard > 0 ? Math.max(stackBottom.value, keyboard + ABOVE_KEYBOARD_TOOLS) : stackBottom.value };
  });

  const handleAdjust = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    adjustRestTimer(delta);
  };

  // There only while a rest runs, sliding in and out as it comes and goes. It
  // used to stay mounted and slide off screen, with whether it took taps set
  // apart from where it sat: two things that had to agree. Mounted only while
  // a rest runs, a banner on screen is always the live one, its time moving
  // and Skip and ±15s answering.
  if (!restBannerActive) return null;

  return (
    <Reanimated.View
      style={[styles.bannerOuter, positionStyle]}
      entering={SlideInDown.springify().damping(32).stiffness(280).overshootClamping(1)}
      exiting={SlideOutDown.duration(250)}
      pointerEvents="box-none"
    >
      <NeuCard dark={isDark} style={styles.bannerCard}>
        <View
          style={styles.progressTrack}
          onLayout={e => { cardWidth.value = e.nativeEvent.layout.width; }}
        >
          <Reanimated.View style={[styles.progressFill, progressFillStyle]} />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: t.tp }]}>REST</Text>
          <BounceButton onPress={() => handleAdjust(-15)} style={[styles.adjBtn, { backgroundColor: t.div }]}>
            <Text style={[styles.adjText, { color: t.tp }]}>−15s</Text>
          </BounceButton>
          <Text style={[styles.time, { color: t.tp }]}>{fmtTime(restDisplay)}</Text>
          <BounceButton onPress={() => handleAdjust(15)} style={[styles.adjBtn, { backgroundColor: t.div }]}>
            <Text style={[styles.adjText, { color: t.tp }]}>+15s</Text>
          </BounceButton>
          <BounceButton onPress={dismissRestTimer} style={styles.skipBtn}>
            <Text style={styles.skipText}>Skip</Text>
          </BounceButton>
        </View>
      </NeuCard>
    </Reanimated.View>
  );
}

// Fixed line heights, so the banner is exactly REST_BANNER_H (64) tall: with
// the keyboard up, the Workout page keeps its notes card and the field being
// typed into clear of it by that (ABOVE_REST_ON_KEYBOARD).
const styles = StyleSheet.create({
  bannerOuter:   { position: "absolute", left: 12, right: 12 },
  bannerCard:    { borderRadius: 20 },
  progressTrack: { height: 4 },
  progressFill:  { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 6 },
  row:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10 },
  label:       { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 1.2, opacity: 0.5 },
  time:        { fontFamily: FontFamily.bold, fontSize: 28, lineHeight: 34, letterSpacing: 1, flex: 1, textAlign: "center" },
  adjBtn:      { borderRadius: PILL_RADIUS, paddingHorizontal: 10, paddingVertical: 8 },
  adjText:     { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
  skipBtn:     { borderRadius: PILL_RADIUS, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
  skipText:    { fontFamily: FontFamily.bold, fontSize: 13, lineHeight: 18, color: "#fff" },
});
