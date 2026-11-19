// avenas-live-activity — JS API for the workout Live Activity (iOS 17+).
//
// Safe to import everywhere: in Expo Go, on Android, and on iOS < 17 every
// call silently no-ops (requireNativeModule throws where the native module
// isn't linked, and we swallow that once at load).
//
// The native side lives in ./ios (module) and targets/workout-widget (the
// widget extension that renders the card). See tasks/live-activity.md for the
// build story — this feature only runs in a dev/EAS build, never Expo Go.

import { Platform } from "react-native";

export type LiveActivitySetType = "warmup" | "working";

/** One not-yet-done set, in the order the session will get to them
 *  (utils/nextSet.ts). Head = the set the lock-screen tick marks done, the one
 *  the Workout screen glows on. `weight`/`reps` are display-unit preview
 *  strings for the card (typed values, else previous-session hint) — the tick
 *  does NOT write them into the log; the user enters real numbers after
 *  unlocking. */
export type LiveActivityPendingSet = {
  exId: string;
  setType: LiveActivitySetType;
  setIdx: number; // index within that type's array in the workout log
  exerciseName: string;
  setLabel: string; // "Set 2 of 4" / "Warmup 1"
  weight: string;
  reps: string;
  restSeconds: number; // rest started after ticking this set
  isFinal: boolean; // ticking this completes the workout → no rest
  isHold: boolean; // a timed hold: `reps` are seconds
  /** Its exercise's working sets, done or not, as they'll stand when this set
   *  is up (the card's dots). The lock screen ticks the queue in order, so
   *  every set ahead of it is done by then. */
  setDone: boolean[];
  /** ...and its warmups the same way, the orange dots before them. */
  warmupDone: boolean[];
};

export type LiveActivityPayload = {
  workoutName: string;
  unit: string; // "kg" | "lbs"
  /** The app's own Dark Mode (ThemeContext), which the card follows: a white
   *  card in light mode, the app's navy in dark. Never the phone's setting. */
  isDark: boolean;
  startedAtMs: number; // effective timer start (epoch ms); 0 = not running
  pausedElapsedSec: number; // shown frozen while startedAtMs === 0
  restStartMs: number; // 0 = no rest running
  restEndMs: number; // 0 = no rest running
  doneCount: number;
  totalCount: number;
  queue: LiveActivityPendingSet[];
};

/** A lock-screen tick awaiting replay into the workout draft. The replay only
 *  marks the set done — `weight`/`reps` echo the preview shown when the tick
 *  ran (informational; never written into the log). */
export type LiveActivityTickAction = {
  kind: "tick";
  exId: string;
  setType: LiveActivitySetType;
  setIdx: number;
  weight: string;
  reps: string;
  ts: number; // epoch ms when the intent ran
};

export type LiveActivityConsumeResult = {
  actions: LiveActivityTickAction[];
  /** Rest-end mirror (epoch ms; 0 = none) after any lock-screen skip/±15s. */
  restEndMs: number;
};

type NativeModule = {
  isAvailable(): boolean;
  startOrUpdate(payload: LiveActivityPayload): Promise<void>;
  end(): Promise<void>;
  consumeActions(): Promise<LiveActivityConsumeResult>;
  /** From the build with the lock screen's "Rest complete" (2026-11-14) on;
   *  absent in builds before it, so called only when there. */
  setRestAlerts?(on: boolean): void;
  cancelRestAlert?(): void;
};

let native: NativeModule | null = null;
if (Platform.OS === "ios") {
  try {
    // Throws in Expo Go (module not linked) — that's the availability check.
    const { requireNativeModule } = require("expo-modules-core");
    native = requireNativeModule("AvenasLiveActivity");
  } catch {
    native = null;
  }
}

const warn = (op: string, e: unknown) => {
  if (__DEV__) console.warn("[avenas] liveActivity", op, e);
};

/** False in Expo Go, on Android, on iOS < 17, and when the user disabled
 *  Live Activities for Avenas in iOS Settings. */
export function isLiveActivityAvailable(): boolean {
  try {
    return !!native?.isAvailable();
  } catch (e) {
    warn("isAvailable", e);
    return false;
  }
}

export async function startOrUpdateWorkoutActivity(payload: LiveActivityPayload): Promise<void> {
  if (!native) return;
  try {
    await native.startOrUpdate(payload);
  } catch (e) {
    warn("startOrUpdate", e);
  }
}

export async function endWorkoutActivity(): Promise<void> {
  if (!native) return;
  try {
    await native.end();
  } catch (e) {
    warn("end", e);
  }
}

export async function consumeLiveActivityActions(): Promise<LiveActivityConsumeResult> {
  if (!native) return { actions: [], restEndMs: 0 };
  try {
    return await native.consumeActions();
  } catch (e) {
    warn("consumeActions", e);
    return { actions: [], restEndMs: 0 };
  }
}

/** The app's Rest timer alerts setting (master and category), for the "Rest
 *  complete" a rest started on the lock screen gets natively (RestAlert in
 *  WorkoutActivitySupport.swift), where the app's own scheduling can't run. */
export function setLockScreenRestAlerts(on: boolean): void {
  if (typeof native?.setRestAlerts !== "function") return;
  try {
    native.setRestAlerts(on);
  } catch (e) {
    warn("setRestAlerts", e);
  }
}

/** Cancels the lock screen's pending "Rest complete": the app is scheduling
 *  its own, or dismissed the rest (utils/notificationScheduler.ts), so there
 *  is only ever one rest alert. */
export function cancelLockScreenRestAlert(): void {
  if (typeof native?.cancelRestAlert !== "function") return;
  try {
    native.cancelRestAlert();
  } catch (e) {
    warn("cancelRestAlert", e);
  }
}
