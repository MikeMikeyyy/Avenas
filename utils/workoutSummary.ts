// utils/workoutSummary.ts
//
// Post-workout completion summary derivations. Pure + RN-free.
//
// All weights are canonical KG (CompletedSet.weight is stored in kg) — display
// conversion is the caller's job via utils/units.ts.

import type { CompletedWorkout } from "../constants/programs";
import { collectExerciseHistory, computePRs } from "./progressStats";
import { exerciseIdentity } from "./exerciseNames";
import { isAssisted, liftBeats } from "./assisted";
import { sessionRepPrs } from "./repPrs";

export type SessionRecordKind = "heaviest" | "oneRepMax" | "bestSetVolume" | "reps";

export type SessionRecord = {
  exerciseName: string; // as logged (display casing)
  kind: SessionRecordKind;
  /** The new best, canonical kg (kg×reps for bestSetVolume). For a rep PR,
   *  the weight its reps were done at (0 for bodyweight). */
  valueKg: number;
  /** The beaten prior best; null = first time ever logged. A rep PR's is its
   *  own weight again: it's at a weight done before, never a first. */
  prevKg: number | null;
  /** bestSetVolume only: the set it was, which the summary shows as "90 kg
   *  × 8" rather than the product (canonical kg). */
  weightKg?: number;
  /** bestSetVolume and reps: the set's reps (for a rep PR on a hold, its
   *  seconds). */
  reps?: number;
  /** reps only: the most done before at that weight or better, which it beat
   *  (utils/repPrs.ts). */
  prevReps?: number;
  /** reps only: a timed hold, its reps seconds. */
  hold?: true;
  /** An assisted exercise (utils/assisted.ts): its "heaviest" is its LEAST
   *  assistance, which the summary calls so, and a rep PR's weight is help. */
  assisted?: true;
};

/** A rep PR's record (utils/repPrs.ts), with its numbers. */
export type RepRecord = SessionRecord & { kind: "reps"; reps: number; prevReps: number };

export const isRepRecord = (r: SessionRecord): r is RepRecord =>
  r.kind === "reps" && r.reps !== undefined && r.prevReps !== undefined;

/**
 * Records set in a single completed workout, compared against the user's
 * all-time prior bests.
 *
 * `priorHistory` MUST NOT contain `completed` itself — persistence runs
 * concurrently with the summary UI, so callers filter the stored history by
 * `id` to make the comparison deterministic either way.
 *
 * Semantics (all inherited from progressStats: working sets with done===true
 * and a parseable weight>0/reps>0 only):
 *   - heaviest       — heaviest single working set
 *   - oneRepMax      — best Epley estimate across all sets
 *   - bestSetVolume  — max(weight × reps) in a single set
 *   - A record requires strictly beating the prior best (ties don't count).
 *   - An exercise logged for the first time ever emits ONE record (heaviest,
 *     prevKg: null) rather than sweeping all three metrics.
 *   - Duplicate exercise entries in the session are folded into one comparison
 *     (collectExerciseHistory already aggregates across the whole workout).
 *   - reps        — a rep PR (utils/repPrs.ts: more reps than ever at a weight
 *     done before, one per exercise), right after the exercise's heaviest. Also
 *     on a bodyweight exercise or a hold, which have no other record.
 */
export function computeSessionRecords(
  completed: CompletedWorkout,
  priorHistory: CompletedWorkout[],
): SessionRecord[] {
  const records: SessionRecord[] = [];
  const seen = new Set<string>();
  const repPrs = sessionRepPrs(completed, priorHistory);

  for (const ex of completed.exercises) {
    // By identity: a new custom exercise given a deleted one's name has no
    // records yet, so its first session is a first, not a PR against the old.
    const norm = ex.name ? exerciseIdentity(ex) : "";
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    // An assisted exercise's record is its least assistance; it has no 1RM
    // or set volume, so computePRs gives it none (utils/assisted.ts).
    const assisted = isAssisted(ex);
    const flag = assisted ? { assisted: true as const } : {};
    const rep = repPrs.get(norm);
    const repRecord: SessionRecord[] = rep
      ? [{
          exerciseName: ex.name, kind: "reps", valueKg: rep.weightKg, prevKg: rep.weightKg,
          reps: rep.reps, prevReps: rep.prevReps, ...(rep.hold ? { hold: true as const } : {}), ...flag,
        }]
      : [];

    const session = computePRs(collectExerciseHistory([completed], ex), [completed], ex);
    // No weighted completed working sets this session (e.g. all bodyweight /
    // nothing ticked) → no weight to compare, though more reps can still be
    // a rep PR.
    if (!session.heaviest) {
      records.push(...repRecord);
      continue;
    }

    const prior = computePRs(collectExerciseHistory(priorHistory, ex), priorHistory, ex);
    if (!prior.heaviest) {
      records.push({ exerciseName: ex.name, kind: "heaviest", valueKg: session.heaviest.value, prevKg: null, ...flag });
      records.push(...repRecord);
      continue;
    }

    if (liftBeats(session.heaviest.value, prior.heaviest.value, assisted)) {
      records.push({ exerciseName: ex.name, kind: "heaviest", valueKg: session.heaviest.value, prevKg: prior.heaviest.value, ...flag });
    }
    records.push(...repRecord);
    if (session.oneRepMax && prior.oneRepMax && session.oneRepMax.value > prior.oneRepMax.value) {
      records.push({ exerciseName: ex.name, kind: "oneRepMax", valueKg: session.oneRepMax.value, prevKg: prior.oneRepMax.value });
    }
    if (session.bestSetVolume && prior.bestSetVolume && session.bestSetVolume.value > prior.bestSetVolume.value) {
      records.push({
        exerciseName: ex.name, kind: "bestSetVolume", valueKg: session.bestSetVolume.value, prevKg: prior.bestSetVolume.value,
        weightKg: session.bestSetVolume.weight, reps: session.bestSetVolume.reps,
      });
    }
  }

  return records;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". Inputs < 1 clamp to 1. */
export function ordinal(n: number): string {
  const v = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const mod10 = v % 10;
  if (mod10 === 1) return `${v}st`;
  if (mod10 === 2) return `${v}nd`;
  if (mod10 === 3) return `${v}rd`;
  return `${v}th`;
}
