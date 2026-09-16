// utils/skippedDates.ts
//
// Days the user has marked as rest, and the two things they might mean by it.
//
//   SKIP  — this date schedules nothing. The cycle keeps its alignment, so
//           tomorrow is still whatever it was going to be and this round's
//           workout is simply missed.
//
//   PUSH  — this date schedules nothing AND the cycle waits a day here, so the
//           workout that would have fallen on it lands the next day and
//           everything after follows. Days BEFORE it are untouched.
//
// That last clause is the whole design. The obvious way to push is to nudge
// `cycleOffset`, but that is a phase shift across the entire timeline with no
// anchor — pushing Tuesday also re-labels Monday, so on a Push/Pull/Legs/Rest
// cycle Monday's Push silently became Rest and a workout vanished from the
// week. Recording WHICH DATES were pushed and counting only the ones strictly
// before the date being resolved keeps the past fixed.
//
// Undo is therefore just removing the date: the alignment restores itself.
//
// Neither action extends the program. If someone is out for more than a day or
// two, pausing is the right tool — it shifts `startDate`, so the finish date
// moves with it (see utils/programPause.ts).
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-skipped-dates.ts).

import type { SavedProgram } from "../constants/programs";

type SkipFields = Pick<SavedProgram, "skippedDates" | "pushedDates">;

/** Is `ymd` marked as rest (either kind)? */
export function isDateSkipped(program: SkipFields, ymd: string): boolean {
  return !!program.skippedDates?.includes(ymd);
}

/** Is `ymd` one of the dates that also delays everything after it? */
export function isDatePushed(program: SkipFields, ymd: string): boolean {
  return !!program.pushedDates?.includes(ymd);
}

/**
 * How many pushed dates fall strictly BEFORE `ymd`. Each one delays the cycle
 * by a day, so this is subtracted from `daysPassed` when resolving that date.
 * Strictly before, so a pushed date doesn't delay itself — it resolves to
 * nothing anyway, being skipped.
 */
export function pushesBefore(program: SkipFields, ymd: string): number {
  const pushed = program.pushedDates;
  if (!pushed || pushed.length === 0) return 0;
  let n = 0;
  // Both sides are "YYYY-MM-DD", so a string compare is a date compare.
  for (const d of pushed) if (d < ymd) n += 1;
  return n;
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
 * `program` with `ymd` restored: no longer rest, and no longer delaying
 * anything. Undoes a push as well as a skip, which is what "move them back a
 * day" means. Returns the SAME object when there was nothing to undo, so
 * callers can use identity to skip a write.
 */
export function unskipDate(program: SavedProgram, ymd: string): SavedProgram {
  if (!isDateSkipped(program, ymd) && !isDatePushed(program, ymd)) return program;
  const skipped = (program.skippedDates ?? []).filter(d => d !== ymd);
  const pushed = (program.pushedDates ?? []).filter(d => d !== ymd);
  return {
    ...program,
    skippedDates: skipped.length > 0 ? skipped : undefined,
    pushedDates: pushed.length > 0 ? pushed : undefined,
  };
}

/** Toggle `ymd` between scheduled and rest (as a plain skip). */
export function toggleSkippedDate(program: SavedProgram, ymd: string): SavedProgram {
  return isDateSkipped(program, ymd) ? unskipDate(program, ymd) : skipDate(program, ymd);
}
