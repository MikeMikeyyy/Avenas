// hooks/useWorkoutTimerStore.ts
//
// React's view of utils/workoutTimerStore.ts.

import { useSyncExternalStore } from "react";
import { getTimerState, getUpNext, subscribeTimerState, subscribeUpNext } from "../utils/workoutTimerStore";

/** Your own countdown, the stopwatch and which of them the timer is on. */
export function useTimerState() {
  return useSyncExternalStore(subscribeTimerState, getTimerState);
}

/** The set the session is up to, as the Workout tab last published it. */
export function useUpNext() {
  return useSyncExternalStore(subscribeUpNext, getUpNext);
}
