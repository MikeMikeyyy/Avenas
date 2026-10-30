// hooks/useFloatingBars.ts
//
// Where the workout bar and the rest timer sit right now (see
// constants/floatingBars.ts), so the two can't disagree about it.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard, Platform } from "react-native";
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { BAR_RISE, BAR_SETTLE_MS, BAR_STACK_GAP, NO_TAB_BAR_GAP, WORKOUT_BAR_H } from "../constants/floatingBars";
import { useTabBar } from "./useTabBar";

/** Whether the keyboard is up, from the moment it starts to rise. */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setUp(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return up;
}

export function useFloatingBars() {
  const { isRunning, isPaused } = useWorkoutTimer();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardUp();
  const tabBar = useTabBar();

  const onTabScreen = segments.includes("(tabs)" as never);
  const onWorkoutTab = segments[segments.length - 1] === "workout";
  /** A chat, 1:1 (trainer/chat/[id]) or a group's (trainer/group/[id]/chat),
   *  or the Messages page that lists them (trainer/messages): both bars stand
   *  aside there, since they sat over the message box and the conversations.
   *  The workout and any rest carry on, and show again on leaving. */
  const onChatScreen = segments.includes("chat" as never) || segments.includes("messages" as never);
  /** A workout under way, seen from anywhere but the Workout page itself. */
  const workoutBarShown = (isRunning || isPaused) && !onWorkoutTab && !onChatScreen;
  /** A rest shows inside the workout bar wherever that shows, except while
   *  the keyboard is up, when the rest pill carries it above the keyboard. */
  const restInBar = workoutBarShown && !keyboardUp;
  /** Where the lowest bar sits: above the tab bar, or the home indicator. */
  const base = onTabScreen ? tabBar.clearance : insets.bottom + NO_TAB_BAR_GAP;

  return {
    onTabScreen,
    workoutBarShown,
    restInBar,
    /** Whether a rest shows as its own pill here: not inside the workout bar,
     *  and not on a chat. */
    restPillShown: !onChatScreen && !restInBar,
    /** The workout bar's bottom. */
    workoutBarBottom: base,
    /** How far the workout bar drops to hide. */
    workoutBarHideY: tabBar.hideY,
    /** The rest pill's bottom with the keyboard down: on top of the workout
     *  bar while that shows (beside it, the pill only shows as the keyboard
     *  rises, and starts from there), else where the bar would sit. */
    restBottom: base + (workoutBarShown ? WORKOUT_BAR_H + BAR_STACK_GAP : 0),
  };
}

// ─── How far up the bars reach, for the pages under them ─────────────────────
// The workout bar reports it (components/WorkoutActiveBar.tsx) and a page reads
// one number, which changes only when the bars do. Reading the bars themselves
// (useFloatingBars) would re-render a page every second with the workout clock.

let barsReach = 0;
const reachListeners = new Set<() => void>();

/** The workout bar's report of how far up the screen it reaches
 *  (workoutBarReach), 0 while it's hidden. */
export function reportBarsReach(next: number): void {
  if (next === barsReach) return;
  barsReach = next;
  reachListeners.forEach((listener) => listener());
}

function subscribeReach(listener: () => void): () => void {
  reachListeners.add(listener);
  return () => {
    reachListeners.delete(listener);
  };
}

function readReach(): number {
  return barsReach;
}

/** How far above the screen's bottom edge the floating bars reach right now,
 *  0 while none shows: a page's end padding takes it through
 *  scrollEndPadding (constants/floatingBars.ts). */
export function useFloatingBarsReach(): number {
  return useSyncExternalStore(subscribeReach, readReach);
}

// ─── Buttons pinned to a page's foot ─────────────────────────────────────────

/**
 * Buttons pinned to a page's foot stand on the workout bar while it shows,
 * BAR_STACK_GAP above its top edge, rising and settling with it as it comes
 * and goes and as a rest opens and closes inside it, as the Workout tab's
 * stand on a rest (user pick, 2026-10-30: under it they couldn't be pressed
 * for as long as a workout ran). `ownBottom` is where the lowest of them sits
 * without it; `liftStyle` moves every one of them by the same amount, so a
 * stack keeps its shape. `lift` goes on the page's end padding too, so its
 * last row still scrolls clear of them.
 */
export function usePinnedLift(ownBottom: number) {
  const reach = useFloatingBarsReach();
  const lift = reach > 0 ? Math.max(0, reach + BAR_STACK_GAP - ownBottom) : 0;
  const shown = useSharedValue(lift);
  const last = useRef(lift);
  useEffect(() => {
    // Up on the bar's own spring, back down as it gives a rest's room back.
    shown.value = lift > last.current
      ? withSpring(lift, BAR_RISE)
      : withTiming(lift, { duration: BAR_SETTLE_MS });
    last.current = lift;
  }, [lift, shown]);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -shown.value }] }));
  return { lift, liftStyle };
}
