// utils/programRuns.ts
//
// A program's runs: the one it's on (the program's own fields) and the ones it
// was started again after (SavedProgram.runs, migration 0047). Making a
// finished or shelved program active again starts it over under the same
// program, re-dating its own fields, so activateProgram keeps the run that's
// ending here (endingRun) and everything that reads a past run reads it
// through programAsRun, the program as that run left it.
//
// A program run again before runs were kept has sessions from before its
// current run and no record of when that run began: they're one "earlier run"
// (earlierRun), dated by its own sessions.
//
// Pure: no RN imports, so the verify scripts can run it.

import type { CompletedWorkout, ProgramRun, SavedProgram } from "../constants/programs";
import { addDaysYMD, formatStoredDate, parseStoredDate, toYMD } from "./dates";
import { runStartYMD } from "./programHolds";
import { workoutBelongsToProgram } from "./progressStats";

const ymdOf = (stored: string | undefined): string | null => {
  const d = parseStoredDate(stored);
  return d ? toYMD(d) : null;
};

/**
 * The run `program` is ending as it's made active again on `todayStr` (stored
 * format), or null when there's nothing to keep: it never ran (not started),
 * it's the active one, or its start can't be read. A finished run ends on the
 * day it was finished; a shelved one, the day before this new run (the day it
 * was shelved isn't recorded, and nothing of it is logged after).
 */
export function endingRun(program: SavedProgram, todayStr: string): ProgramRun | null {
  if (program.status !== "completed" && program.status !== "paused") return null;
  const start = runStartYMD(program);
  const today = ymdOf(todayStr);
  if (!start || !today) return null;
  const endDate = (program.status === "completed" ? ymdOf(program.completedDate) : null) ?? addDaysYMD(today, -1);
  if (endDate < start) return null;
  return {
    startDate: program.startDate,
    ...(program.cycleOffset !== undefined ? { cycleOffset: program.cycleOffset } : {}),
    ...(program.holds?.length ? { holds: program.holds } : {}),
    ...(program.skippedDates?.length ? { skippedDates: program.skippedDates } : {}),
    ...(program.pushedDates?.length ? { pushedDates: program.pushedDates } : {}),
    ...(program.pulledDates?.length ? { pulledDates: program.pulledDates } : {}),
    totalWeeks: program.totalWeeks,
    cycleDays: program.cycleDays,
    cyclePattern: program.cyclePattern,
    ...(program.dayIds ? { dayIds: program.dayIds } : {}),
    currentWeek: program.currentWeek,
    status: program.status,
    endDate,
  };
}

/** `program` as `run` left it: its timeline, cycle and how it ended, with the
 *  program's own name and exercises. Read a past run through this wherever the
 *  program's own fields would be read (the cycle maths, its week, its page). */
export function programAsRun(program: SavedProgram, run: ProgramRun): SavedProgram {
  return {
    ...program,
    startDate: run.startDate,
    cycleOffset: run.cycleOffset,
    holds: run.holds,
    skippedDates: run.skippedDates,
    pushedDates: run.pushedDates,
    pulledDates: run.pulledDates,
    totalWeeks: run.totalWeeks,
    cycleDays: run.cycleDays,
    cyclePattern: run.cyclePattern,
    dayIds: run.dayIds,
    currentWeek: run.currentWeek,
    status: run.status,
    completedDate: run.status === "completed" ? formatStoredDate(new Date(`${run.endDate}T12:00:00`)) : undefined,
    pausedAt: undefined,
    runs: undefined,
  };
}

/** Which run of which program: an index into its `runs`, its current run
 *  ("latest"), or the sessions from before runs were kept ("earlier"). */
export type RunRef = { programId: string; run: number | "latest" | "earlier" };

export const sameRun = (a: RunRef | null | undefined, b: RunRef | null | undefined): boolean =>
  !!a && !!b && a.programId === b.programId && a.run === b.run;

/** One run, ready to read. */
export type ProgramRunView = {
  ref: RunRef;
  /** The program as the run left it (programAsRun), or as it is for the
   *  latest; an earlier run's is dated by its own sessions. */
  program: SavedProgram;
  /** Its first and last days, "YYYY-MM-DD"; the last is null while it runs
   *  (one made inactive stopped at its last session). */
  startYMD: string;
  endYMD: string | null;
  /** Finished, rather than shelved or still going. */
  finished: boolean;
  /** Its sessions, oldest first. */
  sessions: CompletedWorkout[];
  /** Which run it was, from 1, for its name ("1st run"); null when the
   *  program has only ever had the one. */
  number: number | null;
};

const byCompleted = (a: CompletedWorkout, b: CompletedWorkout) => a.completedAt.localeCompare(b.completedAt);

/** The first and the last day `sessions` were trained on. Not the dates of the
 *  first and last logged: a session logged later can be dated earlier (the
 *  Journal logs a past one), and a run read as ending on its date stopped a
 *  week short of the cards and the program page. */
