// utils/programLifecycle.ts
//
// What My Programs' buttons do to the program list: making a program active
// (the builder's "set it as your active program" too), making it inactive,
// marking it complete, and Set Workout Date's re-alignment; what logging a
// past session from the Journal does to its program; how long a program can
// be (minTotalWeeks); and a run ending by itself, being carried on, and
// picking back up from a hold. Pure: the screens keep the storage writes,
// prompts and side effects around them.
//
// Lifted out of the screens so the two activation paths share ONE rule (they
// were copies kept in step by a comment), and so scripts/verify-solo-flows.ts
// plays the app's own logic rather than a copy of it.

import { getCurrentWeek, programFinishDate, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { addDaysYMD, daysBetweenYMD, formatStoredDate, fromYMD, parseStoredDate, toYMD } from "./dates";
import { clearShifts, marksAfterHold, repairMoves, skipDate } from "./skippedDates";
import { cycleIndexForDate, getEffectiveToday, getWorkoutForDate, normalizeDriftDates } from "./workout";
import { runStartYMD } from "./programHolds";
import { endingRun } from "./programRuns";
import { workoutBelongsToProgram } from "./progressStats";

/** The program that was active, when making another one active finished it. */
export type FinishedProgram = { program: SavedProgram; week: number };

/** Whether `p`'s run (the one under way, or the one it was shelved in) has a
 *  session logged in it. */
function runHasSessions(p: SavedProgram, history: readonly CompletedWorkout[]): boolean {
  const start = runStartYMD(p);
  return !!start && history.some(w => w.date >= start && workoutBelongsToProgram(w, p));
}

/**
 * What a program taken out of the active slot unfinished becomes: "paused",
 * shelved, its run kept when it's made active again (utils/programRuns.ts
 * endingRun), so its sessions stay a run of their own, not a finished one. In
 * its first week too, once anything is logged in it (user decision,
 * 2026-11-06): a week-1 shelve went back to "created" whatever had been done,
 * so making it active again kept no run, its sessions read as an earlier run
 * (which always counts as finished), and Compare offered a run that never
 * finished. One shelved before a single session still goes back to "created",
 * as if it never started (made active by mistake): kept, its empty run would be
 * numbered beside the real ones ("2nd run").
 */
function shelvedStatus(p: SavedProgram, week: number, history: readonly CompletedWorkout[]): "paused" | "created" {
  return week > 1 || runHasSessions(p, history) ? "paused" : "created";
}

/**
 * The active program taken out of the active slot by another taking it (made
 * active, or a finished one carried on): finished when it ran its full length
 * (which earns the achievement Mark Complete would), else shelved
 * (shelvedStatus), with its week snapshotted and any hold cleared, since
 * "inactive" and "on hold" are different states.
 */
function demoted(p: SavedProgram, todayStr: string, history: readonly CompletedWorkout[]): { program: SavedProgram; finished: FinishedProgram | null } {
  const week = getCurrentWeek(p);
  if (week >= p.totalWeeks) {
    return {
      program: { ...p, status: "completed", currentWeek: p.totalWeeks, completedDate: todayStr, pausedAt: undefined },
      finished: { program: p, week },
    };
  }
  return { program: { ...p, status: shelvedStatus(p, week, history), currentWeek: week, pausedAt: undefined }, finished: null };
}

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
 * A program that ran before (finished or shelved) keeps the run that's ending
 * in `runs` first (utils/programRuns.ts endingRun), since the new run re-dates
 * every field it's read from: the Progress page compares this run with the
 * last. Its finish date goes with it: a run under way has none. One shelved in
 * its first week before that kept its run (still "created", with sessions in
 * it) is read as the shelved run it was, so those sessions don't turn into an
 * earlier run that counts as finished (shelvedStatus).
 *
 * The program it replaces is demoted by the week it reached (demoted), which
 * reads `history` for whether its run has anything in it.
 */
export function activateProgram(
  programs: SavedProgram[],
  id: string,
  todayStr: string,
  history: readonly CompletedWorkout[],
): { programs: SavedProgram[]; finished: FinishedProgram | null } {
  let finished: FinishedProgram | null = null;
  const updated = programs.map((p): SavedProgram => {
    if (p.id === id) {
      const shelvedEarly = p.status === "created" && runHasSessions(p, history);
      const ending = endingRun(shelvedEarly ? { ...p, status: "paused", currentWeek: Math.max(1, p.currentWeek) } : p, todayStr);
      return {
        ...p,
        status: "active",
        startDate: todayStr,
        currentWeek: 1,
        cycleOffset: undefined,
        completedDate: undefined,
        pausedAt: undefined,
        // The last run's holds belong to it: this run starts unmoved.
        holds: undefined,
        skippedDates: undefined,
        pushedDates: undefined,
        pulledDates: undefined,
        ...(ending ? { runs: [...(p.runs ?? []), ending] } : {}),
      };
    }
    if (p.status === "active") {
      const out = demoted(p, todayStr, history);
      if (out.finished) finished = out.finished;
      return out.program;
    }
    return p;
  });
  return { programs: updated, finished };
}

/**
 * Take `id` out of the active slot without completing it (Make Inactive):
 * shelved, "paused" (or "created" when nothing was ever logged in its first
 * week: shelvedStatus), so no program is active. Clears any hold, for the same
 * reason activation's demotion does.
 */
export function deactivateProgram(programs: SavedProgram[], id: string, history: readonly CompletedWorkout[]): SavedProgram[] {
  const target = programs.find(p => p.id === id);
  if (!target) return programs;
  const week = getCurrentWeek(target);
  const status = shelvedStatus(target, week, history);
  return programs.map((p): SavedProgram =>
    p.id === id ? { ...p, status, currentWeek: week, pausedAt: undefined } : p,
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

// ─── How long a program is ───────────────────────────────────────────────────

/**
 * The fewest weeks `program` can be: the week its run has reached (user
 * decision, 2026-11-05). Set shorter, its finish date landed behind the week it
 * was in: Home kept scheduling the days since while the program page called
 * them outside the program, and every session since read as the last one ("3rd
 * session" again and again), and a shelved one read "Week 6 of 4". A run under
 * way, held or not, is in the week getCurrentWeek says; a shelved or finished
 * one stopped in `currentWeek`. One that never ran can be a week long. Ending
 * a run early is Mark Complete's job.
 */
export function minTotalWeeks(program: SavedProgram, today: Date = new Date()): number {
  if (program.status === "active") return Math.max(1, getCurrentWeek(program, today));
  if (program.status === "paused" || program.status === "completed") return Math.max(1, program.currentWeek || 1);
  return 1;
}

/** `program` at `weeks` long, or as short as it can be (minTotalWeeks). */
export function withTotalWeeks(program: SavedProgram, weeks: number, today?: Date): SavedProgram {
  const total = Math.max(weeks, minTotalWeeks(program, today));
  return total === program.totalWeeks ? program : { ...program, totalWeeks: total };
}

/**
 * How many weeks a version sent over `program` gives it (a trainer's update, a
 * review's changes taken): the sender's, never shorter than its run has reached
 * (minTotalWeeks). A finished copy keeps its own: that's the run it finished,
 * and the sender's longer one read as stopped early ("Completed 8 of 10
 * weeks") and lost its finish from its page. Carrying it on is the builder's.
 */
export function sentTotalWeeks(program: SavedProgram, sentWeeks: number, today?: Date): number {
  if (program.status === "completed") return program.totalWeeks;
  return Math.max(sentWeeks, minTotalWeeks(program, today));
}

// ─── A run ending by itself ──────────────────────────────────────────────────

/**
 * The last day `program`'s run has a workout on ("YYYY-MM-DD"): its last
 * session's day. Read off the timeline as it stands, so a workout moved on at
 * the end (Move to Tomorrow) is on the day it moved to. A day made a rest day
 * (Make Rest Day) still counts as its day: resting on the last workout isn't
 * finishing early, and read as done, the program ended at the next open with
 * no program left to put the day back in. Null when it schedules none, or its
 * dates can't be read.
 */
export function lastWorkoutDate(program: SavedProgram): string | null {
  const finish = programFinishDate(program);
  const start = runStartYMD(program);
  if (!finish || !start) return null;
  // A moved day is marked off as well (pushedDates is a subset of
  // skippedDates): those stay off, the plain rest days come back.
  const pushed = new Set(program.pushedDates ?? []);
  const asPlanned: SavedProgram = { ...program, skippedDates: program.skippedDates?.filter(d => pushed.has(d)) };
  // Bounded by the run's own length, so nothing can make it walk forever.
  const span = daysBetweenYMD(start, toYMD(finish)) ?? 0;
  let ymd = toYMD(finish);
  for (let i = 0; i <= span; i++, ymd = addDaysYMD(ymd, -1)) {
    if (getWorkoutForDate(asPlanned, ymd)) return ymd;
  }
  return null;
}

/**
 * The day `program`'s run finished ("YYYY-MM-DD"), or null while it runs. A
 * program ends by itself: Mark Complete is for ending one early (user decision,
 * 2026-11-05). It finishes on the day its last session is done: anything of
 * this program logged on or after its last workout's date (late, or that day's
 * workout swapped for another). With nothing done by its last day, it finishes
 * on that day once it has gone by, so a missed last session can't leave it
 * running for good, every session after it numbered as its last. Only the
 * active program, and never while it's held: a hold moves its finish on, which
 * resuming writes.
 */
export function runFinishedOn(
  program: SavedProgram,
  history: readonly CompletedWorkout[],
  todayYMD: string,
): string | null {
  if (program.status !== "active" || program.pausedAt) return null;
  const finish = programFinishDate(program);
  if (!finish) return null;
  const last = lastWorkoutDate(program);
  if (last && last <= todayYMD) {
    let done: string | null = null;
    for (const w of history) {
      if (w.date < last || w.date > todayYMD || !workoutBelongsToProgram(w, program)) continue;
      if (done === null || w.date < done) done = w.date;
    }
    if (done) return done;
  }
  const finishYMD = toYMD(finish);
  return todayYMD > finishYMD ? finishYMD : null;
}

/**
 * The program list with the active program completed when its run has finished
 * (runFinishedOn): on the day it did, having run its full length, which earns
 * the achievement Mark Complete would. Called after a session is saved, and as
 * the app opens (utils/programFinish.ts).
 */
export function completeFinishedRun(
  programs: SavedProgram[],
  history: readonly CompletedWorkout[],
  todayYMD: string,
): { programs: SavedProgram[]; finished: FinishedProgram | null } {
  const active = programs.find(p => p.status === "active");
  const on = active ? runFinishedOn(active, history, todayYMD) : null;
  const day = on ? fromYMD(on) : null;
  if (!active || !day) return { programs, finished: null };
  return {
    programs: programs.map((p): SavedProgram => (p.id === active.id
      ? { ...p, status: "completed", currentWeek: p.totalWeeks, completedDate: formatStoredDate(day), pausedAt: undefined }
      : p)),
    finished: { program: active, week: active.totalWeeks },
  };
}

/**
 * The program list once `deleted` has gone from the history (`historyAfter`):
 * the program it finished picked back up. Delete & Redo on the last workout
 * left nothing to redo it in ("No Active Program"). Only when it's what
 * finished it (logged on or after the last workout's date, the day the program
 * completed), nothing else has, its last day hasn't gone by (on the day the
 * app is on, which before 3am can still be yesterday: getEffectiveToday), and
 * no other program has been made active since. One ended early with Mark
 * Complete stays ended.
 */
export function programsAfterDeletedSession(
  programs: SavedProgram[],
  deleted: CompletedWorkout,
  historyAfter: readonly CompletedWorkout[],
  now: Date = new Date(),
): SavedProgram[] {
  if (programs.some(p => p.status === "active")) return programs;
  const target = programs.find(p => p.status === "completed" && workoutBelongsToProgram(deleted, p));
  const done = target ? parseStoredDate(target.completedDate) : null;
  if (!target || !done || toYMD(done) !== deleted.date) return programs;
  const reopened: SavedProgram = { ...target, status: "active", completedDate: undefined };
  const last = lastWorkoutDate(reopened);
  if (!last || deleted.date < last) return programs;
  if (runFinishedOn(reopened, historyAfter, getEffectiveToday(reopened, historyAfter, now)) !== null) return programs;
  return programs.map(p => (p.id === target.id ? reopened : p));
}

// ─── Picking a run back up ───────────────────────────────────────────────────

/** How a run held from one day picks the cycle back up on another. */
export type ResumeMode =
  /** Today's workout is whatever the cycle would naturally be had it not stopped. */
  | "today"
  /** Carry on from the day it was on when it stopped. */
  | "whereILeftOff";

/**
 * `program` as it picks back up on `onYMD` after being held from `fromYMD`:
 * startDate moved on by the days held, which keeps the weeks left and lands the
 * cycle back on the day it stopped; "today" moves cycleOffset on as well, to
 * land on today's own day instead (the arithmetic is in utils/programPause.ts).
 * The hold is kept (SavedProgram.holds), so a past day still reads as it was,
 * and the rest days and moves around it are settled for the new timeline
 * (marksAfterHold). A hold's resume, and a finished run carried on
 * (carryOnProgram). An unreadable startDate just comes off hold.
 */
export function resumedFrom(program: SavedProgram, fromYMD: string, mode: ResumeMode, onYMD: string): SavedProgram {
  const held = Math.max(0, daysBetweenYMD(fromYMD, onYMD) ?? 0);
  const start = parseStoredDate(program.startDate);
  if (!start) return { ...program, pausedAt: undefined };
  start.setDate(start.getDate() + held);
  const offset = mode === "today"
    ? (((program.cycleOffset ?? 0) + held) % program.cycleDays + program.cycleDays) % program.cycleDays
    : program.cycleOffset;
  const holds = [...(program.holds ?? []), { from: fromYMD, to: onYMD, shift: held, offsetShift: mode === "today" ? held : 0 }];
  return marksAfterHold(
    { ...program, pausedAt: undefined, startDate: formatStoredDate(start), cycleOffset: offset, holds },
    fromYMD,
    onYMD,
  );
}

/**
 * `id`, a finished program, picked back up as the active program on `todayYMD`:
 * adding weeks to a finished program carries it on (user decision, 2026-11-05).
 * The same run, from where it finished: the days since read as a hold
 * (resumedFrom), so its weeks pick up after the one it ended in, its sessions
 * keep their numbers, and nothing in between reads as missed. From its last
 * session instead, when one was logged after it finished: the days it was
 * trained on are its own (a program kept going past its end before programs
 * finished by themselves, finished by the update). The program active till
 * then is demoted as making another active demotes it.
 */
export function carryOnProgram(
  programs: SavedProgram[],
  id: string,
  history: readonly CompletedWorkout[],
  todayYMD: string,
): { programs: SavedProgram[]; finished: FinishedProgram | null } {
  const target = programs.find(p => p.id === id);
  const today = fromYMD(todayYMD);
  if (!target || target.status !== "completed" || !today) return { programs, finished: null };
  // The day it finished on (its last day, for one with no completion date to
  // read), or its last session after that, and from the day after it today
  // stands in.
  const finishedOn = parseStoredDate(target.completedDate) ?? programFinishDate(target);
  let ended = finishedOn ? toYMD(finishedOn) : null;
  const runStart = runStartYMD(target);
  for (const w of history) {
    if (ended && w.date > ended && w.date <= todayYMD && (!runStart || w.date >= runStart) && workoutBelongsToProgram(w, target)) ended = w.date;
  }
  const from = ended ? addDaysYMD(ended, 1) : todayYMD;
  const reopened: SavedProgram = { ...target, status: "active", completedDate: undefined, pausedAt: undefined };
  const carried = from < todayYMD ? resumedFrom(reopened, from, "whereILeftOff", todayYMD) : normalizeDriftDates(reopened);
  const todayStr = formatStoredDate(today);
  let finished: FinishedProgram | null = null;
  const updated = programs.map((p): SavedProgram => {
    if (p.id === id) return carried;
    if (p.status !== "active") return p;
    const out = demoted(p, todayStr, history);
    if (out.finished) finished = out.finished;
    return out.program;
  });
  return { programs: updated, finished };
}
