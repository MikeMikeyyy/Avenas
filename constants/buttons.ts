// Canonical action-button geometry.
//
// Every full-width / paired action button in the app is a PILL: fully rounded
// ends, a minimum height rather than vertical padding, and a soft drop shadow
// instead of the offset neumorphic one the app used to use. The top bar's
// timer pill and round icon buttons were already drawn this way; these tokens
// are that same shape, published so the rest of the app can stop re-deriving it
// with a slightly different radius on every screen (they ranged 10–16).
//
// Colours are NOT here — they stay in constants/theme.ts. This file is shape.
//
// Usage in a StyleSheet entry:
//   saveBtn: { ...pill(), backgroundColor: ACCT, ...pillGlow(ACCT) }
//   cancelBtn: { ...pill(PILL_H_SM) }

import type { ViewStyle } from "react-native";

/** Big enough that the ends stay fully round at any height React Native gives
 *  the view — it clamps to half the shorter side. Deliberately not `height / 2`:
 *  a label that wraps to two lines would otherwise lose its pill ends. */
export const PILL_RADIUS = 999;

/** Primary, full-width call to action (Complete Workout, Start Workout). */
export const PILL_H = 48;
/** Secondary or paired actions sitting side by side (Edit / Discard). */
export const PILL_H_SM = 44;
/** Compact inline controls — matches the workout top bar's 40pt controls. */
export const PILL_H_XS = 40;
/** The smallest pill: a control tucked into a card's header beside its title
 *  (the Progress charts' dropdown buttons). */
export const PILL_H_CHIP = 34;

/** Pill geometry: rounded ends, centred row content, no vertical padding. */
export function pill(minHeight: number = PILL_H): ViewStyle {
  return {
    minHeight,
    borderRadius: PILL_RADIUS,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  };
}

/** The soft neutral lift used by white / grey pills. Same values as the
 *  workout screen's timer pill, so the two read as one control family. */
export const PILL_SHADOW: ViewStyle = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 4,
};

/**
 * A CENTRED halo rather than a drop shadow — the colour bleeding evenly on all
 * sides instead of downward. This is the treatment destructive buttons use (the
 * round remove-set button in a workout card), and it reads as "this is hot"
 * where pillGlow's downward bleed just reads as raised.
 */
export function haloGlow(color: string, opacity = 0.5, radius = 6): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: radius,
  };
}

/** A coloured glow under a filled pill — the accent bleeding downward, which
 *  is what makes a primary button read as raised without a hard offset. */
export function pillGlow(color: string, opacity = 0.35): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: opacity,
    shadowRadius: 10,
  };
}
