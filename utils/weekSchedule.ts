// utils/weekSchedule.ts
//
// Home's "This Week's Schedule": one row per day, plus the counts its ring
// shows. Pure + RN-free so the awkward cases can be tested
// (scripts/verify-week-schedule.ts) instead of only being seen on a phone.
//
// Three rules earn their keep here, each from the strip disagreeing with the
// Workout tab:
//
//   1. A LOGGED SESSION WINS over the plan. A custom workout, or a day swapped
//      in with Change Workout Day, lands on a date the cycle may call Rest. The
//      strip used to read the cycle alone, so a workout logged at 1am showed as
//      "Rest" with no tick, and the day you actually trained was invisible.
//   2. TODAY IS RESOLVED, NOT PLANNED. The Workout tab honors a same-day
//      change-day override; the strip didn't, so picking Legs on a rest day
//      changed one page and not the other. `resolvedTodayName` is what the tab
//      resolved, and the effective day's row uses it.
//   3. "TODAY" IS THE EFFECTIVE DAY (utils/workout.ts getEffectiveToday), which
//      before 3am is still yesterday while yesterday's workout is unfinished.
//      Keying off the calendar day put the highlight, and the line between past
//      and future, a day ahead of the Workout tab in the small hours.
//
// Everything is derived: nothing about a row is stored, so deleting a session
// takes its name and tick away again on the next read.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { addDaysYMD } from "./dates";
import { getWorkoutForDate } from "./workout";
import { isDatePushed, isDateSkipped } from "./skippedDates";

export type WeekDayPlan = {
  /** "YYYY-MM-DD". */
  dateYMD: string;
  /** The workout to show, or "Rest" when the day holds nothing. */
  workoutName: string;
  /** A session is logged on this date. */
  completed: boolean;
  /** This is the training day the app is on (the effective day). */
  isToday: boolean;
  /** Before the effective day. */
  isPast: boolean;
  isRest: boolean;
  /** The user marked this date off (a plain skip or a move). */
  isSkipped: boolean;
  /** The workout here was moved to the next day rather than dropped. */
  isPushed: boolean;
  /** Whether tapping the row does anything (see the rules below). */
  editable: boolean;
};

export type WeekSchedule = {
  days: WeekDayPlan[];
  /** Sessions logged inside this week, for the ring and the week's totals. */
  sessions: CompletedWorkout[];
  completedCount: number;
  /** Workouts the week holds: planned days plus any day trained anyway. */
  plannedCount: number;
};

/** `ymd` plus `days`, as "YYYY-MM-DD". Date-only arithmetic, so a DST
 *  transition inside the week can't shift a row. Now the shared one in
 *  utils/dates.ts, which the session track walks days with too. */
const addDays = addDaysYMD;

export function buildWeekSchedule({
  program,
  history,
  weekStartYMD,
  effectiveToday,
  resolvedTodayName,
}: {
  program: SavedProgram | null;
  history: CompletedWorkout[];
  /** The Monday the strip starts on. */
  weekStartYMD: string;
  /** getEffectiveToday(program, history). */
  effectiveToday: string;
  /** The name resolveWorkoutForDate gave for `effectiveToday`, or null for a
   *  rest day. Pass it even when it equals the plan: it also carries a
   *  change-day override, including one pointing at another program's day. */
  resolvedTodayName: string | null;
}): WeekSchedule {
  const weekEndYMD = addDays(weekStartYMD, 6);
  const sessions = history.filter(w => w.date >= weekStartYMD && w.date <= weekEndYMD);

  // The session to show per date: the newest, when a date has more than one.
  const sessionByDate = new Map<string, CompletedWorkout>();
  for (const w of sessions) {
    const prev = sessionByDate.get(w.date);
    if (!prev || w.completedAt > prev.completedAt) sessionByDate.set(w.date, w);
  }

  const days: WeekDayPlan[] = [];
  let plannedCount = 0;

  for (let i = 0; i < 7; i++) {
    const dateYMD = addDays(weekStartYMD, i);
    const session = sessionByDate.get(dateYMD) ?? null;
    // getWorkoutForDate is skip-aware, so a date marked off reads as Rest
    // without this loop knowing anything about skips.
    const scheduled = dateYMD === effectiveToday
      ? resolvedTodayName
      : (program ? getWorkoutForDate(program, dateYMD)?.name ?? null : null);
    const name = session?.workoutName ?? scheduled;
    const completed = session !== null;
    const isSkipped = !!program && isDateSkipped(program, dateYMD);
    const isPushed = !!program && isDatePushed(program, dateYMD);
    const isPast = dateYMD < effectiveToday;

    // The ring counts the whole week, future days included.
    if (name !== null) plannedCount++;

    days.push({
      dateYMD,
      workoutName: name ?? "Rest",
      completed,
      isToday: dateYMD === effectiveToday,
      isPast,
      isRest: name === null,
      isSkipped,
      isPushed,
      // Tappable only when there's something to do. A rest day never is, and
      // neither is a day you TRAINED: marking it off would empty a date that
      // still has a session in your history.
      //   Marked off: tap to put it back. A past MOVE stays locked, because
      //     undoing it re-labels days already lived through.
      //   Otherwise: a planned workout you haven't done, whether it's still to
      //     come or one you MISSED earlier this week.
      editable: isSkipped ? (!isPast || !isPushed) : name !== null && !completed,
    });
  }

  return { days, sessions, completedCount: sessions.length, plannedCount };
}

/** The Monday of `ymd`'s week, as "YYYY-MM-DD". */
export function weekStartFor(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dow = dt.getDay();
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}
