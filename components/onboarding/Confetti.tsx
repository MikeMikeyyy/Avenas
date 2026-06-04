import { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat, withDelay, Easing,
  interpolate, Extrapolation,
} from "react-native-reanimated";
import { STREAK_TIERS } from "../../constants/streakTiers";

// Looping confetti rain, built entirely on the UI thread (no native deps / no
// Lottie asset). Colors reuse the streak tier palette.
const COLORS = STREAK_TIERS.map((tier) => tier.color); // orange, green, blue, purple, red
const COUNT = 16;

function Piece({ index, w, h }: { index: number; w: number; h: number }) {
  const color = COLORS[index % COLORS.length];
  const startX = ((index + 0.5) / COUNT) * w + (((index * 53) % 40) - 20);
  const drift = (index % 2 ? 1 : -1) * (16 + ((index * 9) % 36));
  const duration = 2600 + ((index * 137) % 1600);
  const delay = (index * 173) % 2400;
  const size = 7 + (index % 3) * 2;
  const dir = index % 2 ? 1 : -1;

  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
  }, []);

  const style = useAnimatedStyle(() => {
    const y = -40 + p.value * (h + 80);
    const x = startX + Math.sin(p.value * Math.PI * 2) * drift;
    const rotate = p.value * 360 * dir;
    const opacity = interpolate(p.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0], Extrapolation.CLAMP);
    return { opacity, transform: [{ translateX: x }, { translateY: y }, { rotate: `${rotate}deg` }] };
  });

  return (
    <Reanimated.View
      style={[{ position: "absolute", left: 0, top: 0, width: size, height: size * 1.6, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
}

export default function Confetti() {
  const { width, height } = useWindowDimensions();
  return (
    <Reanimated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: COUNT }).map((_, i) => (
        <Piece key={i} index={i} w={width} h={height} />
      ))}
    </Reanimated.View>
  );
}
