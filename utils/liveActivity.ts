// utils/liveActivity.ts
//
// Pure builders for the workout Live Activity payload. No React, no native
// imports — the native bridge lives in modules/avenas-live-activity, the
// lifecycle glue in hooks/useWorkoutLiveActivity.
//
// The queue mirrors the Workout screen's semantics exactly:
//   - It runs in the order the session will get to its sets (utils/nextSet.ts),
//     so its head is the set the Workout screen glows on: after the set ticked
//     last, or back on a set unticked since, with skipped sets at the end, so
//     an untick in the app takes the card back too. Within an exercise it's the flat
//     warmup→working order ExerciseCard renders.
//   - Each entry's weight/reps are what the card shows for the set: values the
//     user already typed win; a fully empty set falls back to the
//     previous-session hint ("80×8", display units, indexed by flat position —
//     the same `prevSets[flatIdx]` lookup the in-app prev column uses), which
//     is what the lock-screen tick then fills in (prevFillFor, the rule the
//     in-app checkbox follows: the screen applies it as it replays the tick).

import type {
  LiveActivityPayload,
  LiveActivityPendingSet,
} from "../modules/avenas-live-activity";
import { pendingSetsInOrder } from "./nextSet";
import { flatIndexOf, prevFillFor } from "./setRows";

type LiveSet = { weight: string; reps: string; done: boolean; doneAt?: number; untickedAt?: number };
type LiveExerciseLog = { warmup: LiveSet[]; working: LiveSet[] };
export type LiveActivityExercise = { id: string; name: string; restSeconds?: number; isHold?: boolean };

// App-group defaults hold the whole queue; cap it so a monster session can't
// bloat the shared store. Ticking past the cap just re-syncs on next foreground.
const MAX_QUEUE = 50;

/** The card's weight×reps for one set: typed values, else what a tick will fill in. */
function previewValues(set: LiveSet, prevHint: string | undefined): { weight: string; reps: string } {
  return prevFillFor(set, prevHint) ?? { weight: set.weight, reps: set.reps };
}

/**
 * `prevHintsFor` is asked by the session exercise's id, not its name: a day
 * can list the same exercise twice, and each has its own previous sets
 * (utils/workout.ts buildPrevSetsLookup).
 */
export function buildLiveActivityQueue(
  exercises: LiveActivityExercise[],
  log: Record<string, LiveExerciseLog | undefined>,
  prevHintsFor: (exerciseId: string) => string[],
): { queue: LiveActivityPendingSet[]; doneCount: number; totalCount: number } {
  let doneCount = 0;
  let totalCount = 0;
  for (const ex of exercises) {
    const exLog = log[ex.id];
    if (!exLog) continue;
    for (const set of [...exLog.warmup, ...exLog.working]) {
      totalCount += 1;
      if (set.done) doneCount += 1;
    }
  }

  // Each exercise's sets, done or not, as they'll stand when each queued set
  // comes up (the card's dots, its warmups' orange and its working sets'
  // green): the lock screen ticks the queue in order, so every set ahead of
  // one is done by the time it's next.
  const workingDone = new Map<string, boolean[]>();
  const warmupsDone = new Map<string, boolean[]>();
  for (const ex of exercises) {
    const exLog = log[ex.id];
    if (!exLog) continue;
    workingDone.set(ex.id, exLog.working.map(s => s.done));
    warmupsDone.set(ex.id, exLog.warmup.map(s => s.done));
  }

  const queue: LiveActivityPendingSet[] = pendingSetsInOrder(exercises.map(e => e.id), log).flatMap(p => {
    const ex = exercises[p.exIndex];
    const exLog = log[p.exId];
    const set = exLog?.[p.setType][p.setIdx];
    if (!exLog || !set) return [];
    const { weight, reps } = previewValues(set, prevHintsFor(p.exId)[p.flatIdx]);
    const done = workingDone.get(p.exId) ?? [];
    const warmed = warmupsDone.get(p.exId) ?? [];
    const setDone = [...done];
    const warmupDone = [...warmed];
    if (p.setType === "working") done[p.setIdx] = true;
    else warmed[p.setIdx] = true;
    return [{
      exId: p.exId,
      setType: p.setType,
      setIdx: p.setIdx,
      exerciseName: ex.name,
      setLabel:
        p.setType === "warmup"
          ? `Warmup ${p.setIdx + 1}`
          : `Set ${p.setIdx + 1} of ${exLog.working.length}`,
      weight,
      reps,
      restSeconds: ex.restSeconds ?? 0,
      isFinal: false, // patched below once the full queue is known
      isHold: !!ex.isHold,
      setDone,
      warmupDone,
    }];
  });

  if (queue.length > 0) {
    queue[queue.length - 1].isFinal = true;
  }
  return { queue: queue.slice(0, MAX_QUEUE), doneCount, totalCount };
}

