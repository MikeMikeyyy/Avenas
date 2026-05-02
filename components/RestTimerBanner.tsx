import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTheme } from "../contexts/ThemeContext";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import { FontFamily, ACCT, APP_LIGHT, APP_DARK } from "../constants/theme";

function fmtTime(secs: number): string {
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

export default function RestTimerBanner() {
  const { restDisplay, restBannerActive, dismissRestTimer, adjustRestTimer } = useRestTimer();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const bannerY = useSharedValue(300);

  useEffect(() => {
    if (restBannerActive) {
      bannerY.value = withSpring(0, { damping: 32, stiffness: 280, overshootClamping: true });
    } else {
      bannerY.value = withTiming(300, { duration: 250 });
    }
  }, [restBannerActive, bannerY]);

  const bannerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bannerY.value }],
  }));

  const handleAdjust = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    adjustRestTimer(delta);
  };

  return (
    <Reanimated.View
      style={[styles.bannerOuter, bannerAnimStyle]}
      pointerEvents={restBannerActive ? "box-none" : "none"}
    >
      <NeuCard dark={isDark} style={styles.bannerCard}>
        <View style={styles.handle} />
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

const styles = StyleSheet.create({
  bannerOuter: { position: "absolute", bottom: 112, left: 12, right: 12 },
  bannerCard:  { borderRadius: 20 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)", alignSelf: "center", marginTop: 10, marginBottom: 8 },
  row:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  label:       { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 1.2, opacity: 0.5 },
  time:        { fontFamily: FontFamily.bold, fontSize: 28, letterSpacing: 1, flex: 1, textAlign: "center" },
  adjBtn:      { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  adjText:     { fontFamily: FontFamily.semibold, fontSize: 13 },
  skipBtn:     { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
  skipText:    { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
});
