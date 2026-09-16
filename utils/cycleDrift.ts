// How far the program's timeline has slipped from the calendar.
//
// A PUSH delays everything after it (+1 day); a PULL spends a rest day and
// brings everything from it forward (−1 day). The net at any date is this
// module's whole job.
//
// ── Why this is a dumb count ─────────────────────────────────────────────────
//
// It is tempting to make the reader clever: check, at resolve time, that each
// pulled date still lands on a Rest, so a push added later can't turn the pull
// into a deleted workout. That is wrong, and measurably so. `cycleIndexForDate`
// would then depend on `cyclePattern` and `cycleOffset`, and
// `app/programs.tsx:handleSetWorkoutDay` SOLVES for `cycleOffset` by computing
// the natural index with it zeroed and subtracting. The moment the drift term
// stops being independent of the offset, that inversion is invalid — measured
// at 4 of 6 target days landing on the wrong date.
//
// So the reader stays a pure count over two sorted string arrays: no cycle
// knowledge, no date parsing, total and cheap in the 730-day streak walk and
// the 372-cell calendar render. The "a pull must sit on a Rest" invariant is
// enforced on the WRITE side instead, by `normalizeDriftDates` in
// utils/workout.ts — the same discipline CLAUDE.md already mandates for
// `canonicalizeWorkouts`, and for the same reason: a stored key silently
// invalidated by a neighbouring edit.
//
// RN-free, dependency-free, pure (see scripts/verify-skipped-dates.ts).

import type { SavedProgram } from "../constants/programs";

type DriftFields = Pick<SavedProgram, "pushedDates" | "pulledDates">;

/**
 * Net days the cycle has been shifted by the time `dateYMD` is resolved.
 * Positive = running late (pushes), negative = caught up (pulls).
 *
 * The two ends are deliberately asymmetric, and it is the whole off-by-one:
 *
 *   - A push INSERTS a blank day at its date. That date is blank itself (it's
 *     in `skippedDates`), so the shift applies STRICTLY AFTER it — `<`.
 *   - A pull DELETES its date's rest. That date takes the following day's
 *     content, so the shift applies FROM IT INCLUSIVE — `<=`.
 *
 * Use `<` for a pull and tapping the rest day on the 11th would move the 10th.
 */
export function cycleDrift(program: DriftFields, dateYMD: string): number {
  let drift = 0;
  // Both sides are "YYYY-MM-DD", so a string compare is a date compare.
  for (const d of program.pushedDates ?? []) if (d < dateYMD) drift += 1;
  for (const d of program.pulledDates ?? []) if (d <= dateYMD) drift -= 1;
  return drift;
}
