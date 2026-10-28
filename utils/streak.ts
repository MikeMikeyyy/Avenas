// utils/streak.ts
//
// The rules that decide when an app-open streak survives, freezes or resets.
//
// Two ideas, both deliberate:
//
//   1. REST DAYS FREEZE IT. The streak can only be lost on a day the active
//      program actually schedules a workout. Not opening the app on a rest day
//      (or while the program is on hold) costs nothing — there was nothing to
//      show up for. This is the whole point: a 4-day cycle shouldn't punish you
//      for the 3 days it tells you to rest.
//
//   2. ONE MISSED WORKOUT DAY IS FREE. The streak resets only once TWO or more
//      scheduled workout days have gone by without an open. Open Monday, miss
//      Tuesday, open Wednesday and the streak holds; miss Wednesday too and it
//      is gone (visible on Thursday).
//
// Opening the app on a rest day still counts as showing up and still increments
// the streak — rest days simply can't take it away.
//
// An open is the app launched OR brought back from the background
// (contexts/StreakContext.tsx records both through streakOnOpen).
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-streak.ts).

import { daysBetweenYMD, fromYMD, parseStoredDate, toYMD } from "./dates";
import { getWorkoutForDate } from "./workout";
import type { SavedProgram } from "../constants/programs";

/** How many scheduled workout days may pass with no app open before the streak
 *  resets. 1 = you get a day's buffer; the SECOND missed workout day ends it. */
export const STREAK_GRACE_DAYS = 1;

/** Never walk more than this many days when measuring a gap. A streak that has
 *  been frozen for two years is still frozen; the loop just stops counting. */
const MAX_GAP_DAYS = 730;

/**
 * Can the streak be LOST by not opening the app on `ymd`?
 *
 * True only when the active program schedules a workout that day. False for
 * Rest days, for dates from `pausedAt` onward (a held program schedules
 * nothing, so a hold freezes the streak for as long as it lasts), and for dates
 * before the program started.
 *
 * With no active program there is no schedule to read, so every day counts —
 * the buffer alone applies, which is the behaviour a user with no program had
 * before any of this existed. A program whose `startDate` won't parse is
 * treated the same way rather than silently freezing the streak forever
 * (CLAUDE.md: a null parseStoredDate means "no active program", never a
 * January-year-0 fallback).
 */
export function isStreakRiskDay(program: SavedProgram | null, ymd: string): boolean {
  if (!program) return true;
  if (!parseStoredDate(program.startDate)) return true;
  return getWorkoutForDate(program, ymd) !== null;
}

/**
 * How many scheduled workout days sit STRICTLY between `lastOpened` and `today`
 * — the days the user was asked to train and didn't open the app.
 *
 * Both ends are excluded on purpose: `lastOpened` was attended, and `today` is
 * being attended right now (this runs as the app opens). Counting stops at
 * `cap`, since every caller only cares whether the grace allowance is used up.
 */
export function missedStreakDays(
  program: SavedProgram | null,
  lastOpened: string,
  today: string,
  cap: number = STREAK_GRACE_DAYS + 1,
): number {
  const start = fromYMD(lastOpened);
  const end = fromYMD(today);
  if (!start || !end) return 0;

  let missed = 0;
  const cursor = new Date(start);
  for (let i = 0; i < MAX_GAP_DAYS; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getTime() >= end.getTime()) break;
    if (isStreakRiskDay(program, toYMD(cursor))) {
      missed += 1;
      if (missed >= cap) break;
    }
  }
  return missed;
}

/**
 * Does a streak last touched on `lastOpened` survive being opened on `today`?
 *
 * True for a same-day (or out-of-order) open, and whenever at most
 * STREAK_GRACE_DAYS scheduled workout days were missed in between.
 */
export function streakSurvives(
  program: SavedProgram | null,
  lastOpened: string,
  today: string,
): boolean {
  return missedStreakDays(program, lastOpened, today) <= STREAK_GRACE_DAYS;
}

/** The app-open streak as it's stored (avenas_streak_data). */
export type StreakRecord = {
  count: number;
  startDate: string;       // local date string (YYYY-MM-DD)
  highestStreak: number;
  lastOpenedDate: string;  // local date string (YYYY-MM-DD)
  openedDates: string[];   // every distinct day the user opened the app (YYYY-MM-DD)
  /** "local" once dates use local-midnight day boundaries (toYMD), like every
   *  other date in the app. Absent on legacy records, whose dates were UTC-based
   *  (toISOString); see streakOnOpen. */
  dayBasis?: "local";
};

