// Renders a bundled exercise image by Exercise.id.
//
//  - variant="thumb" → a small square still. Use this in scrolling lists: it
//    loads synchronously from the app bundle, so fast-scroll never shows a blank.
//  - variant="full"  → the exercise screen's picture. An illustration shows its
//    positions in turn (start, then end), cross-fading, whole inside the square
//    on its own studio backdrop; a kept photo fills the square as before. With
//    Reduce Motion on, an illustration holds its first position.
//
// Falls back to a neutral DumbbellIcon tile when no image is bundled for the id
// (e.g. a custom exercise, or one retired from the list).

import { useEffect, useState } from "react";
import { View, StyleSheet, type ImageSourcePropType, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "react-native-reanimated";

import DumbbellIcon from "./DumbbellIcon";
import { EXERCISE_THUMBS, EXERCISE_FRAMES } from "../assets/exerciseImages";
import { EXERCISE_STUDIO } from "../constants/theme";

/** How long each position shows before the next, and the fade between them. */
const FRAME_HOLD_MS = 1400;
const FRAME_FADE_MS = 450;

interface Props {
  exerciseId: string;
  /** "thumb" = small still (lists), "full" = the exercise screen's picture. Default "thumb". */
  variant?: "thumb" | "full";
  /**
   * A user-supplied photo URI (e.g. a custom exercise's `imageUri`: a local
   * file for your own, a URL for one a program carries). When set it takes
   * precedence over the bundled catalogue lookup — custom exercises aren't in
   * the bundle, so without this they'd always fall back to the dumbbell tile.
   */
  overrideUri?: string;
  /** Square side length in px. */
  size: number;
  /** Corner radius. Default 12. */
  radius?: number;
  /** Background behind the image / fallback tile. */
  backgroundColor: string;
  /** Fallback icon tint. */
  fallbackColor: string;
  style?: StyleProp<ViewStyle>;
}

export default function ExerciseImage({
  exerciseId,
  variant = "thumb",
  overrideUri,
  size,
  radius = 12,
  backgroundColor,
  fallbackColor,
  style,
}: Props) {
  const frames = !overrideUri && variant === "full" ? EXERCISE_FRAMES[exerciseId] : undefined;
  if (frames && frames.length > 0) {
    // Keyed by exercise so a different exercise starts from its first position.
    return <IllustrationFrames key={exerciseId} frames={frames} size={size} radius={radius} style={style} />;
  }

  // A custom photo (overrideUri) wins; otherwise the bundled still.
  const source = overrideUri ? { uri: overrideUri } : EXERCISE_THUMBS[exerciseId];

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor, overflow: "hidden" }, styles.center, style]}>
      {source ? (
        <Image
          source={source}
          style={{ width: size, height: size }}
          // `cover` fills the square box edge-to-edge so every thumbnail is a
          // uniform square regardless of the source photo's aspect ratio.
          contentFit="cover"
          // Bundled assets are already on-device — memory cache is enough and
          // keeps fast-scroll instant. A trainer's photo carried with a program
          // is a URL, so that one is kept on disk too rather than downloaded
          // again every launch.
          cachePolicy={overrideUri && /^https?:/i.test(overrideUri) ? "memory-disk" : "memory"}
          transition={0}
        />
      ) : (
        <DumbbellIcon size={size * 0.5} color={fallbackColor} />
      )}
    </View>
  );
}

/** An illustration's positions, one after another. Kept apart from the list
 *  thumbnail so a scrolling list carries no timers. */
function IllustrationFrames({ frames, size, radius, style }: {
  frames: ImageSourcePropType[];
  size: number;
  radius: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const moving = frames.length > 1 && !reduceMotion;

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % frames.length), FRAME_HOLD_MS);
    return () => clearInterval(timer);
  }, [frames, moving]);

  // Held still (Reduce Motion, or a single hold), it's the first position.
  const shown = moving ? Math.min(index, frames.length - 1) : 0;

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: "hidden" }, style]}>
      <LinearGradient colors={EXERCISE_STUDIO} style={StyleSheet.absoluteFill} />
      <Image
        source={frames[shown]}
        style={{ width: size, height: size }}
        // Whole: an illustration is portrait, and a square crop cut off heads
        // and feet. The studio gradient behind fills the sides seamlessly.
        contentFit="contain"
        cachePolicy="memory"
        transition={moving ? { duration: FRAME_FADE_MS, effect: "cross-dissolve" } : 0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
