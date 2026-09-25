// utils/programHistory.ts
//
// The program page the Journal opens (app/program-history-detail.tsx): one
// section per calendar week the program ran, Monday to Sunday, with the days
// that were trained, missed or rested, the sessions logged, their totals, and
// what they earned. Pure + RN-free, so scripts/verify-program-history.ts can
// pin it.
//
// Three rules, each one this page used to break:
//
//   1. A session belongs to the program by workoutBelongsToProgram (its
//      programId; legacy records by name inside the program's dates), never by
//      day name alone. Matching names put another program's "Upper" into this
//      one's history whenever their dates overlapped, and left out a custom
//      workout added to the program.
//   2. Weeks are CALENDAR weeks, Monday to Sunday: the same weeks as Home's
//      "This Week's Schedule" (weekStartFor). They used to be the program's own
//      weeks, which run from whatever weekday it started on, so a program begun
//      on a Friday showed every week as Friday to Thursday. They're numbered
//      from the week the program started in (see ProgramWeek.number), which
//      for a mid-week start runs one ahead of "Week 3 of 8" for part of each
//      week.
//   3. Achievements are the ones the phone awarded. Each session is run through
//      the same detect functions against everything completed before it, the
//      way utils/clientAchievements.ts rebuilds a client's cards.
//
// Sessions dated before the program's start date are left out, as they always
// were: resuming from a hold moves startDate forward, and a re-activated
// program keeps its id, so such a session can't be told from an earlier run.

