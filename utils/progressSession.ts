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

export type ProgressSelections = {
  scope: ProgramScope;
  range: RangeKey;
  /** The Volume chart's metric (Volume / Reps / Duration). */
  metric: MetricKey;
  /** The Strength radar's metric. */
  strengthMetric: StrengthMetricKey;
  /** The (day, exercise) charted under Exercise Progress. */
  selectedExercise: ExerciseSelection | null;
  /** The program open in the Exercise Progress list under "All programs"
   *  (its id; the list groups days by program there). */
  expandedProgram: string | null;
  /** The day row open in the Exercise Progress list (ProgramDayRef.key). */
  expandedDay: string | null;
  /** The exercise chart's metric (Heaviest / Best Set / Volume / Reps). */
  exerciseMetric: ExerciseMetricKey;
};

export const DEFAULT_PROGRESS_SELECTIONS: ProgressSelections = {
  scope: { kind: "current" },
  range: "thisWeek",
  metric: "volume",
  strengthMetric: "load",
  selectedExercise: null,
  expandedProgram: null,
  expandedDay: null,
  exerciseMetric: "topWeight",
};

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
