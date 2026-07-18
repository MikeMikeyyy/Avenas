export const PROGRAMS_KEY = "@avenas/programs";
export const WORKOUT_DATES_KEY = "@avenas/workout_dates";
export const WORKOUT_HISTORY_KEY = "@avenas/workout_history";
export const WORKOUT_DAY_OVERRIDE_KEY = "@avenas/today_workout_override";
export const WORKOUT_DRAFT_KEY = "@avenas/workout_draft";
export const WORKOUT_VIEW_MODE_KEY = "@avenas/workout_view_mode"; // "focus" | "list"
export const LOG_DRAFT_KEY_PREFIX = "@avenas/log_draft:";
export const logDraftKey = (date: string, workoutName: string) =>
  `${LOG_DRAFT_KEY_PREFIX}${date}:${workoutName}`;
// One-shot flag: has the user seen the "tap a day to switch Training/Rest"
// coach mark in the program builder. Local-only UI preference (never synced).
export const CYCLE_COACHMARK_KEY = "@avenas/cycle_pattern_coachmark_seen";
// How many working sets a newly added exercise starts with (the exercise
// picker's "sets" stepper). Local-only UI preference (never synced).
export const DEFAULT_SET_COUNT_KEY = "@avenas/builder_default_sets";
// "1" when typing a set value on the Workout screen should fill down into the
// not-yet-done sets below it (the program builder and log-workout always fill
// down). Settings toggle, off by default. Local-only UI preference (never synced).
export const WORKOUT_AUTOFILL_KEY = "@avenas/workout_autofill";
// "0" disables the iOS lock-screen / Dynamic Island Live Activity during a
// workout. Settings toggle, ON by default (any value other than "0" counts as
// enabled). Local-only, never synced. No-op in Expo Go / Android / iOS < 17.
export const LIVE_ACTIVITY_KEY = "@avenas/live_activity";

export type CompletedSet = {
  type: "warmup" | "working";
  weight: string;
  reps: string;
  done: boolean;
};

export type CompletedExercise = {
  name: string;
  sets: CompletedSet[];
  notes: string;
};

export type CompletedWorkout = {
  id: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO timestamp
  workoutName: string;
  durationSeconds: number;
  exercises: CompletedExercise[];
  sessionNotes?: string;
  /**
   * The program this session belongs to, set at save time.
   *   - a program id → logged under that program's day
   *   - "" (empty)   → a free workout, no program (NOT attributed to any)
   *   - undefined    → a LEGACY record (written before this field existed);
   *                    the Progress page attributes these by day name within
   *                    the program's date window so a newer program that reuses
   *                    day names can't claim them.
   * Distinguishing "" from undefined is deliberate — see workoutBelongsToProgram.
   */
  programId?: string;
};

export type ProgramSet = {
  type: "warmup" | "working";
  weightKg?: string;
  repMode?: "target" | "range"; // defaults to "target"
  reps?: string;                // repMode === "target", e.g. "8"
  repsMin?: string;             // repMode === "range", e.g. "8"
  repsMax?: string;             // repMode === "range", e.g. "12"
};

export type Exercise = {
  id: string;
  name: string;
  sets: ProgramSet[];
  isIsometric?: boolean;
  restSeconds?: number;
  programNotes?: string;
  // Legacy fields — kept optional for migration only
  warmupSets?: number;
  workingSets?: number;
  reps?: string;
};

export function normaliseSets(ex: Exercise): ProgramSet[] {
  if (ex.sets?.length) return ex.sets;
  return [
    ...Array.from({ length: ex.warmupSets ?? 0 }, () => ({ type: "warmup" as const })),
    ...Array.from({ length: ex.workingSets ?? 1 }, () => ({
      type: "working" as const,
      reps: ex.reps || undefined,
    })),
  ];
}

export type WorkoutMap = Record<string, Exercise[]>;

// Date helpers live in utils/dates.ts. Re-exported here to preserve the
// existing import paths used by older callers; new code should import from
// utils/dates.ts directly.
import { parseStoredDate } from "../utils/dates";
export { parseStoredDate };

export function getCurrentWeek(program: SavedProgram): number {
  if (program.status === "completed") return program.totalWeeks;
  if (program.status === "paused" || program.status === "created") return program.currentWeek;
  const start = parseStoredDate(program.startDate);
  // Corrupt / unparseable startDate: fall back to the stored currentWeek rather
  // than silently treating the program as having started in January year-0.
  if (!start) return Math.min(Math.max(program.currentWeek || 1, 1), program.totalWeeks);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(daysSince / 7) + 1;
  return Math.min(Math.max(week, 1), program.totalWeeks);
}

export type SavedProgram = {
  id: string;
  name: string;
  totalWeeks: number;
  currentWeek: number;
  status: "active" | "completed" | "paused" | "created";
  startDate: string;
  completedDate?: string;
  cycleOffset?: number;
  trainingDays: number;
  cycleDays: number;
  cyclePattern: string[];
  workouts: WorkoutMap;
  extraWorkouts?: string[];
};
