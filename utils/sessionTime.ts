// utils/sessionTime.ts
//
// A session's start and end as the time wheels hold them (12-hour, minute
// precision), and how a finished session is stamped from them: `completedAt`
// the real moment it finished, `durationSeconds` the minutes between the two
// wheels. The Workout tab's Complete Workout sheet, the Journal's log and
// workout detail's time edit all stamp sessions this way (stampSession).
// Pure, so scripts can save a session exactly as the app does
// (components/TimeWheelPicker.tsx, which draws the wheels, re-exports these).

import { fromYMD } from "./dates";
import { LATE_NIGHT_GRACE_HOUR } from "./workout";

export type TimeVal = { hour: number; minute: number; period: "AM" | "PM" };
export type WorkoutTime = { start: TimeVal; end: TimeVal };

export function toTotalMins(tv: TimeVal): number {
  const h24 = (tv.hour % 12) + (tv.period === "PM" ? 12 : 0);
  return h24 * 60 + tv.minute;
}

export function computeDurationMins(start: TimeVal, end: TimeVal): number {
  const s = toTotalMins(start);
  const e = toTotalMins(end);
  return e >= s ? e - s : 24 * 60 - s + e;
}

export function fmtTimeVal(tv: TimeVal): string {
  return `${tv.hour}:${String(tv.minute).padStart(2, "0")} ${tv.period}`;
}

export function fmtDurationMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function timeValFromDate(d: Date): TimeVal {
  const h = d.getHours();
  return { hour: h % 12 || 12, minute: d.getMinutes(), period: h < 12 ? "AM" : "PM" };
}

/** `tv` on the calendar day `day` falls on (local). */
function atTime(day: Date, tv: TimeVal): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), (tv.hour % 12) + (tv.period === "PM" ? 12 : 0), tv.minute);
}

/**
 * When a session of training day `ymd` began, from the start wheel: that time
 * on the day itself, or in the small hours after it, since the Workout tab
 * stays on the day before until LATE_NIGHT_GRACE_HOUR (utils/workout.ts
 * getEffectiveToday). Only a time before that hour can be either, and then
 * `hint` decides, the start as it was stamped (a live session's, or a logged
 * one's before an edit): whichever is nearer. Without one it's the small hours
 * after the day, a late session, unless those haven't come yet. Null when
 * `ymd` can't be read.
 */
export function sessionStartAt(ymd: string, start: TimeVal, hint?: Date | null, now: Date = new Date()): Date | null {
  const day = fromYMD(ymd);
  if (!day) return null;
  const onDay = atTime(day, start);
  if (onDay.getHours() >= LATE_NIGHT_GRACE_HOUR) return onDay;
  const after = atTime(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), start);
  if (hint && !Number.isNaN(hint.getTime())) {
    return Math.abs(after.getTime() - hint.getTime()) < Math.abs(onDay.getTime() - hint.getTime()) ? after : onDay;
  }
  return after.getTime() <= now.getTime() ? after : onDay;
}

/**
 * A finished session's `completedAt` and `durationSeconds` from the wheels: it
 * began when sessionStartAt says, and finished the minutes between the wheels
 * later (an end before the start ran past midnight). The REAL finish: it used
 * to be the end time on the training day's date, so a session finished at
 * 12:30am and counted as the day before was saved a whole day early. It left
 * Recent Activity a day before its time and sorted ahead of that day's earlier
 * sessions. A screen showing a session's date shows `date`, its training day,
 * never completedAt's.
 */
export function stampSession(
  ymd: string,
  start: TimeVal,
  end: TimeVal,
  hint?: Date | null,
  now: Date = new Date(),
): { completedAt: string; durationSeconds: number } {
  const mins = computeDurationMins(start, end);
  const startAt = sessionStartAt(ymd, start, hint, now) ?? atTime(hint ?? now, start);
  return { completedAt: new Date(startAt.getTime() + mins * 60_000).toISOString(), durationSeconds: mins * 60 };
}