import { programFinishDate, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { EMPTY_ACHIEVEMENTS, type Achievement } from "../constants/achievements";
import { achievementsForWorkout, detectProgramAchievement } from "./achievements";
import { addDaysYMD, parseStoredDate, toYMD } from "./dates";
import { computeWorkoutTonnage, workoutBelongsToProgram } from "./progressStats";
import { weekStartFor } from "./weekSchedule";
import { getWorkoutForDate } from "./workout";

/**
 * What one day of a week was.
 *
 *   trained   a session of this program is logged on it (a rest day included)
 *   missed    it scheduled a workout, it's passed, and nothing was logged
 *   replaced  it scheduled a workout and something ELSE was logged that day
 *             (a free workout, another program's day): the session track's
 *             orange
 *   today     it schedules a workout today, not logged yet
 *   upcoming  it schedules a workout later this week
 *   rest      nothing scheduled: a Rest in the cycle, or a date marked off
 *   held      the program is on hold from this date
 *   off       outside the program: before it started, or after it ended
 */
export type WeekDayState = "trained" | "missed" | "replaced" | "today" | "upcoming" | "rest" | "held" | "off";

export type WeekDay = { ymd: string; state: WeekDayState };

export type ProgramWeek = {
  /** The Monday, "YYYY-MM-DD". Also the week's key. */
  startYMD: string;
  /** Week 1 is the Monday-to-Sunday week the program started in, even when it
   *  started mid-week (user decision, 2026-09-25). So for a mid-week start,
   *  Monday to the day before the start weekday, this runs one ahead of the
   *  program's own count (getCurrentWeek, "Week 3 of 8"). */
  number: number;
  /** Monday to Sunday, always seven. */
  days: WeekDay[];
  /** This program's sessions in the week, oldest first. */
  sessions: CompletedWorkout[];
  /** Days trained. */
  done: number;
  /** Days the week held a workout: scheduled, or trained anyway. */
  planned: number;
  volumeKg: number;
  durationSeconds: number;
  /** Completed working sets. */
  sets: number;
  /** What the week's sessions earned, oldest first (PRs, workout milestones,
   *  and in the week it ended, finishing the program). */
  achievements: Achievement[];
  /** The week today is in, while the program runs. */
  isCurrent: boolean;
};

export type ProgramHistory = {
  /** Newest first. */
  weeks: ProgramWeek[];
  totals: {
    sessions: number;
    volumeKg: number;
    durationSeconds: number;
  };
};

const EMPTY: ProgramHistory = {
  weeks: [],
  totals: { sessions: 0, volumeKg: 0, durationSeconds: 0 },
};

/** One session's numbers, for its row. */
export function sessionStats(w: CompletedWorkout): { exercises: number; sets: number; volumeKg: number } {
  let exercises = 0;
  let sets = 0;
  for (const ex of w.exercises) {
    if (ex.sets.some(s => s.done)) exercises += 1;
    for (const s of ex.sets) if (s.type === "working" && s.done) sets += 1;
  }
  return { exercises, sets, volumeKg: computeWorkoutTonnage(w) };
}

const byCompletedAt = (a: CompletedWorkout, b: CompletedWorkout) =>
  Date.parse(a.completedAt) - Date.parse(b.completedAt);

const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

const later = (a: string, b: string) => (a > b ? a : b);

/**
 * The page, for `program`, from the whole workout history (every program's
 * sessions are needed: a PR is measured against all of them, and a date
 * another session filled reads as replaced). `todayYMD` is the effective day
 * (getEffectiveToday), the same one Home and the Journal read against.
 */
export function buildProgramHistory(
  program: SavedProgram,
  history: CompletedWorkout[],
  todayYMD: string,
): ProgramHistory {
  const start = parseStoredDate(program.startDate);
  if (!start) return EMPTY;
  const startYMD = toYMD(start);
  const finish = programFinishDate(program);
  const finishYMD = finish ? toYMD(finish) : startYMD;

  const mine = history
    .filter(w => w.date >= startYMD && workoutBelongsToProgram(w, program))
    .sort(byCompletedAt);
  if (program.status === "created" && mine.length === 0) return EMPTY;
  const mineIds = new Set(mine.map(w => w.id));
  const lastSessionYMD = mine.reduce((m, w) => later(m, w.date), startYMD);

  // The program's last day, for a program that has stopped. Past it, days are
  // "off" rather than missed: nothing was asking for them. A shelved program
  // has no date for that, so its last session stands in.
  const runEndYMD = program.status === "active"
    ? null
    : program.status === "completed"
      ? (() => { const d = parseStoredDate(program.completedDate); return d ? toYMD(d) : finishYMD; })()
      : lastSessionYMD;

  // The last day the page shows a week for. Running: today, or the hold's
  // first day (the weeks of a long hold are all the same empty week), but never
  // past the timeline's end. Stopped: the day it stopped. Never short of a
  // logged session, so none falls off the page.
  const shownEndYMD = later(
    runEndYMD ?? (program.pausedAt && program.pausedAt < todayYMD
      ? program.pausedAt
      : (todayYMD < finishYMD ? todayYMD : finishYMD)),
    lastSessionYMD,
  );

  const mineDates = new Set(mine.map(w => w.date));
  const otherDates = new Set(history.filter(w => !mineIds.has(w.id)).map(w => w.date));

  const stateOf = (ymd: string): WeekDayState => {
    if (mineDates.has(ymd)) return "trained";
    if (ymd < startYMD) return "off";
    if (program.pausedAt && ymd >= program.pausedAt) return "held";
    if (ymd > (runEndYMD ?? finishYMD)) return "off";
    if (!getWorkoutForDate(program, ymd)) return "rest";
    if (ymd < todayYMD) return otherDates.has(ymd) ? "replaced" : "missed";
    return ymd === todayYMD ? "today" : "upcoming";
  };

  // What each session earned, measured the way the phone measured it live
  // (the same answer the workout's own screen shows).
  const earnedById = new Map<string, Achievement[]>();
  for (const w of mine) {
    const earned = achievementsForWorkout(w, history);
    if (earned.length > 0) earnedById.set(w.id, earned);
  }
  const finished = program.status === "completed" && runEndYMD
    ? (() => {
        const done = parseStoredDate(program.completedDate);
        return done ? detectProgramAchievement(program, program.currentWeek, EMPTY_ACHIEVEMENTS, done) : null;
      })()
    : null;

  const currentMonday = weekStartFor(todayYMD);
  const lastMonday = weekStartFor(shownEndYMD);
  const weeks: ProgramWeek[] = [];
  // Bounded, so a corrupt date can't spin: a 52-week program with every
  // possible delay is well inside it.
  for (let monday = weekStartFor(startYMD), guard = 0; monday <= lastMonday && guard < 200; guard++) {
    const sunday = addDaysYMD(monday, 6);
    const days = Array.from({ length: 7 }, (_, i) => {
      const ymd = addDaysYMD(monday, i);
      return { ymd, state: stateOf(ymd) };
    });
    const sessions = mine.filter(w => w.date >= monday && w.date <= sunday);
    const achievements = sessions.flatMap(w => earnedById.get(w.id) ?? []);
    if (finished && runEndYMD && runEndYMD >= monday && runEndYMD <= sunday) achievements.push(finished);

    let volumeKg = 0;
    let durationSeconds = 0;
    let sets = 0;
    for (const w of sessions) {
      const s = sessionStats(w);
      volumeKg += s.volumeKg;
      sets += s.sets;
      durationSeconds += positive(w.durationSeconds);
    }

    weeks.push({
      startYMD: monday,
      number: weeks.length + 1,
      days,
      sessions,
      done: days.filter(d => d.state === "trained").length,
      planned: days.filter(d => d.state !== "rest" && d.state !== "held" && d.state !== "off").length,
      volumeKg,
      durationSeconds,
      sets,
      achievements,
      isCurrent: program.status === "active" && monday === currentMonday,
    });
    monday = addDaysYMD(monday, 7);
  }

  return {
    weeks: weeks.reverse(),
    totals: {
      sessions: mine.length,
      volumeKg: weeks.reduce((s, w) => s + w.volumeKg, 0),
      durationSeconds: weeks.reduce((s, w) => s + w.durationSeconds, 0),
    },
  };
}
