// utils/programStart.ts
//
// When a program made active starts (user request, 2026-11-16: "I want to be
// able to plan it to start on a specific date, whether that be the coming
// monday or week after monday etc. the days in between wont be missed days, but
// rest days"). Making a program active asks when it starts (My Programs' Make
// Active Program, the builder's Set as Active), and while it hasn't, Change
// Start Date moves it. Today, tomorrow, the coming Monday, the Monday after, or
// a date picked up to START_WITHIN_DAYS ahead.
//
// Never today once a workout is logged today (the same request: "it should not
// replace the previous program's workout day if we have completed a workout
// day"): made active on a day already trained, the new program counted it as
// its day 1, moved on to day 2 the next day, and its page called day 1 missed.
//
// Set to start later, it's the active program from the moment it's set, its
// start the program's own startDate a day or more ahead. Nothing new is stored:
// every reader already counts the days before a program's start as scheduling
// nothing (utils/workout.ts resolveDayIndex), so they're rest days on Home's
// week and calendars, the streak can't be lost on them (utils/streak.ts), the
// week-idle hold counts from the start (utils/programHolds.ts idleDays), and
// the program's week is 0 (getCurrentWeek). What's new is the words: anywhere a
// program's week shows, one that hasn't started says when it starts
// (startsLabel), and Home's and the Journal's calendars show the days still to
// come before it as rest (restBeforeStart; user pick, the same day: "every
// upcoming day should be shown as rest unless they manually do a workout in
// between").
//
// Pure (scripts/verify-program-start.ts).

import { getCurrentWeek, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { addDaysYMD, fmtDayDate, formatStoredDate, fromYMD, MONTH_NAMES, todayYMD } from "./dates";
import { runStartYMD } from "./programHolds";

/** How far ahead a start can be picked: about three months. */
export const START_WITHIN_DAYS = 91;

export type StartOption = {
  key: "today" | "tomorrow" | "monday" | "mondayAfter";
  label: string;
  /** "YYYY-MM-DD". */
  ymd: string;
};

/** Whether a workout is logged on `ymd`, any program's or none. */
function trainedOn(ymd: string, history: readonly Pick<CompletedWorkout, "date">[]): boolean {
  return history.some(w => w.date === ymd);
}

/** The first day a program made active on `today` can start: today, or
 *  tomorrow once a workout is logged today. */
export function earliestStart(today: string, history: readonly Pick<CompletedWorkout, "date">[]): string {
  return trainedOn(today, history) ? addDaysYMD(today, 1) : today;
}

/** The latest it can start (Pick a Date's last day). */
export function latestStart(today: string): string {
  return addDaysYMD(today, START_WITHIN_DAYS);
}

/** The first Monday after `ymd`. */
function mondayAfter(ymd: string): string {
  const d = fromYMD(ymd);
  const dow = d ? d.getDay() : 1;
  return addDaysYMD(ymd, ((8 - dow) % 7) || 7);
}

/**
 * The starts offered, in order: Today (unless trained today), Tomorrow, the
 * coming Monday (unless that's tomorrow) and the Monday after. Pick a Date is
 * the sheet's own.
 */
export function startOptions(today: string, history: readonly Pick<CompletedWorkout, "date">[]): StartOption[] {
  const tomorrow = addDaysYMD(today, 1);
  const monday = mondayAfter(today);
  return [
    ...(trainedOn(today, history) ? [] : [{ key: "today" as const, label: "Today", ymd: today }]),
    { key: "tomorrow", label: "Tomorrow", ymd: tomorrow },
    ...(monday === tomorrow ? [] : [{ key: "monday" as const, label: "The Coming Monday", ymd: monday }]),
    { key: "mondayAfter", label: "The Monday After", ymd: addDaysYMD(monday, 7) },
  ];
}

/** A start as a program stores it ("23 Nov 2026"). */
export function storedStart(ymd: string): string {
  const d = fromYMD(ymd);
  return d ? formatStoredDate(d) : ymd;
}

/** The day the active program starts when that's still to come ("YYYY-MM-DD"),
 *  else null: begun, on hold, or not the active program. */
export function startsLater(program: SavedProgram | null | undefined, today: string = todayYMD()): string | null {
  if (!program || program.status !== "active" || program.pausedAt) return null;
  const start = runStartYMD(program);
  return start && start > today ? start : null;
}

/** A day still to come before the active program starts: a rest day on the
 *  calendars, as it'll be once it's gone by. */
export function restBeforeStart(program: SavedProgram | null | undefined, ymd: string, today: string = todayYMD()): boolean {
  const start = startsLater(program, today);
  return start !== null && ymd > today && ymd < start;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Starts Mon 23 Nov", where a program that hasn't begun shows its week. */
export function startsLabel(ymd: string): string {
  const d = fromYMD(ymd);
  return d ? `Starts ${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}` : "Starts soon";
}

/** "Monday 23 November", for a sentence (its year when it isn't `today`'s). */
export function startDay(ymd: string, today: string = todayYMD()): string {
  return fmtDayDate(ymd, fromYMD(today) ?? new Date()) ?? ymd;
}

/**
 * "Replace your active program?"'s words (My Programs' Make Active Program,
 * the builder's Set as Active): what happens to `current`, and when `newName`
 * starts. The one replaced stops today whenever the new one starts.
 */
export function replaceMessage(current: SavedProgram, newName: string, startYMD: string, today: string = todayYMD()): string {
  const when = startYMD === today ? "today" : `on ${startDay(startYMD, today)}`;
  const gap = startYMD > today ? " The days until then are rest days." : "";
  const pending = startsLater(current, today);
  if (pending) return `"${current.name}" is set to start on ${startDay(pending, today)}. "${newName}" will start ${when} in its place.${gap}`;
  const week = getCurrentWeek(current, fromYMD(today) ?? new Date());
  if (week >= current.totalWeeks) {
    return `"${current.name}" has reached its last week, so it will be marked complete and "${newName}" will start ${when}.${gap}`;
  }
  return `"${current.name}" is your active program, in week ${week} of ${current.totalWeeks}. "${newName}" will start ${when} in its place, and making "${current.name}" active again later starts it over from week 1. Your logged workouts stay in your Journal.${gap}`;
}

/**
 * The active program, not begun, moved to start on `ymd` (Change Start Date):
 * its cycle from that day, week 0 until then. Nothing of its run is lost: it
 * has none yet. Anything marked on its days (a move, a rest day) was on the
 * old timeline, so it goes, as activation clears it.
 */
export function withStartDate(program: SavedProgram, ymd: string): SavedProgram {
  if (!fromYMD(ymd)) return program;
  return {
    ...program,
    startDate: storedStart(ymd),
    currentWeek: 1,
    cycleOffset: undefined,
    skippedDates: undefined,
    pushedDates: undefined,
    pulledDates: undefined,
  };
}
