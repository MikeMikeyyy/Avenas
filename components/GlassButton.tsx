// A button that stays put over a page (back, close, a page's corner actions,
// the Workout page's top bar and its notes and +, the pills floating at a
// page's foot), drawn in Apple's Liquid Glass on iOS 26 and later, the same
// glass as the tab bar there (user request, 2026-10-22, after Bevel's buttons).
// Below 26 and on Android it's the solid control it always was: `t.ctrl`, or
// its tint, bouncing under a press.
//
// The glass is interactive: iOS swells and lights it under a finger, as it
// does the tab bar, so it takes no bounce of its own. `tint` is coloured glass,
// Apple's own treatment for a primary button (the tick in its sheets): the
// accent green for an add or a save, the slate for the app's other primary,
// the words on it as before. It follows the app's Dark Mode switch, never the
// phone's.
//
// iOS draws glass from whatever is behind it, and draws it wrongly under any
// opacity below 1 on the glass or on anything above it. So a glass button
// never dims as a whole: no activeOpacity, and `disabled` and
// `needsConnection` (BounceButton's, which fades the button) fade what's on
// it instead. FadeScreen fades a page in under a cover rather than by the
// page's own opacity for the same reason. Nor does the glass take a background
// or a shadow, which would sit under it and show through: `solidStyle` (a
// shadow, a glow) styles the solid button only.
//
// The glass is iOS's alone, as the tab bar's is (user request, 2026-10-30:
// ours didn't look like the tab bar or Apple's own buttons). Its shape is the
// style's borderRadius, which expo-glass-effect hands to the glass itself
// (UIKit's cornerConfiguration), so iOS draws its own edge highlight and
// shadow round that shape. Never paint over it: a rim, inner shading and a
// drop shadow of our own (added 2026-10-23 for more depth) read as a plastic
// outline on top of the real edge. Never clip it either (`overflow: hidden`):
// under a finger the interactive glass swells past its edge and lights where
// it's touched, and a clip cut both off at the button's own outline.
//
// Chrome buttons were glass once before and went solid on 2026-09-02: they drew
// as almost nothing over a flat page (expo-glass-effect 0.1 on SDK 54, before
// the app's own light/dark could be passed in).

import type { ReactNode } from "react";
import {
  Pressable, StyleSheet, View,
  type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle,
} from "react-native";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";

import BounceButton from "./BounceButton";
import { APP_DARK, APP_LIGHT } from "../constants/theme";
import { PILL_H_XS } from "../constants/buttons";
import { alertOffline, useOffline } from "../contexts/ConnectivityContext";
import { useTheme } from "../contexts/ThemeContext";

/** Whether this phone draws Liquid Glass: iOS 26 and later, with the API there
 *  (some iOS 26 betas shipped without it). Fixed for the life of the app. */
export const GLASS = isGlassEffectAPIAvailable();

/** How far what's on a button fades while it can't be used, as BounceButton's
 *  offline fade. */
const DIM_OPACITY = 0.4;

/** The surface alone: inside GlassButton, and for a control that only shows
 *  something (the Workout page's running clock, the timer's mode switch). */
export function GlassSurface({ tint, interactive = false, style, solidStyle, children }: {
  /** Coloured glass, and the solid surface's fill. */
  tint?: string;
  /** Swells and lights under a finger. Only a button's. */
  interactive?: boolean;
  /** Shape and layout (size, radius, padding, the row inside), never a fill. */
  style?: StyleProp<ViewStyle>;
  /** The solid surface's extras: a shadow, a glow, another fill. */
  solidStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { isDark } = useTheme();
  if (GLASS) {
    // iOS's glass and nothing else: its shape is the style's borderRadius,
    // which the glass takes natively (cornerConfiguration), not a clip.
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint}
        colorScheme={isDark ? "dark" : "light"}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  const fill = tint ?? (isDark ? APP_DARK : APP_LIGHT).ctrl;
  return <View style={[style, { backgroundColor: fill }, solidStyle]}>{children}</View>;
}

export default function GlassButton({
  onPress, tint, pill = false, size = PILL_H_XS, disabled = false, needsConnection = false,
  style, contentStyle, solidStyle, badge, children,
  accessibilityLabel, accessibilityRole = "button", accessibilityState,
}: {
  onPress: () => void;
  tint?: string;
  /** Sizes to what's inside, `size` tall (Start), rather than a `size` circle. */
  pill?: boolean;
  size?: number;
  /** Faded and inert (the builder's Next before the program has a name). */
  disabled?: boolean;
  /** The action needs the server: offline, it fades and a tap says so (as
   *  BounceButton's). */
  needsConnection?: boolean;
  /** Where the button sits: absolute placement, margins, a flex share. */
  style?: StyleProp<ViewStyle>;
  /** Lays out what's on it: a pill's padding, the row's gap, a minimum width. */
  contentStyle?: StyleProp<ViewStyle>;
  /** The solid button's extras: a shadow, a glow. */
  solidStyle?: StyleProp<ViewStyle>;
  /** Drawn over the button's corner, outside the glass (the notes button's +,
   *  a count waiting). */
  badge?: ReactNode;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
}) {
  const offline = useOffline();
  const blocked = needsConnection && offline;
  const shape = pill
    ? { height: size, borderRadius: size / 2 }
    : { width: size, height: size, borderRadius: size / 2 };
  const content = pill ? styles.pillContent : styles.circleContent;

  if (!GLASS) {
    return (
      <BounceButton
        onPress={disabled ? undefined : onPress}
        style={style}
        needsConnection={needsConnection}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={disabled ? { ...accessibilityState, disabled: true } : accessibilityState}
      >
        <GlassSurface tint={tint} style={shape} solidStyle={[solidStyle, disabled && styles.dim]}>
          <View style={[content, contentStyle]}>{children}</View>
        </GlassSurface>
        {badge}
      </BounceButton>
    );
  }

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (blocked) { alertOffline(); return; }
        onPress();
      }}
      disabled={disabled}
      style={style}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={disabled || blocked ? { ...accessibilityState, disabled: true } : accessibilityState}
      accessibilityHint={blocked ? "Needs a connection" : undefined}
    >
      <GlassSurface tint={tint} interactive={!disabled} style={shape}>
        <View style={[content, contentStyle, (disabled || blocked) && styles.dim]}>{children}</View>
      </GlassSurface>
      {badge}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circleContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  pillContent: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dim: { opacity: DIM_OPACITY },
});
