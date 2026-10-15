// utils/unfinishedSession.ts
//
// A workout left unfinished goes to the Journal with what was entered in it
// (user request, 2026-10-15). A session belongs to its day (utils/heldSession.ts):
// once the day is over, the Workout tab starts the next from the program, and
// it used to let the unfinished one go, sets and all. A phone that died
// mid-workout and wasn't opened again until after 3am the next morning lost the
// session. Now it's saved as Finish would have saved it: every set as it stood,
// ticked or not, and the session note and exercise notes. It's timed from its
// clock to the last change made in it.
//
// The Workout tab's Finish builds its sessions through completedExercises too,
// so a filed session can't drift from a finished one. Pure, so
// scripts/verify-unfinished-session.ts covers it; utils/unfinishedSessionStore.ts
// saves it.
//
// A workout forgotten on the same day is asked about rather than filed
// (user request, 2026-10-15; components/UnfinishedWorkoutWatcher.tsx). After
// an hour with nothing ticked or typed (looksForgotten), coming back to the app
// asks "Forgot to finish?", and Finish Workout ends it at the last thing logged,
// not at the moment of asking. Leaving the app mid-workout sends a reminder at
// that hour (forgottenReminderAt). And one filed because its day was over is
// announced once, with View in Journal (UnfinishedNotice).

import type { CompletedExercise, CompletedWorkout, Exercise, PlannedExercise } from "../constants/programs";
import { daysBetweenYMD, fromYMD, MONTH_NAMES } from "./dates";
import { FORGOTTEN_AFTER_MS, stillGoing } from "./heldSession";
import { stampSession, timeValFromDate } from "./sessionTime";
import { parseWeightToKg } from "./units";

/** A set as the Workout tab logs it: the numbers as typed, in the unit the
 *  session is in. `doneAt` is when it was ticked (epoch ms). */
export type DraftSet = { weight: string; reps: string; done: boolean; doneAt?: number };
export type DraftExerciseLog = { warmup: DraftSet[]; working: DraftSet[]; notes: string };
/** An exercise in the session: the program's, or one added during it. */
export type DraftExercise = Exercise & {
  /** What it was swapped in for (CompletedExercise.swappedFrom). */
  swappedFrom?: string;
  swappedFromId?: string;
  /** Which program exercise it is (CompletedExercise.programExerciseId). */
  programExerciseId?: string;
};

/** The Workout tab's session as it saves it (`@avenas/workout_draft`). */
export type WorkoutDraft = {
  /** The training day it's for (YYYY-MM-DD). */
  date: string;
  workoutInfo: { name: string; exercises: DraftExercise[]; programId?: string; dayId?: string; plan?: PlannedExercise[] };
  log: Record<string, DraftExerciseLog>;
  /** The unit `log`'s weights are in. Absent on drafts from before it. */
  unitIsKg?: boolean;
  isometricExIds?: string[];
  notes?: string;
  isFreeWorkout?: boolean;
  freeWorkoutAddToProgram?: boolean;
  /** Shaped before it started, never started: nothing in it to keep. */
  planned?: boolean;
  /** When the session last changed (epoch ms). Absent on drafts from before it. */
  savedAt?: number;
};

/** The workout clock as WorkoutTimerContext saves it: running from an effective
 *  start (pauses folded in), or paused with the time it had run. */
export type SavedClock = { startMs: number | null; pausedMs: number | null };

/** Whether any set has a tick or a number in it: what makes a session worth
 *  keeping, and what the Workout tab counts as started. */
export function hasEnteredSets(log: Record<string, DraftExerciseLog>): boolean {
  return Object.values(log).some(exLog =>
    [...exLog.warmup, ...exLog.working].some(s => s.done || !!s.weight.trim() || !!s.reps.trim()),
  );
}

/** A session's exercises as they're saved: every set as it stands, ticked or
 *  not, with the weights typed in the session's unit stored as canonical kg. */
