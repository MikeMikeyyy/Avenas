// constants/floatingBars.ts
//
// The bars that float at the foot of the screen during a workout, and how they
// stack: the in-progress workout bar (components/WorkoutActiveBar.tsx) sits
// above the tab bar on the other tabs (above the home indicator on a pushed
// screen), and the rest timer (components/RestTimerBanner.tsx) sits on top of
// it, or straight above the tab bar on the Workout tab, where there's no
// workout bar and the page's own pinned buttons stand on the rest timer while
// it shows. With the keyboard up, the rest timer rides above the keyboard's
// own tools: the down key every text screen floats there (and the Workout
// page's ‹ › beside it for stepping between sets).
//
// All of it in one place: the rest timer used to sit at the workout bar's
// height and push that bar up over itself, and a bar hidden off the bottom
// while a rest ran stayed half on screen.

/** How far above the screen's bottom edge a bar clears the tab bar. */
export const TAB_BAR_CLEARANCE = 112;

/** How far above the home indicator a bar sits on a screen with no tab bar. */
export const NO_TAB_BAR_GAP = 16;

/** The workout bar's height (its 36pt buttons and 10pt padding). */
export const WORKOUT_BAR_H = 56;

/** The rest timer's height (its 4pt progress bar and 60pt row). */
export const REST_BANNER_H = 64;

/** The gap between two stacked bars. */
export const BAR_STACK_GAP = 8;

/** How far above the keyboard its tools float, and how tall they are. */
export const KEYBOARD_TOOLS_GAP = 8;
export const KEYBOARD_TOOLS_H = 47;

/** Where a bar sits above an open keyboard: clear of its tools. */
export const ABOVE_KEYBOARD_TOOLS = KEYBOARD_TOOLS_GAP + KEYBOARD_TOOLS_H + BAR_STACK_GAP;

/** How far above the screen's bottom edge something stands on the rest timer
 *  on the Workout page, where the timer sits straight above the tab bar: the
 *  page's pinned buttons (focus mode's ‹ › and Complete Workout, list mode's
 *  notes and +) move up to here while a rest runs. */
export const ABOVE_REST_ON_TAB = TAB_BAR_CLEARANCE + REST_BANNER_H + BAR_STACK_GAP;

/** The same with the keyboard up, measured from the keyboard's top: where the
 *  field being typed into and the session notes card end, clear of a rest
 *  timer riding there. */
export const ABOVE_REST_ON_KEYBOARD = ABOVE_KEYBOARD_TOOLS + REST_BANNER_H + BAR_STACK_GAP;
