// The Journal's month calendar (components/JournalCalendar.tsx), worked out
// apart from drawing it: what each day is, the runs drawn under the days, and
// the line under the month's name. Pure, so the training harness can hold it
// to what was logged (scripts/harness/training/checks.ts, journal-calendar/).
// A trainer's view of a client's Journal draws the same calendar from the
// client's history.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { getWorkoutForDate } from "./workout";

/** What a day shows. `plain`: gone by with nothing logged and no active
 *  program, so there was no plan to miss (every such day used to read as
 *  missed). */
export type CalendarDayState = "workout" | "todayWorkout" | "today" | "rest" | "missed" | "future" | "plain";

export type CalendarDay = { day: number; date: string; state: CalendarDayState };

/** Days back to back in one week that were all trained, or all missed: drawn
 *  as one band under them. `start` is its first day's column, Monday 0. A run
 *  ends with its week, as the row does. */
export type CalendarRun = { kind: "trained" | "missed"; start: number; length: number };

/** A row of the calendar, Monday to Sunday: null where the month hasn't begun
 *  or has ended. */
export type CalendarWeek = { days: (CalendarDay | null)[]; runs: CalendarRun[] };

/** "YYYY-MM-DD" for a day of a month (`month` from 0). Numbers rather than a
 *  Date, since the calendar walks a month by them. */
export function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stateOf(date: string, todayYMD: string, workoutDates: ReadonlySet<string>, program: SavedProgram | null): CalendarDayState {
  if (date === todayYMD) return workoutDates.has(date) ? "todayWorkout" : "today";
  if (date > todayYMD) return "future";
  if (workoutDates.has(date)) return "workout";
  if (!program) return "plain";
  // Through the shared resolver, so the month agrees with Home's week strip and
  // its calendar: days marked off, moved, held, or before the program began
  // scheduled nothing, so they're rest.
  return getWorkoutForDate(program, date) === null ? "rest" : "missed";
}

function runKind(day: CalendarDay | null): CalendarRun["kind"] | null {
  if (day?.state === "workout" || day?.state === "todayWorkout") return "trained";
  return day?.state === "missed" ? "missed" : null;
}

/** The month as rows of weeks, Monday first, each with its runs. */
export function calendarWeeks(
  year: number,
  month: number,
  todayYMD: string,
  workoutDates: ReadonlySet<string>,
  program: SavedProgram | null,
): CalendarWeek[] {
  const slots: (CalendarDay | null)[] = [];
  const padBefore = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < padBefore; i++) slots.push(null);
  const totalDays = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= totalDays; day++) {
    const date = ymdOf(year, month, day);
    slots.push({ day, date, state: stateOf(date, todayYMD, workoutDates, program) });
  }
  while (slots.length % 7 !== 0) slots.push(null);

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < slots.length; i += 7) {
    const days = slots.slice(i, i + 7);
    const runs: CalendarRun[] = [];
    days.forEach((day, col) => {
      const kind = runKind(day);
      if (!kind) return;
      const last = runs[runs.length - 1];
      if (last && last.kind === kind && last.start + last.length === col) last.length += 1;
      else runs.push({ kind, start: col, length: 1 });
    });
    weeks.push({ days, runs });
  }
  return weeks;
}

/** The month's workouts: every session logged in it, so two in a day are two. */
export function monthWorkouts(year: number, month: number, history: CompletedWorkout[]): number {
  const prefix = ymdOf(year, month, 1).slice(0, 8);
  return history.filter(w => w.date.startsWith(prefix)).length;
}

/** The line under the month's name: "19 workouts". */
export function summaryLine(workouts: number, isCurrentMonth: boolean): string {
  if (workouts === 0) return isCurrentMonth ? "No workouts yet" : "No workouts";
  return workouts === 1 ? "1 workout" : `${workouts} workouts`;
}
