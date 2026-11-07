// What the Progress page has selected, kept for as long as the app is running.
//
// Leaving the page (another tab, a pushed screen, a trainer switching a client
// page to Journal or backing out of it) must come back to the same program,
// range, metrics and exercise; closing the app starts again from the defaults
// (user decision, 2026-09-29). So this is module memory, deliberately never
// AsyncStorage: it lives exactly as long as the JS runtime does.
//
// One set per person on screen: your own page and each client's page remember
// their selections separately, so a trainer's pick on one client never carries
// to the next.

import type {
  ExerciseMetricKey,
  ExerciseSelection,
  MetricKey,
  ProgramScope,
  RangeKey,
  StrengthMetricKey,
} from "../constants/progress";
import type { RunRef } from "./programRuns";
import type { CompareSpan } from "./programCompare";
import type { ExerciseRef } from "./exerciseNames";

export type ProgressSelections = {
  scope: ProgramScope;
  /** The charts' time range as picked, or null (the default) for automatic:
   *  this week once it has a session, last week until then if last week has
   *  one, else this week (autoWeekRange; user requests, 2026-11-06). Picking
   *  what automatic shows keeps it automatic. */
  range: RangeKey | null;
  /** The Volume chart's metric (Volume / Reps / Duration). */
  metric: MetricKey;
  /** The Strength radar's metric. */
  strengthMetric: StrengthMetricKey;
  /** The (day, exercise) charted under Exercise Progress. */
  selectedExercise: ExerciseSelection | null;
  /** The exercise charted under "All programs": every session of it, from any
   *  program or day (utils/allExercises.ts). Kept apart from
   *  `selectedExercise`, so switching between the two keeps each one's pick. */
  allExercise: ExerciseRef | null;
  /** The muscle group open in the Exercise Progress list under "All programs"
   *  (its label). */
  expandedMuscle: string | null;
  /** The day row open in the Exercise Progress list (ProgramDayRef.key). */
  expandedDay: string | null;
  /** The exercise chart's tab (Strength / Sets / Volume), comparing or not. */
  exerciseMetric: ExerciseMetricKey;
  /** Two programs side by side (utils/programCompare.ts): green, the program
   *  that was picked at the top, and blue, a finished one. Null when the page
   *  isn't comparing. */
  compare: { green: RunRef; blue: RunRef } | null;
  /** What At a glance and the averages read: the first days of each ("same")
   *  or each start to finish ("whole"). */
  compareSpan: CompareSpan;
  /** The exercise charted while comparing (its exerciseKey). */
  compareLift: string | null;
  /** The last "See All Progress" the page took (its `at`): each is taken
   *  once, the page remounting included. */
  allProgressAt: string | null;
  /** The last View Progress from My Programs the page took (its `at`), the
   *  same way. */
  programProgressAt: string | null;
};

export const DEFAULT_PROGRESS_SELECTIONS: ProgressSelections = {
  scope: { kind: "current" },
  range: null,
  metric: "volume",
  strengthMetric: "load",
  selectedExercise: null,
  allExercise: null,
  expandedMuscle: null,
  expandedDay: null,
  exerciseMetric: "strength",
  compare: null,
  compareSpan: "same",
  compareLift: null,
  allProgressAt: null,
  programProgressAt: null,
};

/**
 * "See All Progress" on Exercise History (user request, 2026-10-26): the
 * Progress page opens on All programs with this exercise charted across every
 * program. It rides on the navigation as route params, with an `at` that's new
 * on every tap (as the workout bar's `upTo` does), and the page takes each one
 * once (`allProgressAt`).
 */
export type AllProgressRequest = ExerciseRef & { at: string };

type AllProgressParams = { allProgress?: string; allProgressId?: string; allProgressAt?: string };

/** The route params asking for `ex` across every program. */
export function allProgressParams(ex: ExerciseRef): AllProgressParams {
  return {
    allProgress: ex.name,
    ...(ex.customId ? { allProgressId: ex.customId } : {}),
    allProgressAt: String(Date.now()),
  };
}

/** The request a page's route params carry, or null when they carry none. */
export function allProgressRequest(p: AllProgressParams): AllProgressRequest | null {
  if (!p.allProgress || !p.allProgressAt) return null;
  return { name: p.allProgress, ...(p.allProgressId ? { customId: p.allProgressId } : {}), at: p.allProgressAt };
}

/**
 * View Progress on a My Programs card (user request, 2026-11-07): the Progress
 * page opens on that program, Current program when it's the one running. As
 * "See All Progress" does, it rides on the navigation with an `at` new on
 * every tap, and the page takes each once (`programProgressAt`).
 */
export type ProgramProgressRequest = { programId: string; at: string };

type ProgramProgressParams = { programProgress?: string; programProgressAt?: string };

/** The route params asking for program `programId`'s progress. */
export function programProgressParams(programId: string): ProgramProgressParams {
  return { programProgress: programId, programProgressAt: String(Date.now()) };
}

/** The request a page's route params carry, or null when they carry none. */
export function programProgressRequest(p: ProgramProgressParams): ProgramProgressRequest | null {
  if (!p.programProgress || !p.programProgressAt) return null;
  return { programId: p.programProgress, at: p.programProgressAt };
}

const sessions = new Map<string, ProgressSelections>();

/** Whose Progress page this is: the viewer's own, or a client's (a trainer's
 *  view of them). */
export function progressSessionKey(clientId?: string): string {
  return clientId ? `client:${clientId}` : "self";
}

export function getProgressSelections(key: string): ProgressSelections {
  return sessions.get(key) ?? DEFAULT_PROGRESS_SELECTIONS;
}

export function setProgressSelection<K extends keyof ProgressSelections>(
  key: string,
  field: K,
  value: ProgressSelections[K],
): void {
  sessions.set(key, { ...getProgressSelections(key), [field]: value });
}

/** Forget every page's selections. On an account switch, so the next account
 *  doesn't open on the last one's programs and clients. */
export function clearProgressSessions(): void {
  sessions.clear();
}