function trainedSpan(sessions: readonly CompletedWorkout[]): { first: string; last: string } | null {
  if (sessions.length === 0) return null;
  let first = sessions[0].date;
  let last = first;
  for (const w of sessions) {
    if (w.date < first) first = w.date;
    if (w.date > last) last = w.date;
  }
  return { first, last };
}

/** `history`'s sessions of `program` dated `startYMD` to `endYMD` (open-ended
 *  when null), oldest first. */
export function sessionsBetween(
  program: SavedProgram,
  history: readonly CompletedWorkout[],
  startYMD: string,
  endYMD: string | null,
): CompletedWorkout[] {
  return history
    .filter(w => workoutBelongsToProgram(w, program) && w.date >= startYMD && (endYMD === null || w.date <= endYMD))
    .sort(byCompleted);
}

/**
 * The sessions of a program run again before runs were kept: its own sessions
 * dated before its first recorded run (or before its current run, with none
 * recorded), read as one run dated by them. Null when there are none.
 */
export function earlierRun(program: SavedProgram, history: readonly CompletedWorkout[]): ProgramRunView | null {
  // The day the first kept run BEGAN: its startDate is where its last resume
  // moved it, and read from there, its own days before a hold came back as an
  // earlier run beside it.
  const firstKept = runStartYMD(program.runs?.length ? programAsRun(program, program.runs[0]) : program);
  if (!firstKept) return null;
  const sessions = history
    .filter(w => w.programId === program.id && w.date < firstKept)
    .sort(byCompleted);
  const span = trainedSpan(sessions);
  if (!span) return null;
  const startYMD = span.first;
  const endYMD = span.last;
  return {
    ref: { programId: program.id, run: "earlier" },
    program: {
      ...program,
      startDate: formatStoredDate(new Date(`${startYMD}T12:00:00`)),
      cycleOffset: undefined,
      holds: undefined,
      skippedDates: undefined,
      pushedDates: undefined,
      pulledDates: undefined,
      status: "completed",
      completedDate: formatStoredDate(new Date(`${endYMD}T12:00:00`)),
      pausedAt: undefined,
      runs: undefined,
    },
    startYMD,
    endYMD,
    finished: true,
    sessions,
    number: null,
  };
}

/**
 * Every run of `program` with its sessions: the earlier one from before runs
 * were kept (if any), each recorded run, then the latest (the program's own
 * fields). A run that hasn't started (a program never made active) is left out.
 */
export function programRunViews(program: SavedProgram, history: readonly CompletedWorkout[]): ProgramRunView[] {
  const out: ProgramRunView[] = [];
  const earlier = earlierRun(program, history);
  if (earlier) out.push(earlier);
  (program.runs ?? []).forEach((run, i) => {
    const asRun = programAsRun(program, run);
    const startYMD = runStartYMD(asRun);
    if (!startYMD) return;
    const sessions = sessionsBetween(asRun, history, startYMD, run.endDate);
    out.push({
      ref: { programId: program.id, run: i },
      program: asRun,
      startYMD,
      // A shelved run kept no record of the day it was shelved (its endDate
      // is the day before it started again): its last session stands in, as
      // on the program page.
      endYMD: run.status === "completed" ? run.endDate : trainedSpan(sessions)?.last ?? startYMD,
      finished: run.status === "completed",
      sessions,
      number: null,
    });
  });
  const latestStart = runStartYMD(program);
  if (latestStart) {
    const finishedOn = program.status === "completed" ? ymdOf(program.completedDate) : null;
    const sessions = sessionsBetween(program, history, latestStart, finishedOn);
    // Made inactive, it stopped where it stopped: its last session stands in
    // for the day, as for a shelved run above. Open-ended, it went on counting
    // the weeks since (user request, 2026-10-16).
    const end = program.status === "active" ? null : finishedOn ?? trainedSpan(sessions)?.last ?? latestStart;
    // One never made active has nothing to read, unless the Journal logged a
    // session onto it.
    if (program.status !== "created" || sessions.length > 0) {
      out.push({
        ref: { programId: program.id, run: "latest" },
        program,
        startYMD: latestStart,
        endYMD: end,
        finished: program.status === "completed",
        sessions,
        number: null,
      });
    }
  }
  // Numbered only when there's more than one to tell apart.
  if (out.length > 1) out.forEach((v, i) => { v.number = i + 1; });
  return out;
}

/** The run `ref` names, or null when it's gone (the program deleted, or a run
 *  that no longer has sessions to read). */
export function findRunView(
  ref: RunRef,
  programs: readonly SavedProgram[],
  history: readonly CompletedWorkout[],
): ProgramRunView | null {
  const program = programs.find(p => p.id === ref.programId);
  if (!program) return null;
  return programRunViews(program, history).find(v => v.ref.run === ref.run) ?? null;
}
