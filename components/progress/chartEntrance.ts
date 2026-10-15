// components/progress/chartEntrance.ts
//
// How the Progress page's charts come in (user request, 2026-10-14): bars and
// blocks rise from the baseline the way the Volume card's bars always have
// (components/VolumeBarChart.tsx, 350ms), and a Strength line draws itself out
// left to right. On the UI thread, as a 0-to-1 value each chart's paths read;
// never under Reduce Motion, where a chart is simply there.

import { useEffect } from "react";
import {
  Easing, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue,
} from "react-native-reanimated";

/** The Volume card's bars' rise. */
export const RISE_MS = 350;
/** A line drawing itself out. */
export const DRAW_MS = 700;

export type ChartEntrance = "rise" | "draw";

/** Runs `p` from 0 to 1 the way `kind` comes in, `delay` after; straight to
 *  1 under Reduce Motion. */
export function playEntrance(p: SharedValue<number>, kind: ChartEntrance, delay = 0, reduceMotion = false): void {
  if (reduceMotion) {
    p.value = 1;
    return;
  }
  const run = kind === "rise"
    ? withTiming(1, { duration: RISE_MS })
    : withTiming(1, { duration: DRAW_MS, easing: Easing.inOut(Easing.cubic) });
  p.value = delay > 0 ? withDelay(delay, run) : run;
}

/**
 * A chart's entrance, 0 to 1, run once as it mounts. A chart that keys its
 * body on its tab (the exercise charts) comes in again on every tab, and one
 * that passes `replayKey` comes in again whenever it changes (a metric, other
 * data).
 */
export function useChartEntrance(kind: ChartEntrance, replayKey: string | number = 0): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      p.value = 1;
      return;
    }
    p.value = 0;
    playEntrance(p, kind);
  }, [kind, replayKey, reduceMotion, p]);
  return p;
}
