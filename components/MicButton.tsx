// The mic beside a chat's send button: voice typing (hooks/useDictation.ts;
// user ask, 2026-11-14: in every chat, with animation as it's tapped and as
// you speak). Idle, a quiet mic in a circle like the text box's; tapped, it
// bounces (BounceButton, with its light haptic); listening, it fills green,
// a ring pulses out from it and a halo swells with your voice. Reanimated on
// the UI thread; with Reduce Motion on, the ring holds still. Not drawn where
// voice typing can't work (`available`).

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing, cancelAnimation, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";

import BounceButton from "./BounceButton";
import MicIcon from "./icons/MicIcon";
import { ACCT, APP_DARK, APP_LIGHT, ON_FILL } from "../constants/theme";
import { glowOpacity } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import type { Dictation } from "../hooks/useDictation";

export default function MicButton({ dictation, size }: {
  dictation: Dictation;
  /** Its diameter: the send button's beside it. */
  size: number;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reduceMotion = useReducedMotion();
  const { listening, level } = dictation;
  const on = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    on.value = withTiming(listening ? 1 : 0, { duration: 180 });
    if (listening && !reduceMotion) {
      pulse.value = 0;
      pulse.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 150 });
    }
  }, [listening, reduceMotion, on, pulse]);

  // The colours and glow strength, worked out here for the worklets below
  // (a coloured glow is softer on dark, DARK_GLOW_SCALE).
  const idleFill = t.ctrl;
  const idleEdge = t.div;
  const ringPeak = glowOpacity(0.5, isDark);
  const haloPeak = glowOpacity(0.32, isDark);

  const fillStyle = useAnimatedStyle(() => {
    const o = on.value;
    const l = level.value;
    return {
      backgroundColor: interpolateColor(o, [0, 1], [idleFill, ACCT]),
      borderColor: interpolateColor(o, [0, 1], [idleEdge, ACCT]),
      transform: [{ scale: 1 + 0.06 * l * o }],
    };
  });
  // A ring that keeps pulsing out while it listens, stronger as you speak.
  const ringStyle = useAnimatedStyle(() => {
    const o = on.value;
    const p = pulse.value;
    const l = level.value;
    return {
      opacity: o * ringPeak * (1 - p) * (0.45 + 0.55 * l),
      transform: [{ scale: 1 + 0.55 * p + 0.2 * l }],
    };
  });
  // A soft halo that swells with your voice.
  const haloStyle = useAnimatedStyle(() => {
    const o = on.value;
    const l = level.value;
    return { opacity: o * haloPeak * (0.35 + 0.65 * l), transform: [{ scale: 1.05 + 0.45 * l }] };
  });
  const idleIcon = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  const liveIcon = useAnimatedStyle(() => ({ opacity: on.value }));

  if (!dictation.available) return null;

  const round = { width: size, height: size, borderRadius: size / 2 };
  const glyph = Math.round(size * 0.48);
  const inset = (size - glyph) / 2;
  return (
    <BounceButton
      onPress={dictation.toggle}
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop voice typing" : "Voice typing"}
      accessibilityState={{ selected: listening }}
    >
      <View style={{ width: size, height: size }}>
        <Animated.View pointerEvents="none" style={[styles.layer, round, { backgroundColor: ACCT }, haloStyle]} />
        <Animated.View pointerEvents="none" style={[styles.layer, round, styles.ring, { borderColor: ACCT }, ringStyle]} />
        <Animated.View style={[styles.layer, round, styles.fill, fillStyle]}>
          <Animated.View style={[styles.layer, { left: inset, top: inset }, idleIcon]}>
            <MicIcon size={glyph} color={t.ts} />
          </Animated.View>
          <Animated.View style={[styles.layer, { left: inset, top: inset }, liveIcon]}>
            <MicIcon size={glyph} color={ON_FILL} />
          </Animated.View>
        </Animated.View>
      </View>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  // Placed in points, never a percentage (CLAUDE.md).
  layer: { position: "absolute", left: 0, top: 0 },
  ring:  { borderWidth: 2 },
  fill:  { borderWidth: 1 },
});
