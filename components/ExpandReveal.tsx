// A row of content that reveals and hides itself: height 0 to its natural
// height over 280ms with a 200ms fade, the same motion as the program builder's
// CollapsibleCard, both on the UI thread.
//
// Not CollapsibleCard itself: that animates a row in once and out before
// unmounting it, so tapping again mid-animation would jump. One progress value
// driving both directions lets a second tap reverse from wherever it got to.
//
// `children` stay mounted, absolutely positioned inside a clipping view, so
// their natural height is measured once and the clip animates to it. Keep
// Reanimated layout-animation wrappers (LinearTransition) off every ancestor:
// they freeze UI-thread height tweens. `useChevron` gives the matching
// rotate style for a caller's chevron so the two move together.

import { useMemo } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

export const REVEAL_HEIGHT_MS = 280;
export const REVEAL_FADE_MS = 200;

/** Drives one open/closed reveal. Hold it in the component that owns the tap.
 *
 *  The returned object is stable for the component's life, so a caller that
 *  drives it from an effect (`useEffect(() => reveal.setOpen(open), [open,
 *  reveal])`, where the open state lives in a parent) doesn't restart the
 *  animation on every unrelated re-render. */
export function useReveal(): {
  progress: SharedValue<number>;
  fade: SharedValue<number>;
  setOpen: (open: boolean) => void;
} {
  const progress = useSharedValue(0);
  const fade = useSharedValue(0);
  return useMemo(
    () => ({
      progress,
      fade,
      setOpen: (open: boolean) => {
        progress.value = withTiming(open ? 1 : 0, { duration: REVEAL_HEIGHT_MS });
        fade.value = withTiming(open ? 1 : 0, { duration: REVEAL_FADE_MS });
      },
    }),
    [progress, fade],
  );
}

/** Rotates a chevron from pointing right (closed) to down (open), in step. */
export function useRevealChevron(progress: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${-90 + 90 * progress.value}deg` }] }));
}

export default function ExpandReveal({
  progress,
  fade,
  open,
  pullTop = 0,
  contentStyle,
  children,
}: {
  progress: SharedValue<number>;
  fade: SharedValue<number>;
  /** Only for accessibility: the animation is driven by `progress`. */
  open: boolean;
  /** Pulls the revealed content this many points closer to the row above it. */
  pullTop?: number;
  contentStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const height = useSharedValue(0);

  const clipStyle = useAnimatedStyle(() => ({
    height: height.value * progress.value,
    marginTop: -pullTop * progress.value,
    opacity: fade.value,
  }));

  const onLayout = (e: LayoutChangeEvent) => { height.value = e.nativeEvent.layout.height; };

  return (
    // Hidden from VoiceOver while closed: it's mounted, just clipped to 0.
    <Reanimated.View
      style={[styles.clip, clipStyle]}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      {/* Buttons inside stay mounted while closed, clipped to no height. A zero
          height leaves nothing to hit, but this makes it explicit. */}
      <View
        style={[styles.content, contentStyle]}
        onLayout={onLayout}
        pointerEvents={open ? "auto" : "none"}
      >
        {children}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  clip:    { overflow: "hidden" },
  // Absolute so the content's natural height is its own, not the clip's.
  content: { position: "absolute", top: 0, left: 0, right: 0 },
});
