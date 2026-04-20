import { useRef } from "react";
import { Animated, TouchableOpacity, StyleSheet, StyleProp, ViewStyle, AccessibilityRole } from "react-native";
import * as Haptics from "expo-haptics";

interface BounceButtonProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}

// These props control how the button sits in its parent's layout.
// They belong on TouchableOpacity so flex distribution and margins work correctly.
const OUTER_KEYS = new Set([
  "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf",
  "position", "top", "right", "bottom", "left", "zIndex",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
]);

export default function BounceButton({
  onPress, style, children, accessibilityLabel, accessibilityRole,
}: BounceButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const onIn = () =>
    Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 50, bounciness: 2 }).start();

  const onOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start();

  // Split the flattened style into outer (sizing/positioning) and inner (visual/layout)
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outerStyle: Record<string, unknown> = {};
  const innerStyle: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(flat)) {
    if (OUTER_KEYS.has(key)) outerStyle[key] = val;
    else innerStyle[key] = val;
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={onIn}
      onPressOut={onOut}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={outerStyle as StyleProp<ViewStyle>}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      <Animated.View style={[innerStyle as StyleProp<ViewStyle>, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}
