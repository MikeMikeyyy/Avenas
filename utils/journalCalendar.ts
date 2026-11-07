// The Journal's month calendar (components/JournalCalendar.tsx), worked out
// apart from drawing it: what each day is, the runs drawn under the days, and
// the line under the month's name. Pure, so the training harness can hold it
// to what was logged (scripts/harness/training/checks.ts, journal-calendar/).
// A trainer's view of a client's Journal draws the same calendar from the
// client's history.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { getWorkoutForDate } from "./workout";
import { programRunViews } from "./programRuns";

/** What a day shows. `plain`: gone by with nothing logged and no program
 *  running on it, so there was no plan to miss (every such day used to read as
 *  missed). */
export type CalendarDayState = "workout" | "todayWorkout" | "today" | "rest" | "missed" | "future" | "plain";

/** What the program running on a day gone by planned for it: a workout, rest,
 *  or null when no run of any program covered it. */
export type PastPlan = (date: string) => "workout" | "rest" | null;

/**
 * Days gone by read against the run that was going on them, finished,
 * shelved or replaced since, not only the program active now (user request,
 * 2026-11-06: a program's skipped last workout reads missed once the program
 * has ended by itself, as every day it missed does). Asked of the active
 * program alone, a program that ended took its days with it: plain with
 * nothing active, rest once another was. Each run covers its first day to its
 * last (utils/programRuns.ts programRunViews: a finished run to the day it
 * finished, a shelved one to its last session, the one going on open-ended),
 * read on its own timeline; on a day two cover, the one begun later. A program
 * never made active plans nothing, and an earlier run from before runs were
 * kept has no schedule to read: their days fall through to the active
 * program, as before. The Journal's calendar and Home's both read it.
 */
export function pastPlanFrom(programs: readonly SavedProgram[], history: readonly CompletedWorkout[]): PastPlan {
  const spans = programs.flatMap(p => programRunViews(p, history)
    .filter(v => v.ref.run !== "earlier" && !(v.ref.run === "latest" && v.program.status === "created"))
    .map(v => ({ start: v.startYMD, end: v.endYMD, program: v.program })));
  return date => {
    let hit: (typeof spans)[number] | null = null;
    for (const s of spans) {
      if (s.start <= date && (s.end === null || date <= s.end) && (!hit || s.start > hit.start)) hit = s;
    }
    if (!hit) return null;
    return getWorkoutForDate(hit.program, date) ? "workout" : "rest";
  };
}

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

function stateOf(
  date: string,
  todayYMD: string,
  workoutDates: ReadonlySet<string>,
  program: SavedProgram | null,
  pastPlan: PastPlan | undefined,
): CalendarDayState {
  if (date === todayYMD) return workoutDates.has(date) ? "todayWorkout" : "today";
  if (date > todayYMD) return "future";
  if (workoutDates.has(date)) return "workout";
  // The run that was going on the day, ended since or not (pastPlanFrom).
  const planned = pastPlan?.(date);
  if (planned) return planned === "workout" ? "missed" : "rest";
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

/** The month as rows of weeks, Monday first, each with its runs. Days gone by
 *  read against the run that covered them (`pastPlan`, pastPlanFrom); a day
 *  no run covered, against the active `program`. */
export function calendarWeeks(
  year: number,
  month: number,
  todayYMD: string,
  workoutDates: ReadonlySet<string>,
  program: SavedProgram | null,
  pastPlan?: PastPlan,
): CalendarWeek[] {
  const slots: (CalendarDay | null)[] = [];
  const padBefore = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < padBefore; i++) slots.push(null);
  const totalDays = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= totalDays; day++) {
    const date = ymdOf(year, month, day);
    slots.push({ day, date, state: stateOf(date, todayYMD, workoutDates, program, pastPlan) });
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
