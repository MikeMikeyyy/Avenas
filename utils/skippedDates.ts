// utils/skippedDates.ts
//
// Days the user has bent the program's timeline on, and the three things they
// might mean by it.
//
//   SKIP  — this date schedules nothing. The cycle keeps its alignment, so
//           tomorrow is still whatever it was going to be and this round's
//           workout is simply missed. Costs a session, costs no time.
//
//   PUSH  — this date schedules nothing AND the cycle waits a day here, so the
//           workout that would have fallen on it lands the next day and
//           everything after follows. Days BEFORE it are untouched. Keeps the
//           session, costs a day: the program now finishes a day later.
//
//   PULL  — the rest day on this date is SPENT, so everything from here moves a
//           day earlier. The mirror of a push, and how you pay one back: push
//           on Tuesday because you're ill, pull a rest day later that week, and
//           next week starts on the day you originally planned.
//
// Anchoring to DATES is the whole design. The obvious way to shift a cycle is
// to nudge `cycleOffset`, but that is a phase shift across the entire timeline
// with no anchor — pushing Tuesday also re-labels Monday, so on a
// Push/Pull/Legs/Rest cycle Monday's Push silently became Rest and a workout
// vanished from the week. Counting marks against dates keeps the past fixed,
// makes the actions commutative, and makes undo exact: remove the date and the
// alignment restores itself, however many other marks exist around it.
//
// The net shift at any date is `cycleDrift` in utils/workout.ts, which also
// explains why a push counts strictly-before and a pull counts inclusive.
//
// For an absence longer than a day or two, pausing is still the right tool — it
// shifts `startDate` wholesale rather than accruing marks (utils/programPause.ts).
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-skipped-dates.ts).

import type { SavedProgram } from "../constants/programs";

type SkipFields = Pick<SavedProgram, "skippedDates" | "pushedDates" | "pulledDates">;

/** Is `ymd` marked as rest (either kind)? */
export function isDateSkipped(program: SkipFields, ymd: string): boolean {
  return !!program.skippedDates?.includes(ymd);
}

/** Is `ymd` one of the dates that also delays everything after it? */
export function isDatePushed(program: SkipFields, ymd: string): boolean {
  return !!program.pushedDates?.includes(ymd);
}

/** Is `ymd` a rest day the user spent to bring the schedule forward? */
export function isDatePulled(program: SkipFields, ymd: string): boolean {
  return !!program.pulledDates?.includes(ymd);
}

const withSorted = (list: string[]): string[] => [...list].sort();

/** `program` with `ymd` marked as rest, leaving the cycle's alignment alone. */
export function skipDate(program: SavedProgram, ymd: string): SavedProgram {
  if (isDateSkipped(program, ymd)) return program;
  return { ...program, skippedDates: withSorted([...(program.skippedDates ?? []), ymd]) };
}

/**
 * `program` with `ymd` marked as rest AND the cycle delayed a day from there,
 * so that date's workout moves to the next day and the rest follow.
 * A pushed date is always also skipped.
 */
export function pushDate(program: SavedProgram, ymd: string): SavedProgram {
  const skipped = skipDate(program, ymd);
  if (isDatePushed(skipped, ymd)) return skipped;
  return { ...skipped, pushedDates: withSorted([...(skipped.pushedDates ?? []), ymd]) };
}

/**
 * `program` with the rest day on `ymd` SPENT: it no longer rests, and
 * everything from that date onward moves a day earlier. The mirror of
 * `pushDate`, and the way a user pays back a push so the program doesn't end
 * up a day longer.
 *
 * Only meaningful on a date the cycle currently rests on — callers check that
 * before offering it, and `cycleDrift` (utils/workout.ts) checks it again at
 * resolve time so a push added afterwards can't turn this into a deleted
 * workout.
 */
export function pullDate(program: SavedProgram, ymd: string): SavedProgram {
  if (isDatePulled(program, ymd)) return program;
  return { ...program, pulledDates: withSorted([...(program.pulledDates ?? []), ymd]) };
}

/**
 * `program` with `ymd` restored: no longer rest, no longer delaying anything,
 * and no longer spent. Undoes a push, a skip or a pull, which is what "put that
 * day back" means in each case. Returns the SAME object when there was nothing
 * to undo, so callers can use identity to skip a write.
 */
export function unskipDate(program: SavedProgram, ymd: string): SavedProgram {
  if (!isDateSkipped(program, ymd) && !isDatePushed(program, ymd) && !isDatePulled(program, ymd)) {
    return program;
  }
  const skipped = (program.skippedDates ?? []).filter(d => d !== ymd);
  const pushed = (program.pushedDates ?? []).filter(d => d !== ymd);
  const pulled = (program.pulledDates ?? []).filter(d => d !== ymd);
  return {
    ...program,
    skippedDates: skipped.length > 0 ? skipped : undefined,
    pushedDates: pushed.length > 0 ? pushed : undefined,
    pulledDates: pulled.length > 0 ? pulled : undefined,
  };
}

/** Toggle `ymd` between scheduled and rest (as a plain skip). */
export function toggleSkippedDate(program: SavedProgram, ymd: string): SavedProgram {
  return isDateSkipped(program, ymd) ? unskipDate(program, ymd) : skipDate(program, ymd);
}
