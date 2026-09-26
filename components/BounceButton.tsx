import { useRef } from "react";
import { Animated, TouchableOpacity, StyleSheet, StyleProp, ViewStyle, AccessibilityRole, AccessibilityState } from "react-native";
import * as Haptics from "expo-haptics";
import { alertOffline, useOffline } from "../contexts/ConnectivityContext";

interface BounceButtonProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  /** The action needs the server (send, accept, a trainer's archive / delete).
   *  While the phone is offline the button dims, and a tap says so instead of
   *  starting something that can't finish. Never on a button that only
   *  touches this phone, and never on glass (it dims by opacity). */
  needsConnection?: boolean;
}

/** How far a button that can't work offline fades while offline. */
const OFFLINE_OPACITY = 0.4;

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
  onPress, style, children, accessibilityLabel, accessibilityRole, accessibilityState, needsConnection,
}: BounceButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const offline = useOffline();
  const blocked = !!needsConnection && offline;

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
        if (blocked) { alertOffline(); return; }
        onPress?.();
      }}
      style={outerStyle as StyleProp<ViewStyle>}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={blocked ? { ...accessibilityState, disabled: true } : accessibilityState}
      accessibilityHint={blocked ? "Needs a connection" : undefined}
    >
      <Animated.View style={[innerStyle as StyleProp<ViewStyle>, { transform: [{ scale }] }, blocked && { opacity: OFFLINE_OPACITY }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}