/** A lock-screen tick to replay: which set, and when it was ticked (epoch ms). */
export type LockScreenTick = { exId: string; setType: "warmup" | "working"; setIdx: number; ts: number };

/**
 * The session's log with the lock-screen ticks replayed into it, each doing
 * what the card's checkbox does: an empty set takes last time's numbers at its
 * row (prevFillFor, from the screen's own previous-set hints, which is what the
 * lock screen showed on it), anything typed before locking stays, and it's
 * stamped with when it was ticked there so the set ticked last stays right
 * (and an untick it had is cleared, as a tick in the app clears it). A set
 * already ticked, or no longer there, is left alone. It used to come back
 * ticked but empty (user report, 2026-10-05).
 */
export function logWithLockScreenTicks<
  S extends LiveSet,
  X extends { warmup: S[]; working: S[] },
>(
  log: Record<string, X>,
  ticks: readonly LockScreenTick[],
  prevHintsFor: (exerciseId: string) => readonly string[] | undefined,
): Record<string, X> {
  let next = log;
  for (const t of ticks) {
    const exLog = next[t.exId];
    const sets = exLog?.[t.setType];
    const set = sets?.[t.setIdx];
    if (!exLog || !sets || !set || set.done) continue;
    const updated = [...sets];
    const prevHint = prevHintsFor(t.exId)?.[flatIndexOf(exLog.warmup.length, t.setType, t.setIdx)];
    updated[t.setIdx] = { ...set, ...prevFillFor(set, prevHint), done: true, doneAt: t.ts, untickedAt: undefined };
    next = { ...next, [t.exId]: { ...exLog, [t.setType]: updated } };
  }
  return next;
}

/**
 * What a read of the lock-screen card's rest means for the Workout screen's
 * rest timer: an end to run to (a rest started or re-timed on the card), 0 to
 * dismiss it (Skip on the card), or null to leave it be.
 *
 * Only a change made ON the card counts. Otherwise the card's rest just echoes
 * what the screen last gave it (`lastPushedEnd`), and a push lags the screen by
 * its debounce: read back in that moment, the card's old end restarted a rest
 * just skipped in the app, or dismissed one just started. Before the session's
 * first push (`lastPushedEnd` null), only a rest still running counts: one left
 * on the card when the app was killed. Then idempotent: ends within 1.5s of
 * each other, past ends counting as none, are left alone, or every foreground
 * would reset the banner's progress bar.
 */
export function restFromCard(args: {
  /** The card's rest end (epoch ms), 0 when none. */
  cardEnd: number;
  /** The rest end the card was last given, null before the first push. */
  lastPushedEnd: number | null;
  /** The screen's rest end, null when no rest is running. */
  appEnd: number | null;
  now: number;
}): number | null {
  const { cardEnd, lastPushedEnd, appEnd, now } = args;
  if (lastPushedEnd !== null ? cardEnd === lastPushedEnd : cardEnd <= now + 1000) return null;
  const card = cardEnd > now + 1000 ? cardEnd : 0;
  const app = appEnd != null && appEnd > now + 1000 ? appEnd : 0;
  return Math.abs(card - app) > 1500 ? card : null;
}

/** The timers a push waits on: the real ones, or a test's. */
export type PushTimers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

