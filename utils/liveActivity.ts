// utils/liveActivity.ts
//
// Pure builders for the workout Live Activity payload. No React, no native
// imports — the native bridge lives in modules/avenas-live-activity, the
// lifecycle glue in hooks/useWorkoutLiveActivity.
//
// The queue mirrors the Workout screen's semantics exactly:
//   - It runs in the order the session will get to its sets (utils/nextSet.ts),
//     so its head is the set the Workout screen glows on: after the set ticked
//     last, with skipped sets at the end. Within an exercise it's the flat
//     warmup→working order ExerciseCard renders.
//   - Each entry's weight/reps are a display-only preview for the card: values
//     the user already typed win; a fully empty set falls back to the
//     previous-session hint ("80×8", display units, indexed by flat position —
//     the same `prevSets[flatIdx]` lookup the in-app prev column uses). The
//     lock-screen tick does NOT commit these numbers — it only marks the set
//     done; the user types the real values after unlocking.

import type {
  LiveActivityPayload,
  LiveActivityPendingSet,
} from "../modules/avenas-live-activity";
import { pendingSetsInOrder } from "./nextSet";

type LiveSet = { weight: string; reps: string; done: boolean; doneAt?: number };
type LiveExerciseLog = { warmup: LiveSet[]; working: LiveSet[] };
export type LiveActivityExercise = { id: string; name: string; restSeconds?: number };

// App-group defaults hold the whole queue; cap it so a monster session can't
// bloat the shared store. Ticking past the cap just re-syncs on next foreground.
const MAX_QUEUE = 50;

/** The card's weight×reps preview for one set (typed values, else prev hint). */
function previewValues(set: LiveSet, prevHint: string | undefined): { weight: string; reps: string } {
  if (!set.weight.trim() && !set.reps.trim() && prevHint && prevHint !== "—") {
    const parts = prevHint.split("×");
    return { weight: parts[0] ?? "", reps: parts[1] ?? "" };
  }
  return { weight: set.weight, reps: set.reps };
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

  const queue: LiveActivityPendingSet[] = pendingSetsInOrder(exercises.map(e => e.id), log).flatMap(p => {
    const ex = exercises[p.exIndex];
    const exLog = log[p.exId];
    const set = exLog?.[p.setType][p.setIdx];
    if (!exLog || !set) return [];
    const { weight, reps } = previewValues(set, prevHintsFor(p.exId)[p.flatIdx]);
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
    }];
  });

  if (queue.length > 0) {
    queue[queue.length - 1].isFinal = true;
  }
  return { queue: queue.slice(0, MAX_QUEUE), doneCount, totalCount };
}

export function buildLiveActivityPayload(args: {
  workoutName: string;
  exercises: LiveActivityExercise[];
  log: Record<string, LiveExerciseLog | undefined>;
  /** Previous-set hints for a session exercise, by its id. */
  prevHintsFor: (exerciseId: string) => string[];
  isKg: boolean;
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
    startedAtMs: args.timerStartMs ?? 0,
    pausedElapsedSec: args.pausedElapsedSec,
    restStartMs,
    restEndMs,
    doneCount,
    totalCount,
    queue,
  };
}
