import { useRef, useCallback } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

interface FadeScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
  // Fade in only on the FIRST focus, not on every re-focus. Use this on a screen
  // that can be re-focused while it's already visible — e.g. Home when a modal
  // (Insights) is dismissed on top of it. Re-running the fade there drops the view
  // to opacity 0 and flashes whatever is behind it (a white "reload"). With `once`
  // the entrance fade still plays the first time, then the screen stays put.
  once?: boolean;
}

export default function FadeScreen({ children, style, duration = 180, once = false }: FadeScreenProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const hasFaded = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (once && hasFaded.current) return;   // already faded once — don't replay (no flash)
      hasFaded.current = true;
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start();
    }, [once, duration, opacity])
  );

  return (
    <Animated.View style={[{ flex: 1, opacity }, style]}>
      {children}
    </Animated.View>
  );
}