/** Whether a stored value is a streak record. `openedDates` may be missing on
 *  an older one (streakOnOpen fills it in). */
export function isStreakRecord(value: unknown): value is StreakRecord {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.count === "number" &&
    typeof d.startDate === "string" &&
    typeof d.highestStreak === "number" &&
    typeof d.lastOpenedDate === "string"
  );
}

/**
 * The streak once the app is opened on `today`: launched, or brought back from
 * the background. It was only worked out at launch, and iOS keeps the app in
 * memory for days, so a return after a week away was never asked whether the
 * streak had survived it (it kept its old number), and a day the app was only
 * brought back on was never counted, so the next launch could end a streak kept
 * every day (user report, 2026-10-28).
 *
 * `saved` is null for a first open, or a record that couldn't be read as one.
 * Returns the record, whether it needs writing (a second open the same day
 * changes nothing), and whether it grew (a milestone may be due).
 */
export function streakOnOpen(
  saved: StreakRecord | null,
  today: string,
  program: SavedProgram | null,
): { record: StreakRecord; write: boolean; grew: boolean } {
  if (!saved) {
    return {
      record: { count: 1, startDate: today, highestStreak: 1, lastOpenedDate: today, openedDates: [today], dayBasis: "local" },
      write: true,
      grew: false,
    };
  }
  const opened = Array.isArray(saved.openedDates) ? saved.openedDates : [saved.lastOpenedDate];
  const openedDates = opened.includes(today) ? opened : [...opened, today];
  // Day boundaries are LOCAL calendar days (toYMD), the same basis as every
  // other date in the app. Records written before `dayBasis` existed used UTC
  // days (toISOString), which lag local by one in positive-UTC timezones (an
  // 8am AEST open recorded yesterday's UTC date). The grace day absorbs that:
  // a legacy gap of 2 leaves a single day in between, and one missed day is
  // free. Legacy openedDates entries may sit a day off, display-only.
  const isLegacy = saved.dayBasis !== "local";
  if ((daysBetweenYMD(saved.lastOpenedDate, today) ?? 0) <= 0) {
    // Same local day, or a legacy UTC date from a negative-UTC timezone that
    // ran a day AHEAD of local: already opened today.
    return {
      record: { ...saved, lastOpenedDate: today, openedDates, dayBasis: "local" },
      write: isLegacy || saved.lastOpenedDate !== today || !opened.includes(today),
      grew: false,
    };
  }
  if (streakSurvives(program, saved.lastOpenedDate, today)) {
    // Within the allowance: showing up today continues the run.
    const count = saved.count + 1;
    return {
      record: {
        count,
        startDate: saved.startDate,
        highestStreak: Math.max(saved.highestStreak, count),
        lastOpenedDate: today,
        openedDates,
        dayBasis: "local",
      },
      write: true,
      grew: true,
    };
  }
  // Two or more scheduled workout days passed unopened: a new run, the
  // personal best kept.
  return {
    record: { count: 1, startDate: today, highestStreak: saved.highestStreak, lastOpenedDate: today, openedDates, dayBasis: "local" },
    write: true,
    grew: false,
  };
}

/**
 * The date the streak would break on if the app is never opened again after
 * `lastOpened` — the (STREAK_GRACE_DAYS + 1)th scheduled workout day after it.
 *
 * That evening is the last chance to keep the streak, and the only night worth
 * a reminder: every night before it is either a rest day or still inside the
 * buffer. Returns null when no such day falls inside `horizonDays` (a long rest
 * block, a held program, or no schedule reaching that far), in which case
 * nothing is at risk soon and no reminder is owed.
 */
export function streakBreakDate(
  program: SavedProgram | null,
  lastOpened: string,
  horizonDays: number,
): string | null {
  const start = fromYMD(lastOpened);
  if (!start) return null;

  let seen = 0;
  const cursor = new Date(start);
  for (let i = 0; i < horizonDays; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const ymd = toYMD(cursor);
    if (!isStreakRiskDay(program, ymd)) continue;
    seen += 1;
    if (seen > STREAK_GRACE_DAYS) return ymd;
  }
  return null;
}