const REAL_TIMERS: PushTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** What the lock-screen card is sent, and when (hooks/useWorkoutLiveActivity). */
export type CardPushes = {
  /** The payload as it stands: sent once it has held still for the wait,
   *  unless the card already has it. A later change replaces one waiting. */
  change(json: string): void;
  /** Send a change still waiting, now. */
  flush(): void;
  /** Drop a change still waiting. */
  cancel(): void;
  /** Drop it, and forget what the card has: the card is gone. */
  reset(): void;
  /** Whether the card has been sent anything since it was put up. */
  sent(): boolean;
  /** The payload last sent that has reached the card (its push resolved), or
   *  null before one has: what the card's rest mirror echoes (restFromCard). */
  landed(): string | null;
};

/**
 * The card's pushes. A change waits `waitMs` so typing a weight goes as one
 * update (iOS limits how often a card updates), and `flush` sends one still
 * waiting at once: the screen does when the app leaves the foreground. iOS
 * suspends the app soon after the phone locks or another app opens, and a JS
 * timer doesn't fire while it's suspended, so the card kept the session as it
 * was before the last change: a warm-up taken away stayed among its dots
 * (user report, 2026-10-28). While the app is open the card isn't on screen,
 * so it only has to be right by the time the app goes.
 */
export function cardPushes(
  send: (json: string) => Promise<unknown> | void,
  waitMs: number,
  timers: PushTimers = REAL_TIMERS,
): CardPushes {
  let last: string | null = null;
  let arrived: string | null = null;
  // Bumped when the card goes, so a push to the old one landing late isn't
  // taken for the new card's.
  let card = 0;
  let waiting: { json: string; id: unknown } | null = null;
  const cancel = () => {
    if (waiting) timers.clear(waiting.id);
    waiting = null;
  };
  const go = (json: string) => {
    waiting = null;
    last = json;
    const sentTo = card;
    const land = () => { if (sentTo === card) arrived = json; };
    const pushed = send(json);
    if (pushed) void pushed.then(land);
    else land();
  };
  return {
    change(json) {
      cancel();
      if (json === last) return;
      const id = timers.set(() => go(json), waitMs);
      waiting = { json, id };
    },
    flush() {
      const w = waiting;
      if (!w) return;
      timers.clear(w.id);
      go(w.json);
    },
    cancel,
    reset() {
      cancel();
      last = null;
      arrived = null;
      card += 1;
    },
    sent: () => last !== null,
    landed: () => arrived,
  };
}

export function buildLiveActivityPayload(args: {
  workoutName: string;
  exercises: LiveActivityExercise[];
  log: Record<string, LiveExerciseLog | undefined>;
  /** Previous-set hints for a session exercise, by its id. */
  prevHintsFor: (exerciseId: string) => string[];
  isKg: boolean;
  /** The app's Dark Mode, which the card follows. */
  isDark: boolean;
  /** Effective timer start (epoch ms) while running, null when stopped/paused. */
  timerStartMs: number | null;
  /** Elapsed seconds to show frozen while paused (0 when running/stopped). */
  pausedElapsedSec: number;
  /** Rest-timer end (epoch ms) or null when no rest is running. */
  restEndsAt: number | null;
  /** The rest's original length in seconds (drives the card's progress bar). */
  restTotalSec: number;
}): LiveActivityPayload {
  const { queue, doneCount, totalCount } = buildLiveActivityQueue(
    args.exercises,
    args.log,
    args.prevHintsFor,
  );
  const now = Date.now();
  const resting = args.restEndsAt != null && args.restEndsAt > now;
  const restEndMs = resting ? args.restEndsAt! : 0;
  const restStartMs = resting
    ? Math.min(restEndMs - 1000, restEndMs - args.restTotalSec * 1000)
    : 0;
  return {
    workoutName: args.workoutName,
    unit: args.isKg ? "kg" : "lbs",
    isDark: args.isDark,
    startedAtMs: args.timerStartMs ?? 0,
    pausedElapsedSec: args.pausedElapsedSec,
    restStartMs,
    restEndMs,
    doneCount,
    totalCount,
    queue,
  };
}
