// components/FlameIcon.tsx
//
// The streak flame. Renders the tier's Lottie animation when `color` is one of
// the STREAK_TIERS colours, and falls back to a tinted inline SVG otherwise —
// which is what draws the greyed-out "day you missed" flames on the streak page,
// since a Lottie's colours are baked in and can't be dimmed to an rgba().
//
// Matching on the colour string keeps every call site unchanged: they already
// pass `tier.color` for a live flame and an rgba() for a dead one, which is
// exactly the distinction that decides the renderer.
//
// ── Sizing, and why it isn't just width:size ─────────────────────────────────
// The artwork is a 1080×1080 canvas, but the flame only occupies the middle of
// it: 38.8% of the width, 61.3% of the height, and its centre sits at
// (548.6, 509.8) rather than (540, 540). Rendering the canvas at size×size would
// draw a flame roughly 60% the height of the old SVG, sitting slightly high and
// right of centre — visibly off inside a circle.
//
// So the canvas is scaled up until the FLAME (not the canvas) is `size * FILL`
// tall, then offset so the flame's own centre lands on the container's centre.
// Measured from the path keyframes, union across all 19 of them.

import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import LottieView from "lottie-react-native";
import Reanimated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from "react-native-reanimated";

import { STREAK_TIERS } from "../constants/streakTiers";

const BODY      = "M12 2 c1 6,8 8,8 16 a8 8 0 1 1-16 0 c0-4,3-5,3-9 c0 3,2 4,3 4 c-1-4,1-8,2-11 z";
const HIGHLIGHT = "M12 12 c.5 3,3 3,3 8 a3 3 0 1 1-6 0 c0-2,1-2,1-4 c0 1,1 1.5,1.5 1.5 c-.5-2,0-4,.5-5.5 z";

// Flame bounds within the 1080×1080 Lottie canvas, as fractions of it.
//
// Measured as exact cubic-bezier extrema across every keyframe and BOTH layers
// (the coloured flame and the white core), not from the path vertices. The
// curves bulge about 19px wider than their vertices do, so a vertex-only
// measurement reads 419 wide instead of 439 and shaves ~2% off each side.
const FLAME_H  = 662.14 / 1080; // 0.6131
const FLAME_CX = 544.62 / 1080; // 0.5043 — just right of the canvas centre
const FLAME_ASPECT = 438.55 / 662.14; // 0.662 — far taller than wide

/**
 * Vertical centre, averaged over the animation rather than taken from the union
 * box — 0.4935 instead of the union's 0.4720.
 *
 * The flame's tip shoots UP on two of its three poses, so the union box carries
 * a 122-unit empty band at the top (7% of its height) that is only filled for
 * part of the loop. Centring on the union leaves the flame visibly low at rest:
 * invisible in open space, obvious beside a thin horizontal line like the
 * milestone progress bar. Centring on the time-average puts it where the eye
 * expects it, and the taller poses simply overhang the box (nothing clips).
 */
const FLAME_CY = 532.9 / 1080; // 0.4935
/** How much of `size` the flame's height takes. Under 1 so it sits inside a
 *  circle (the `isToday` day cell, the hero glow) without touching the edge.
 *  Turn this one number to make every flame in the app bigger or smaller. */
const FILL = 0.86;

const lottieForColor = (color: string) =>
  STREAK_TIERS.find(t => t.color.toLowerCase() === color.toLowerCase())?.lottie ?? null;

/**
 * The width a flame of `size` actually renders at. The box hugs the artwork, so
 * it is far narrower than `size` — anything laid out in a column with a flame
 * (the milestone tier numbers sit under one) must use THIS, not `size`, or it
 * will centre against a box that isn't there.
 */
export function flameWidth(size: number): number {
  return size * FILL * FLAME_ASPECT;
}

/** The height a flame of `size` actually renders at — `size` is the budget, not
 *  the result. Anything positioned against a flame's real extent (the hero's
 *  glow circle overhangs its box, so the margin below has to clear it) should
 *  derive from this rather than from `size`. */
export function flameHeight(size: number): number {
  return size * FILL;
}

interface Props {
  size?: number;
  color: string;
  animated?: boolean;
}

export default function FlameIcon({ size = 44, color, animated = true }: Props) {
  const source = lottieForColor(color);

  // The box HUGS the flame rather than being square. A square box would carry
  // ~37% dead width, which shows up as a gap between the flame and the streak
  // number on Home. Every call site either centres this in its own square (the
  // day cells, the hero) or lays it out in a row, so hugging works for both.
  const h = size * FILL;
  const w = h * FLAME_ASPECT;

  if (source) {
    // Canvas scaled until the flame is `h` tall, then offset so the FLAME's
    // centre — not the canvas centre — lands on the box's centre. The result is
    // a box that contains exactly the flame, nothing else.
    const canvas = h / FLAME_H;
    const left = w / 2 - canvas * FLAME_CX;
    const top = h / 2 - canvas * FLAME_CY;
    return (
      // Deliberately NO overflow:hidden. The canvas is transparent outside the
      // flame and absolutely positioned inside a fixed-size box, so it can't
      // affect layout — but clipping here means any drift between these measured
      // constants and what Lottie actually rasterises shows up as shaved edges.
      // Letting it overhang costs nothing and can never cut the artwork.
      <View style={{ width: w, height: h }} pointerEvents="none">
        <LottieView
          source={source}
          autoPlay={animated}
          loop={animated}
          style={{ position: "absolute", left, top, width: canvas, height: canvas }}
        />
      </View>
    );
  }
  return <SvgFlame height={h} color={color} animated={animated} />;
}

/** The original inline SVG, kept for colours no tier owns — the dimmed flames on
 *  days the user didn't train, which a baked-colour Lottie can't represent.
 *  Takes the already-scaled `height` so a dimmed flame matches a live one in the
 *  same row of day cells. Its viewBox is 24×32, a slightly wider flame than the
 *  Lottie's, which is fine: they never sit side by side at the same size. */
function SvgFlame({ height, color, animated }: { height: number; color: string; animated: boolean }) {
  const scale   = useSharedValue(1);
  const shadowR = useSharedValue(6);

  useEffect(() => {
    if (!animated) return;
    const ease = Easing.inOut(Easing.sin);
    scale.value = withRepeat(withTiming(1.06, { duration: 900, easing: ease }), -1, true);
    shadowR.value = withRepeat(withTiming(14, { duration: 1100, easing: ease }), -1, true);
  }, [animated]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: shadowR.value,
  }));

  const w = height * 0.75;

  return (
    <Reanimated.View style={[styles.svgWrap, { width: w, height }, animStyle]}>
      <Svg viewBox="0 0 24 32" width={w} height={height}>
        <Path d={BODY}      fill={color} />
        <Path d={HIGHLIGHT} fill="#ffffff" fillOpacity={0.7} />
      </Svg>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  svgWrap: { alignItems: "center", justifyContent: "center" },
});
