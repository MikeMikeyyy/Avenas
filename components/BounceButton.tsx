import { useRef } from "react";
import { Animated, TouchableOpacity, StyleProp, ViewStyle, AccessibilityRole } from "react-native";
import * as Haptics from "expo-haptics";

interface BounceButtonProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}

export default function BounceButton({ onPress, style, children, accessibilityLabel, accessibilityRole }: BounceButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const onIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 2 }).start();

  const onOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={onIn}
      onPressOut={onOut}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={style}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}
