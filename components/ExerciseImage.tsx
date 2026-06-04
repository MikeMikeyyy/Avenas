// Renders a bundled exercise image by Exercise.id.
//
//  - variant="thumb" → small static WebP. Use this in scrolling lists: it loads
//    synchronously from the app bundle, so fast-scroll never shows a blank/lag.
//  - variant="full"  → the animated GIF. Use only on detail / preview screens —
//    never in a list (animating many GIFs at once tanks scroll perf).
//
// Falls back to a neutral DumbbellIcon tile when no image is bundled for the id
// (e.g. before the build script has been run, or for custom exercises).

import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";

import DumbbellIcon from "./DumbbellIcon";
import { EXERCISE_THUMBS, EXERCISE_GIFS } from "../assets/exerciseImages";

interface Props {
  exerciseId: string;
  /** "thumb" = static still (lists), "full" = animated GIF (detail). Default "thumb". */
  variant?: "thumb" | "full";
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
  size,
  radius = 12,
  backgroundColor,
  fallbackColor,
  style,
}: Props) {
  // "full" prefers the animated GIF, but falls back to the static photo when
  // no GIF is bundled (the current free-exercise-db set is photos only).
  const source = (variant === "full" ? EXERCISE_GIFS[exerciseId] : undefined)
    ?? EXERCISE_THUMBS[exerciseId];

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
          // keeps fast-scroll instant. `thumb` files are static stills; only
          // the `full` GIF animates (expo-image autoplays animated sources).
          cachePolicy="memory"
          transition={0}
        />
      ) : (
        <DumbbellIcon size={size * 0.5} color={fallbackColor} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
