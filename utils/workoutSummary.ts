// utils/workoutSummary.ts
//
// Post-workout completion summary derivations. Pure + RN-free.
//
// All weights are canonical KG (CompletedSet.weight is stored in kg) — display
// conversion is the caller's job via utils/units.ts.

import type { CompletedWorkout } from "../constants/programs";
import { collectExerciseHistory, computePRs } from "./progressStats";
import { normalizeExerciseName } from "./workout";

export type SessionRecordKind = "heaviest" | "oneRepMax" | "bestSetVolume";

export type SessionRecord = {
  exerciseName: string; // as logged (display casing)
  kind: SessionRecordKind;
  valueKg: number;      // the new best, canonical kg (kg×reps for bestSetVolume)
  prevKg: number | null; // the beaten prior best; null = first time ever logged
};

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
 */
export function computeSessionRecords(
  completed: CompletedWorkout,
  priorHistory: CompletedWorkout[],
): SessionRecord[] {
  const records: SessionRecord[] = [];
  const seen = new Set<string>();

  for (const ex of completed.exercises) {
    const norm = normalizeExerciseName(ex.name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    const session = computePRs(collectExerciseHistory([completed], ex.name), [completed], ex.name);
    // No weighted completed working sets this session (e.g. all bodyweight /
    // nothing ticked) → nothing measurable to compare.
    if (!session.heaviest) continue;

    const prior = computePRs(collectExerciseHistory(priorHistory, ex.name), priorHistory, ex.name);
    if (!prior.heaviest) {
      records.push({ exerciseName: ex.name, kind: "heaviest", valueKg: session.heaviest.value, prevKg: null });
      continue;
    }

    if (session.heaviest.value > prior.heaviest.value) {
      records.push({ exerciseName: ex.name, kind: "heaviest", valueKg: session.heaviest.value, prevKg: prior.heaviest.value });
    }
    if (session.oneRepMax && prior.oneRepMax && session.oneRepMax.value > prior.oneRepMax.value) {
      records.push({ exerciseName: ex.name, kind: "oneRepMax", valueKg: session.oneRepMax.value, prevKg: prior.oneRepMax.value });
    }
    if (session.bestSetVolume && prior.bestSetVolume && session.bestSetVolume.value > prior.bestSetVolume.value) {
      records.push({ exerciseName: ex.name, kind: "bestSetVolume", valueKg: session.bestSetVolume.value, prevKg: prior.bestSetVolume.value });
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
