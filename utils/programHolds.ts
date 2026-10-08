// utils/programHolds.ts
//
// Reading a program's past through the holds it came back from
// (SavedProgram.holds). Resuming a hold (utils/programPause.ts resumeProgram)
// moves startDate forward by the days held, and for "Today" cycleOffset with
// it, which keeps the cycle and the finish date right from then on but
// re-labels every day before the hold. These undo that for a past date. Pure,
// so the program page and the verify scripts can use them.

import type { SavedProgram } from "../constants/programs";
import { daysBetweenYMD, formatStoredDate, parseStoredDate, todayYMD, toYMD } from "./dates";

/** The day this run began, as a Date, or null when startDate can't be read. */
function runStart(program: SavedProgram): Date | null {
  const start = parseStoredDate(program.startDate);
  if (!start) return null;
  start.setDate(start.getDate() - (program.holds ?? []).reduce((n, h) => n + h.shift, 0));
  return start;
}

/**
 * The day this run of `program` began: its start date before every hold it
 * came back from moved it on. Null when the start date can't be read.
 */
export function runStartYMD(program: SavedProgram): string | null {
  const start = runStart(program);
  return start ? toYMD(start) : null;
}

/**
 * The same day in startDate's own format ("07 Oct 2026"), for the "Started …"
 * lines: startDate is where the last resume moved it, so after a pause they
 * showed a start the days held later than the program began. startDate as it
 * is when there's no hold to undo, or it can't be read.
 */
export function runStartDate(program: SavedProgram): string {
  if (!program.holds?.length) return program.startDate;
  const start = runStart(program);
  return start ? formatStoredDate(start) : program.startDate;
}

/**
 * Days with nothing done, counting back from `today` (utils/programPause.ts
 * autoPauseIfIdle holds the program after a week of them): since the last
 * workout logged, the day this run began, or the last time it came back from a
 * hold, whichever is latest. Counted from the last workout alone, a program
 * resumed after a holiday held itself again the next morning (the workout
 * before the holiday was still a week back), and again after every resume,
 * until a workout was logged on the very day of one; and one made active a
 * week after the last workout of the program before it held itself on its
 * second day. Found by scripts/verify-training-months.ts.
 */
export function idleDays(program: SavedProgram, workoutDates: string[], today: string = todayYMD()): number {
  const marks = [...workoutDates];
  const runStart = runStartYMD(program);
  if (runStart) marks.push(runStart);
  for (const h of program.holds ?? []) marks.push(h.to);
  const latest = marks.sort().at(-1);
  return latest ? Math.max(0, daysBetweenYMD(latest, today) ?? 0) : 0;
}

/** Whether `ymd` fell inside a hold the program has come back from. (The hold
 *  it's on now is `pausedAt`.) */
export function heldOn(program: SavedProgram, ymd: string): boolean {
  return (program.holds ?? []).some(h => ymd >= h.from && ymd < h.to);
}

/**
 * `program` as it stood before every hold that began after `ymd` was resumed:
 * what the cycle maths should read for a past date (utils/workout.ts
 * cycleIndexForDate reads every date through it). Each resume moved startDate
 * (and for "Today" cycleOffset) on, which re-labels the days before it;
 * undoing the later ones gives back the day that date actually had. The holds
 * undone leave the copy with it, so reading it again changes nothing.
 */
export function programAsOf(program: SavedProgram, ymd: string): SavedProgram {
  const holds = program.holds ?? [];
  const later = holds.filter(h => h.from > ymd);
  if (later.length === 0) return program;
  const start = parseStoredDate(program.startDate);
  if (!start) return program;
  start.setDate(start.getDate() - later.reduce((n, h) => n + h.shift, 0));
  const back = later.reduce((n, h) => n + h.offsetShift, 0);
  const offset = ((((program.cycleOffset ?? 0) - back) % program.cycleDays) + program.cycleDays) % program.cycleDays;
  const earlier = holds.filter(h => h.from <= ymd);
  return {
    ...program,
    startDate: formatStoredDate(start),
    cycleOffset: offset === 0 ? undefined : offset,
    holds: earlier.length > 0 ? earlier : undefined,
  };
}
