// hooks/useFloatingBars.ts
//
// Where the workout bar and the rest timer sit right now (see
// constants/floatingBars.ts), so the two can't disagree about it.

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { BAR_STACK_GAP, NO_TAB_BAR_GAP, TAB_BAR_CLEARANCE, WORKOUT_BAR_H } from "../constants/floatingBars";

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
  const base = onTabScreen ? TAB_BAR_CLEARANCE : insets.bottom + NO_TAB_BAR_GAP;

  return {
    onTabScreen,
    workoutBarShown,
    restInBar,
    /** Whether a rest shows as its own pill here: not inside the workout bar,
     *  and not on a chat. */
    restPillShown: !onChatScreen && !restInBar,
    /** The workout bar's bottom. */
    workoutBarBottom: base,
    /** The rest pill's bottom with the keyboard down: on top of the workout
     *  bar while that shows (beside it, the pill only shows as the keyboard
     *  rises, and starts from there), else where the bar would sit. */
    restBottom: base + (workoutBarShown ? WORKOUT_BAR_H + BAR_STACK_GAP : 0),
  };
}
