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

import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SET_INPUT_DARK, SET_INPUT_RING_DARK } from "./theme";

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

/** A button inside a card (user pick, 2026-10-29, option D of the Buttons on
 *  Cards canvas, app-wide the same day): the theme's `cardCtrl`
 *  fill, a hairline in its divider colour, and no shadow. The white control
 *  pill (`ctrl` + PILL_SHADOW) stays for buttons on the page and in sheets,
 *  where the page colour around it sets it off; on Porcelain's white cards it
 *  was the card's own white, and only its faint shadow showed. The hairline is
 *  part of the button's size: one with a set height keeps it, and one sized by
 *  its padding takes CARD_BUTTON_BORDER off that padding to keep its size. */
export const CARD_BUTTON_BORDER = 1;

export function cardButton(t: { cardCtrl: string; div: string }): ViewStyle {
  return { backgroundColor: t.cardCtrl, borderWidth: CARD_BUTTON_BORDER, borderColor: t.div };
}

/** A set's weight and reps boxes, on every page that has them: the Workout
 *  tab, a logged workout, Log Workout and the program builder's targets. On
 *  light, the card's button look (cardButton), so the boxes and the buttons
 *  round them read as one family; in the page colour they read a bit off on
 *  the white card (user requests, 2026-10-29: the Workout tab's first, then
 *  the rest to match it). On dark, a step above the card, ringed in white.
 *  Its colours are theme.ts's. */
export function setInputSurface(t: { cardCtrl: string; div: string }, isDark: boolean): ViewStyle {
  return isDark
    ? { backgroundColor: SET_INPUT_DARK, borderWidth: CARD_BUTTON_BORDER, borderColor: SET_INPUT_RING_DARK }
    : cardButton(t);
}

/** A button's coloured glow on dark mode, as a share of its light-mode
 *  strength. A glow blooms far brighter on Graphite's near-black page than on
 *  a light one (user report, 2026-10-28: "a little too bright and glowy" on
 *  dark), so every button glow is laid on at this share there. One number:
 *  raise it for more glow on dark, lower it for less. */
export const DARK_GLOW_SCALE = 0.6;

/** A glow's shadowOpacity for the theme: `opacity` on light, DARK_GLOW_SCALE
 *  of it on dark. For a button glow written out by hand. */
export function glowOpacity(opacity: number, isDark: boolean): number {
  return isDark ? opacity * DARK_GLOW_SCALE : opacity;
}

/** The dark-mode strength of the glow in a stylesheet entry, laid after it:
 *  `[styles.saveBtn, darkGlow(styles.saveBtn, isDark)]`. Its shadowOpacity at
 *  DARK_GLOW_SCALE; null on light, so nothing changes there. */
export function darkGlow(style: StyleProp<ViewStyle>, isDark: boolean): ViewStyle | null {
  if (!isDark) return null;
  const opacity = StyleSheet.flatten(style)?.shadowOpacity;
  return typeof opacity === "number" ? { shadowOpacity: opacity * DARK_GLOW_SCALE } : null;
}

/**
 * A CENTRED halo rather than a drop shadow — the colour bleeding evenly on all
 * sides instead of downward. This is the treatment destructive buttons use (the
 * round remove-set button in a workout card), and it reads as "this is hot"
 * where pillGlow's downward bleed just reads as raised. Pass `isDark` where
 * it's drawn inline, so dark mode lays it on softer (DARK_GLOW_SCALE).
 */
export function haloGlow(color: string, opacity = 0.5, radius = 6, isDark = false): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: glowOpacity(opacity, isDark),
    shadowRadius: radius,
  };
}

/** A coloured glow under a filled pill — the accent bleeding downward, which
 *  is what makes a primary button read as raised without a hard offset. Pass
 *  `isDark` where it's drawn inline, so dark mode lays it on softer. */
export function pillGlow(color: string, opacity = 0.35, isDark = false): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: glowOpacity(opacity, isDark),
    shadowRadius: 10,
  };
}
