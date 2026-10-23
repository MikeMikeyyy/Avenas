import { useRef, useCallback, useState } from "react";
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
// From expo-router, not @react-navigation/native: as of SDK 56 expo-router no
// longer runs on react-navigation and importing it fails the bundle.
import { useFocusEffect } from "expo-router";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

interface FadeScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}

/**
 * A screen that fades in when it first appears.
 *
 * ONCE PER MOUNT, deliberately. It used to re-run on every focus, dropping an
 * already-visible screen to opacity 0 and revealing whatever sat behind it: the
 * white root view, which is a flashbang in dark mode. Every tab switch and every
 * back-navigation did it, since both re-focus a screen that is already mounted
 * and painted. Home had opted out through a prop; that is now how all of them
 * behave, and the entrance fade still plays the first time a screen mounts.
 *
 * The root view is themed too (contexts/ThemeContext.tsx), so a frame that this
 * can't cover (a screen the OS reclaimed and is rebuilding) lands on the app's
 * own background rather than white.
 *
 * It fades by a COVER in the page colour going clear over the screen, not by
 * the screen's own opacity: Liquid Glass (components/GlassButton.tsx) draws
 * wrongly under any opacity below 1 on anything above it. What's behind every
 * screen is that same page colour (the Stack's contentStyle), so the two look
 * the same frame for frame.
 */
export default function FadeScreen({ children, style, duration = 180 }: FadeScreenProps) {
  const { isDark } = useTheme();
  const [cover] = useState(() => new Animated.Value(1));
  const hasFaded = useRef(false);
  const [covered, setCovered] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (hasFaded.current) return;   // already visible: never cover it again
      hasFaded.current = true;
      Animated.timing(cover, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      }).start(() => setCovered(false));
    }, [duration, cover])
  );

  return (
    <View style={styles.fill}>
      <View style={[styles.fill, style]}>
        {children}
      </View>
      {covered && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? APP_DARK.bg : APP_LIGHT.bg, opacity: cover }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
