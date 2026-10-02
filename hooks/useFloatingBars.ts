// hooks/useFloatingBars.ts
//
// Where the workout bar and the rest timer sit right now (see
// constants/floatingBars.ts), so the two can't disagree about it.

import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { BAR_STACK_GAP, NO_TAB_BAR_GAP, TAB_BAR_CLEARANCE, WORKOUT_BAR_H } from "../constants/floatingBars";

export function useFloatingBars() {
  const { isRunning, isPaused } = useWorkoutTimer();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const onTabScreen = segments.includes("(tabs)" as never);
  const onWorkoutTab = segments[segments.length - 1] === "workout";
  /** A workout under way, seen from anywhere but the Workout page itself. */
  const workoutBarShown = (isRunning || isPaused) && !onWorkoutTab;
  /** Where the lowest bar sits: above the tab bar, or the home indicator. */
  const base = onTabScreen ? TAB_BAR_CLEARANCE : insets.bottom + NO_TAB_BAR_GAP;

  return {
    onTabScreen,
    workoutBarShown,
    /** The workout bar's bottom. */
    workoutBarBottom: base,
    /** The rest timer's bottom with the keyboard down: on top of the workout
     *  bar while it shows, else where it would sit. */
    restBottom: base + (workoutBarShown ? WORKOUT_BAR_H + BAR_STACK_GAP : 0),
  };
}