export function completedExercises(
  exercises: readonly DraftExercise[],
  log: Record<string, DraftExerciseLog>,
  isKg: boolean,
  isometricExIds: ReadonlySet<string>,
): CompletedExercise[] {
  return exercises.map(ex => {
    const exLog = log[ex.id];
    return {
      name: ex.name,
      // Which custom exercise it was, so its history stays its own
      // (utils/exerciseNames.ts exerciseIdentity).
      ...(ex.customId ? { customId: ex.customId } : {}),
      sets: [
        ...(exLog?.warmup  ?? []).map(s => ({ type: "warmup"  as const, weight: parseWeightToKg(s.weight, isKg), reps: s.reps, done: s.done })),
        ...(exLog?.working ?? []).map(s => ({ type: "working" as const, weight: parseWeightToKg(s.weight, isKg), reps: s.reps, done: s.done })),
      ],
      notes: exLog?.notes ?? "",
      ...(ex.swappedFrom ? { swappedFrom: ex.swappedFrom } : {}),
      ...(ex.swappedFrom && ex.swappedFromId ? { swappedFromId: ex.swappedFromId } : {}),
      ...(ex.programExerciseId ? { programExerciseId: ex.programExerciseId } : {}),
      // The card's Hold switch: its reps are seconds, kept out of reps and
      // volume totals (CompletedExercise.isIsometric).
      ...(isometricExIds.has(ex.id) ? { isIsometric: true as const } : {}),
    };
  });
}

/** When something was last ticked or typed in a session (epoch ms): its last
 *  save, or the last set ticked. Null when nothing says (a session saved before
 *  saves were timed, with nothing ticked). */
export function lastActivityAt(draft: Pick<WorkoutDraft, "log" | "savedAt">): number | null {
  const ticks = Object.values(draft.log).flatMap(l => [...l.warmup, ...l.working]).map(s => s.doneAt ?? 0);
  const last = Math.max(draft.savedAt ?? 0, ...ticks);
  return last > 0 ? last : null;
}

/** The clock is going: running, or paused partway. */
export function clockLive(clock: SavedClock): boolean {
  return clock.startMs !== null || clock.pausedMs !== null;
}

/**
 * When an unfinished session began and ended. It ended at the last change made
 * in it (lastActivityAt). It began the clock's running time before that (the
 * time it had run, if paused), or at that same moment with no clock. Null when
 * nothing says when: a session saved before saves were timed, with nothing
 * ticked and no clock.
 */
export function sessionSpan(draft: Pick<WorkoutDraft, "log" | "savedAt">, clock: SavedClock): { start: Date; end: Date } | null {
  const end = lastActivityAt(draft);
  if (end === null) return null;
  const ran = clock.pausedMs !== null && clock.pausedMs > 0
    ? clock.pausedMs
    : clock.startMs !== null ? Math.max(0, end - clock.startMs) : 0;
  return { start: new Date(end - ran), end: new Date(end) };
}

/** Whether the saved session is over: from a day before `effectiveToday`, and
 *  not still being done (utils/heldSession.ts stillGoing: its clock going and
 *  something logged within the hour, a late night past midnight). Over, it
 *  goes to the Journal; otherwise the Workout tab carries on with it. */
export function draftIsOver(
  draft: Pick<WorkoutDraft, "date" | "log" | "savedAt">,
  effectiveToday: string,
  clock: SavedClock,
  now: number,
): boolean {
  if (draft.date === effectiveToday) return false;
  return !stillGoing(clockLive(clock), lastActivityAt(draft), now);
}

/** Whether an open workout looks forgotten: under way, and nothing ticked or
 *  typed in it for FORGOTTEN_AFTER_MS, counted from the later of its last
 *  activity and the last "Keep Going" (`keptGoingAt`). */
export function looksForgotten(live: boolean, lastActivity: number | null, keptGoingAt: number | null, now: number): boolean {
  if (!live || lastActivity === null) return false;
  return now - Math.max(lastActivity, keptGoingAt ?? 0) >= FORGOTTEN_AFTER_MS;
}

/** How soon after leaving the app the reminder comes at the earliest, when the
 *  hour since the last thing logged has already passed. */
export const REMINDER_LEAD_MS = 10 * 60 * 1000;

/** When to remind someone who left the app mid-workout: an hour after the last
 *  thing they logged, or REMINDER_LEAD_MS after leaving if that's passed. */
