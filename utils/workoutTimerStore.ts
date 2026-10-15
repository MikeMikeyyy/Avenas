// utils/workoutTimerStore.ts
//
// Where the timer's state lives between screens (utils/workoutTimer.ts has the
// rules): your own countdown and the stopwatch, which keep going with the
// timer closed and across the Workout tab's two layouts (a rest day and a
// session draw it from different places), and the set the session is up to,
// which the Workout tab publishes for the workout bar's "Up next" line on the
// other pages. Module memory, like the Progress page's selections: an app
// restart starts them fresh, as it always did.
//
// No React here: hooks/useWorkoutTimerStore.ts subscribes to it.

import {
  newCountdown,
  newStopwatch,
  sameUpNext,
  type Countdown,
  type Stopwatch,
  type TimerMode,
  type UpNext,
} from "./workoutTimer";

export type TimerStoreState = { mode: TimerMode; countdown: Countdown; stopwatch: Stopwatch };

let timer: TimerStoreState = { mode: "timer", countdown: newCountdown(), stopwatch: newStopwatch() };
const timerListeners = new Set<() => void>();

export function getTimerState(): TimerStoreState {
  return timer;
}

/** Change it; listeners hear only a real change. */
export function updateTimerState(change: (s: TimerStoreState) => TimerStoreState): void {
  const next = change(timer);
  if (next === timer) return;
  timer = next;
  timerListeners.forEach(l => l());
}

export function subscribeTimerState(listener: () => void): () => void {
  timerListeners.add(listener);
  return () => { timerListeners.delete(listener); };
}

let upNext: UpNext | null = null;
const upNextListeners = new Set<() => void>();

export function getUpNext(): UpNext | null {
  return upNext;
}

/** The set the session is up to, or null with no session. Listeners hear only
 *  a change in what it reads. */
export function publishUpNext(next: UpNext | null): void {
  if (sameUpNext(upNext, next)) return;
  upNext = next;
  upNextListeners.forEach(l => l());
}

export function subscribeUpNext(listener: () => void): () => void {
  upNextListeners.add(listener);
  return () => { upNextListeners.delete(listener); };
}
