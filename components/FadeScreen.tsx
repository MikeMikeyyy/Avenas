import { useRef, useCallback } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";
// From expo-router, not @react-navigation/native: as of SDK 56 expo-router no
// longer runs on react-navigation and importing it fails the bundle.
import { useFocusEffect } from "expo-router";

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
 */
export default function FadeScreen({ children, style, duration = 180 }: FadeScreenProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const hasFaded = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasFaded.current) return;   // already visible: never drop back to 0
      hasFaded.current = true;
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start();
    }, [duration, opacity])
  );

  return (
    <Animated.View style={[{ flex: 1, opacity }, style]}>
      {children}
    </Animated.View>
  );
}