export function forgottenReminderAt(lastActivity: number, now: number): number {
  return Math.max(lastActivity + FORGOTTEN_AFTER_MS, now + REMINDER_LEAD_MS);
}

/** How many of a session's sets were ticked, of all of them. */
export function setsDone(sets: readonly { done: boolean }[]): { done: number; total: number } {
  return { done: sets.filter(s => s.done).length, total: sets.length };
}

/** Every set in a session's log, warm-ups first in each exercise. */
export function setsOfLog(log: Record<string, DraftExerciseLog>): DraftSet[] {
  return Object.values(log).flatMap(l => [...l.warmup, ...l.working]);
}

/** A workout filed unfinished, for the one notice that says so
 *  (UNFINISHED_NOTICE_KEY in constants/programs.ts). */
export type UnfinishedNotice = { id: string; workoutName: string; date: string; done: number; total: number };

export function noticeFor(filed: CompletedWorkout): UnfinishedNotice {
  const { done, total } = setsDone(filed.exercises.flatMap(e => e.sets));
  return { id: filed.id, workoutName: filed.workoutName, date: filed.date, done, total };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A past training day the way the notice names it: "yesterday", a weekday
 *  within the week, else "3 Oct". */
export function pastDayWords(ymd: string, today: string): string {
  const d = fromYMD(ymd);
  const days = daysBetweenYMD(ymd, today);
  if (!d || days === null) return ymd;
  if (days === 1) return "yesterday";
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** The notice's words: whose workout, from when, and what of it was saved. */
export function noticeMessage(notice: UnfinishedNotice, today: string): string {
  return `Your ${notice.workoutName} workout from ${pastDayWords(notice.date, today)} wasn't finished, `
    + `so what you logged is saved in your Journal: ${notice.done} of ${notice.total} sets done.`;
}

/** The "Forgot to finish?" prompt's words. `since` is the last thing logged as
 *  a time of day ("7:12 pm"); with no sets entered there's nothing to finish. */
export function forgottenMessage(workoutName: string, since: string, done: number, total: number, entered: boolean): string {
  if (!entered) return `${workoutName} has been open since ${since} with nothing logged.`;
  return `Nothing's been logged in ${workoutName} since ${since}. ${done} of ${total} sets done.`;
}

/**
 * The unfinished session as a finished one, or null when there's nothing in it
 * to keep: nothing ticked or typed in any set, or only shaped, never started.
 * Stamped as the Complete Workout sheet stamps one, to the minute
 * (utils/sessionTime.ts); with no time to go on, at midday on its day.
 * `fallbackIsKg` is the unit for a draft from before drafts recorded theirs.
 */
export function completedFromDraft(
  draft: WorkoutDraft,
  clock: SavedClock,
  id: string,
  fallbackIsKg: boolean,
  now: Date = new Date(),
): CompletedWorkout | null {
  if (draft.planned || !draft.workoutInfo || !draft.log || !hasEnteredSets(draft.log)) return null;
  const span = sessionSpan(draft, clock);
  let stamp: { completedAt: string; durationSeconds: number };
  if (span) {
    stamp = stampSession(draft.date, timeValFromDate(span.start), timeValFromDate(span.end), span.start, now);
  } else {
    const day = fromYMD(draft.date);
    if (!day) return null;
    day.setHours(12, 0, 0, 0);
    stamp = { completedAt: day.toISOString(), durationSeconds: 0 };
  }
  const notes = draft.notes ?? "";
  const info = draft.workoutInfo;
  return {
    id,
    date: draft.date,
    completedAt: stamp.completedAt,
    workoutName: info.name,
    // "" marks a free workout, as Finish does (CompletedWorkout.programId).
    programId: info.programId ?? "",
    dayId: info.dayId,
    ...(info.plan ? { plan: info.plan } : {}),
    durationSeconds: stamp.durationSeconds,
    sessionNotes: notes.trim() ? notes : undefined,
    exercises: completedExercises(info.exercises, draft.log, draft.unitIsKg ?? fallbackIsKg, new Set(draft.isometricExIds ?? [])),
  };
}
