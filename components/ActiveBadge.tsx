// The pulsing green "Active" pill beside the active program's name.
//
// One component because the Journal and My Programs both show it on the same
// program, side by side in a user's head, and the two local copies had drifted:
// the Journal's was a full pill, My Programs' a rounded rectangle with 10pt
// corners and a little less padding.

import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";

import { ACCT, FontFamily } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";

export default function ActiveBadge() {
  // Lazy state rather than `useRef(...).current`: same one-time value, without
  // reading a ref during render.
  const [scale]    = useState(() => new Animated.Value(1));
  const [dotPulse] = useState(() => new Animated.Value(0.25));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,    { toValue: 1.08, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(dotPulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,    { toValue: 1,    duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
          Animated.timing(dotPulse, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, dotPulse]);

  return (
    <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
      <Animated.View style={[styles.dot, { opacity: dotPulse }]} />
      <Text style={styles.text}>Active</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCT, borderRadius: PILL_RADIUS, paddingHorizontal: 12, paddingVertical: 5, shadowColor: ACCT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 8 },
  dot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  text:  { fontFamily: FontFamily.bold, fontSize: 12, color: "#fff", letterSpacing: 0.3 },
});
