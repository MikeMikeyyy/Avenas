// constants/floatingBars.ts
//
// The bars that float at the foot of the screen during a workout, and how they
// stack. They're one family, the nav bar's: its surface, hairline edge and
// shadow (BAR_SHADOW), its side insets (BAR_INSET_X), pills of one height.
//
//  - The in-progress workout bar (components/WorkoutActiveBar.tsx) sits above
//    the tab bar on the other tabs (above the home indicator on a pushed
//    screen), never on the Workout tab.
//  - A rest between sets shows INSIDE it there: the bar grows upward by the
//    rest's section (REST_SECTION_H) to hold the countdown and its buttons, the
//    workout's row staying where it was, and shrinks back when the rest ends.
//    It was a second bar stacked on top, a card with a progress strip across its
//    top edge, which matched neither the pill under it nor the card's own
//    rounded corners, which cut the strip's ends to points.
//  - On the Workout tab, where there's no workout bar, a rest is a pill of its
//    own (components/RestTimerBanner.tsx), the workout bar's size, straight
//    above the tab bar, and the page's own pinned buttons stand on it.
//  - With the keyboard up, the rest pill rides above the keyboard's own tools:
//    the down key every text screen floats there (and the Workout page's ‹ ›
//    beside it for stepping between sets). On another page the workout bar
//    hands its rest to the pill while the keyboard is up, so Skip and ±15s stay
//    in reach above it.

import type { ViewStyle } from "react-native";

import { APP_DARK, APP_LIGHT } from "./theme";

/** How far above the screen's bottom edge a bar clears the tab bar. */
export const TAB_BAR_CLEARANCE = 112;

/** How far above the home indicator a bar sits on a screen with no tab bar. */
export const NO_TAB_BAR_GAP = 16;

/** Every bar's side inset: the nav bar's own. */
export const BAR_INSET_X = 20;

/** The workout bar's height (its 36pt buttons and 10pt padding), and so the
 *  rest pill's: the two are the same pill. */
export const WORKOUT_BAR_H = 56;
export const REST_PILL_H = WORKOUT_BAR_H;

/** What a rest adds to the top of the workout bar: its countdown row, and the
 *  hairline between that and the workout's row. */
export const REST_SECTION_H = 72;
export const REST_DIVIDER_H = 1;

/** The gap between two stacked bars. */
export const BAR_STACK_GAP = 8;

/** How far the workout bar drops to hide: clear of the screen at its tallest,
 *  a rest inside it. A shorter drop left it half on screen. */
export const BAR_HIDE_Y = TAB_BAR_CLEARANCE + WORKOUT_BAR_H + REST_SECTION_H + REST_DIVIDER_H + 24;

/** The nav bar's shadow, which every bar shares. */
export const BAR_SHADOW: ViewStyle = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
};

/** The quiet fill of a button on a bar (pause, discard, ±15s). */
export function barButtonFill(isDark: boolean): string {
  return isDark ? APP_DARK.ctrl : APP_LIGHT.bg;
}

/** How far above the keyboard its tools float, and how tall they are. */
export const KEYBOARD_TOOLS_GAP = 8;
export const KEYBOARD_TOOLS_H = 47;

/** Where a bar sits above an open keyboard: clear of its tools. */
export const ABOVE_KEYBOARD_TOOLS = KEYBOARD_TOOLS_GAP + KEYBOARD_TOOLS_H + BAR_STACK_GAP;

/** How far above the screen's bottom edge something stands on the rest pill
 *  on the Workout page, where the pill sits straight above the tab bar: the
 *  page's pinned buttons (focus mode's ‹ › and Complete Workout, list mode's
 *  notes and +) move up to here while a rest runs. */
export const ABOVE_REST_ON_TAB = TAB_BAR_CLEARANCE + REST_PILL_H + BAR_STACK_GAP;

/** The same with the keyboard up, measured from the keyboard's top: where the
 *  field being typed into and the session notes card end, clear of a rest
 *  pill riding there. */
export const ABOVE_REST_ON_KEYBOARD = ABOVE_KEYBOARD_TOOLS + REST_PILL_H + BAR_STACK_GAP;
