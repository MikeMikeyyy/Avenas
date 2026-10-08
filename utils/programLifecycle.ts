// utils/programLifecycle.ts
//
// What My Programs' buttons do to the program list: making a program active
// (the builder's "set it as your active program" too), making it inactive,
// marking it complete, and Set Workout Date's re-alignment; and what logging a
// past session from the Journal does to its program. Pure: the screens keep
// the storage writes, prompts and side effects around them.
//
// Lifted out of the screens so the two activation paths share ONE rule (they
// were copies kept in step by a comment), and so scripts/verify-solo-flows.ts
// plays the app's own logic rather than a copy of it.

import { getCurrentWeek, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { addDaysYMD, formatStoredDate } from "./dates";
import { clearShifts, repairMoves, skipDate } from "./skippedDates";
import { cycleIndexForDate, getEffectiveToday, normalizeDriftDates } from "./workout";
import { runStartYMD } from "./programHolds";

/** The program that was active, when making another one active finished it. */
export type FinishedProgram = { program: SavedProgram; week: number };

/**
 * Make `id` the active program, starting `todayStr` (stored format).
 *
 * A (re-)activation is a fresh run from today: any cycleOffset left from a
 * previous run's Set Workout Date would shift day 1 arbitrarily, and pausedAt
 * goes for the same reason (a hold belongs to the run it was taken during;
 * carried over, the new run would start paused). The rest/push/pull marks go
 * too, and they matter most: every one is dated BEFORE the new startDate, so
 * all of them would count as drift against day 1, landing the fresh run's first
 * day several slots into the cycle and moving its finish date out by as much.
 *
 * The program it replaces is demoted by the week it reached: finished when it
 * ran its full length (which earns the achievement Mark Complete would), else
 * shelved ("paused" past week 1, "created" before), with its week snapshotted
 * and any hold cleared, since "inactive" and "on hold" are different states.
 */
export function activateProgram(
  programs: SavedProgram[],
  id: string,
  todayStr: string,
): { programs: SavedProgram[]; finished: FinishedProgram | null } {
  let finished: FinishedProgram | null = null;
  const updated = programs.map((p): SavedProgram => {
    if (p.id === id) {
      return {
        ...p,
        status: "active",
        startDate: todayStr,
        currentWeek: 1,
        cycleOffset: undefined,
        pausedAt: undefined,
        // The last run's holds belong to it: this run starts unmoved.
        holds: undefined,
        skippedDates: undefined,
        pushedDates: undefined,
        pulledDates: undefined,
      };
    }
    if (p.status === "active") {
      const week = getCurrentWeek(p);
      if (week >= p.totalWeeks) {
        finished = { program: p, week };
        return { ...p, status: "completed", currentWeek: p.totalWeeks, completedDate: todayStr, pausedAt: undefined };
      }
      return { ...p, status: week > 1 ? "paused" : "created", currentWeek: week, pausedAt: undefined };
    }
    return p;
  });
  return { programs: updated, finished };
}

/**
 * Take `id` out of the active slot without completing it: back to "paused"
 * (shelved mid-run) or "created" if it never got past week 1, so no program is
 * active. Clears any hold, for the same reason activation's demotion does.
 */
export function deactivateProgram(programs: SavedProgram[], id: string): SavedProgram[] {
  const target = programs.find(p => p.id === id);
  if (!target) return programs;
  const week = getCurrentWeek(target);
  return programs.map((p): SavedProgram =>
    p.id === id ? { ...p, status: week > 1 ? "paused" : "created", currentWeek: week, pausedAt: undefined } : p,
  );
}

/**
 * Mark `id` complete as of `todayStr`. Completing ends the run, hold and all:
 * a finished program is never "on hold". `weekReached` decides the achievement
 * (only a program that ran its full length earns it).
 */
export function completeProgram(
  programs: SavedProgram[],
  id: string,
  todayStr: string,
): { programs: SavedProgram[]; weekReached: number } {
  const target = programs.find(p => p.id === id);
  const weekReached = target ? getCurrentWeek(target) : 0;
  return {
    programs: programs.map((p): SavedProgram =>
      p.id === id ? { ...p, status: "completed", currentWeek: weekReached, completedDate: todayStr, pausedAt: undefined } : p,
    ),
    weekReached,
  };
}

/**
 * Set Workout Date: re-align `program` so `todayYMD` (the EFFECTIVE day, the one
 * the Workout tab is on) lands on cycle slot `targetDayIndex`. Null when the
 * start date can't be read.
 *
 * A clean reset first. "Today is Push" is the user saying where they are, so
 * every move that got them here is dropped (clearShifts: past moves become
 * plain skips so the calendar still says rest); left in, they kept counting,
 * and the week looked back on plan while the finish date stayed however many
 * days late. Today's own Make Rest Day goes too: setting today's workout is
 * changing your mind about it, exactly as a Change Workout Day pick is. Left
 * in, "today is Push" landed on a day still marked off and showed Rest. Then
 * the offset is SOLVED against the reset program, asking the shared resolver
 * where today lands with no offset rather than recomputing the days passed
 * here.
 *
 * Re-aligning re-labels the days before today too, and between midnight and
 * 3am that can turn yesterday into a workout not logged, which is exactly what
 * holds the app on yesterday (getEffectiveToday): set at 1am, "today is Lower"
 * showed yesterday's Upper. A yesterday that wasn't holding the app before
 * (`todayYMD` is the calendar day) is marked off, so the app stays on the day
 * the user set, and yesterday reads as the rest it was rather than a workout
 * missed. Hence `history` and `now`.
 */
export function setWorkoutDay(
  program: SavedProgram,
  targetDayIndex: number,
  todayYMD: string,
  history: readonly Pick<CompletedWorkout, "date">[] = [],
  now: Date = new Date(),
): SavedProgram | null {
  const shiftsCleared = clearShifts(program, todayYMD);
  const skipped = (shiftsCleared.skippedDates ?? []).filter(d => d !== todayYMD);
  const reset = { ...shiftsCleared, skippedDates: skipped.length > 0 ? skipped : undefined };
  const natural = cycleIndexForDate({ ...reset, cycleOffset: 0 }, todayYMD);
  if (natural === null) return null;
  const n = reset.cycleDays;
  const cycleOffset = ((targetDayIndex - natural) % n + n) % n;
  const realigned = normalizeDriftDates({ ...reset, cycleOffset });
  const yesterday = addDaysYMD(todayYMD, -1);
  return getEffectiveToday(realigned, history, now) === yesterday ? skipDate(realigned, yesterday) : realigned;
}

/**
 * The program list after a session is logged from the Journal on `date`.
 *
 * A free workout added to a program is remembered as one of its extras. And a
 * PROGRAM DAY logged before the program's start moves the start back to it:
 * logging a session you actually did earlier (you "started" today but really
 * began two weeks ago) moves the program's start, and so its current week and
 * progress everywhere. Only ever earlier, and only for a program day: a custom
 * workout isn't evidence the program began then, and moving the start re-dates
 * the whole cycle.
 */
export function programsAfterPastLog(
  programs: SavedProgram[],
  log: {
    /** The program the session belongs to ("" for none). */
    owningProgramId: string;
    /** The program a free workout was added to, if any. */
    addToProgramId?: string;
    /** The program whose day this is, when it's a program day. */
    programId?: string;
    /** "YYYY-MM-DD". */
    date: string;
    workoutName: string;
  },
): { programs: SavedProgram[]; changed: boolean } {
  const { owningProgramId, addToProgramId, programId, date, workoutName } = log;
  if (!owningProgramId) return { programs, changed: false };
  const addPid = addToProgramId && addToProgramId.length > 0 ? addToProgramId : null;
  const isProgramDay = !!programId && programId.length > 0;
  const [yy, mm, dd] = date.split("-").map(Number);
  const loggedDate = Number.isFinite(yy) && Number.isFinite(mm) && Number.isFinite(dd) ? new Date(yy, mm - 1, dd) : null;

  let changed = false;
  const updated = programs.map(p => {
    if (p.id !== owningProgramId) return p;
    let next = p;
    if (addPid === p.id && workoutName && !(p.extraWorkouts ?? []).includes(workoutName)) {
      next = { ...next, extraWorkouts: [...(next.extraWorkouts ?? []), workoutName] };
      changed = true;
    }
    // Against the day the run BEGAN, not startDate: resuming a hold moves
    // startDate on by the days held, so a session from before the hold,
    // logged after it, read as earlier than the start and moved it back,
    // re-dating the whole running cycle (utils/programHolds.ts).
    const runStart = runStartYMD(next);
    const [ry, rm, rd] = (runStart ?? "").split("-").map(Number);
    const start = runStart ? new Date(ry, rm - 1, rd) : null;
    if (isProgramDay && loggedDate && (!start || loggedDate.getTime() < start.getTime())) {
      // Moving the start re-dates every day of the cycle, so the rest day a
      // move spent can now hold a workout (a pull there would take a session
      // out of the plan), or no longer be the one that move would take: pair
      // each move with a rest day again on the new timeline (repairMoves). The
      // holds stay as they were, so startDate sits as far past the new first
      // day as they moved it.
      const anchor = new Date(loggedDate);
      anchor.setDate(anchor.getDate() + (next.holds ?? []).reduce((n, h) => n + h.shift, 0));
      next = repairMoves({ ...next, startDate: formatStoredDate(anchor) });
      changed = true;
    }
    return next;
  });
  return { programs: updated, changed };
}
