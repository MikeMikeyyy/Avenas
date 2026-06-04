import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, withDelay, withRepeat, Easing,
  interpolate,
} from "react-native-reanimated";

import { useTheme } from "../contexts/ThemeContext";
import Confetti from "../components/onboarding/Confetti";
import PrimaryButton from "../components/PrimaryButton";
import { APP_DARK, APP_LIGHT, ACCT, FontFamily } from "../constants/theme";

export default function AccountCreatedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const scale = useSharedValue(0);
  const ring = useSharedValue(0);
  const textIn = useSharedValue(0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scale.value = withDelay(120, withSpring(1, { damping: 11, stiffness: 170 }));
    ring.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.out(Easing.ease) }), -1, false);
    textIn.value = withDelay(320, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, []);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ring.value, [0, 1], [0.45, 0]),
    transform: [{ scale: 0.85 + ring.value * 0.9 }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textIn.value,
    transform: [{ translateY: (1 - textIn.value) * 12 }],
  }));

  const finish = () => {
    // The deck/signup/terms are still beneath this screen; clear them so Home
    // can't be back-swiped into the flow. Onboarding was completed on accept.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/home");
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <Confetti />

      <View style={styles.center}>
        <View style={styles.badge}>
          <Reanimated.View style={[styles.ring, ringStyle]} />
          <Reanimated.View style={[styles.circle, circleStyle]}>
            <Ionicons name="checkmark" size={56} color="#fff" />
          </Reanimated.View>
        </View>

        <Reanimated.View style={[styles.textBlock, textStyle]}>
          <Text style={[styles.title, { color: t.tp }]}>All done!</Text>
          <Text style={[styles.subtitle, { color: t.ts }]}>Your account is ready. Time to train.</Text>
        </Reanimated.View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <PrimaryButton label="Continue" dark={isDark} onPress={finish} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  badge:     { width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  ring:      { position: "absolute", width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: ACCT },
  circle:    {
    width: 110, height: 110, borderRadius: 55, backgroundColor: ACCT, alignItems: "center", justifyContent: "center",
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 18, elevation: 8,
  },
  textBlock: { alignItems: "center", marginTop: 32 },
  title:     { fontFamily: FontFamily.bold, fontSize: 30, textAlign: "center" },
  subtitle:  { fontFamily: FontFamily.regular, fontSize: 16, textAlign: "center", marginTop: 10, lineHeight: 23 },
  footer:    { paddingHorizontal: 28, paddingTop: 12 },
});
