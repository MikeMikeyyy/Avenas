// hooks/useOpenWorkoutTimer.ts
//
// A tap on a rest (the pop-up on the Workout page, the workout bar's rest on
// every other page) opens the Workout tab's timer on it
// (components/WorkoutTimerScreen.tsx). The timer belongs to the Workout tab,
// which holds the session a tick acts on, so this goes there with a fresh
// `timer` on every tap, as the workout bar's `upTo` does; from a screen pushed
// over the tabs, dismissTo pops back to them rather than push a second copy.

import { useCallback } from "react";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useFloatingBars } from "./useFloatingBars";

export function useOpenWorkoutTimer(): () => void {
  const router = useRouter();
  const { onTabScreen } = useFloatingBars();
  return useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const href = { pathname: "/(tabs)/workout", params: { timer: String(Date.now()) } } as const;
    if (onTabScreen) router.navigate(href);
    else router.dismissTo(href);
  }, [router, onTabScreen]);
}
