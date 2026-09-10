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
// One-shot flag: has the user seen the Step 2 (Workouts) coach mark — add
// exercises per day, tap a set's number badge to toggle warmup/working.
// Local-only UI preference (never synced).
export const WORKOUTS_COACHMARK_KEY = "@avenas/workouts_coachmark_seen";
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
  /**
   * Which of the program's cycle days this session was logged against — the
   * `dayIds` entry of that slot, NOT its name. This is what lets two days that
   * share a name ("Upper" twice in a cycle) keep separate progress, and what
   * keeps a session attached to its day after the day is renamed.
   *   - a string    → that slot, exactly
   *   - undefined   → a free workout, or a LEGACY record written before this
   *                   field existed. utils/dayIdMigration.ts backfills what it
   *                   can; whatever is left falls back to day-name matching
   *                   (see workoutMatchesDay in utils/progressStats.ts).
   */
  dayId?: string;
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
  // A held program keeps status "active", so the freeze above doesn't catch it.
  // Weeks must not advance while paused — that's what makes the finish date
  // move back by however long the hold lasted.
  if (program.pausedAt) return Math.min(Math.max(program.currentWeek || 1, 1), program.totalWeeks);
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
  /** NOTE: "paused" here means "shelved mid-run, not the active program" — it's
   *  what Make Inactive produces. A temporary hold on the ACTIVE program is
   *  `pausedAt` below, which is a different thing entirely. */
  status: "active" | "completed" | "paused" | "created";
  startDate: string;
  completedDate?: string;
  cycleOffset?: number;
  /** "YYYY-MM-DD" the active program was put on hold; absent means running.
   *  While set, nothing is scheduled from this date onward (utils/workout.ts
   *  resolveDayIndex) and the week counter freezes (getCurrentWeek). Resuming
   *  shifts startDate forward by the paused days, which both preserves the
   *  remaining weeks and lands the cycle back on the paused day — see
   *  utils/programPause.ts. */
  pausedAt?: string;
  trainingDays: number;
  cycleDays: number;
  cyclePattern: string[];
  /**
   * Stable per-slot ids, parallel to `cyclePattern` (same length, one entry per
   * slot including Rest days). A day's REAL identity: it survives a rename and
   * tells two same-named days apart, which `cyclePattern[i]` alone cannot.
   *
   * Optional — programs written before this field have none, and `dayIdAt`
   * (utils/programDays.ts) synthesizes the same deterministic positional id the
   * one-shot backfill assigns, so the two agree. Reordering the cycle permutes
   * this array alongside cyclePattern; renaming a day never touches it.
   */
  dayIds?: string[];
  workouts: WorkoutMap;
  extraWorkouts?: string[];
};

/**
 * One selectable workout day, resolved to a stable identity. Built by
 * `programDays` / `scopedProgramDays` (utils/programDays.ts, utils/progressStats.ts);
 * every day-scoped query and every day list should carry one of these rather
 * than a bare name string.
 */
export type ProgramDayRef = {
  /** Unique across programs — safe as a React key and as a selection identity. */
  key: string;
  /** The program's `dayIds` entry for this slot (or its positional fallback).
   *  `extra:<name>` for a free workout recorded in `extraWorkouts`. */
  dayId: string;
  /** Index into `cyclePattern`, -1 for an `extraWorkouts` entry or a historical
   *  day (one that has logged sessions but no longer exists in the cycle). */
  index: number;
  /** Display name — `cyclePattern[index]`. Changes freely; never an identity.
   *  For a historical day, the name its most recent session was logged under. */
  label: string;
  programId: string;
  programName: string;
  /** Normalized names of the exercises this day currently programs. Empty for
   *  an `extraWorkouts` entry and for a historical day — neither has a slot to
   *  read a prescription from, so nothing on them counts as "swapped out". */
  programExercises: string[];
  /** True when this day no longer exists in the program's cycle but still has
   *  logged sessions — deleted, or forked away by a rename + exercise change
   *  (see `forkChangedDayIds`). Its sessions are shown as-logged and nothing on
   *  it is compared against a current prescription. */
  isHistorical: boolean;
  /** True for the FIRST day in scope carrying this label. Sessions with no
   *  `dayId` (legacy / pre-backfill) attach here and nowhere else, so they can
   *  never be counted twice across same-named days. */
  absorbsUnidentified: boolean;
  /** True when another day in scope shares this label, so the UI knows to
   *  qualify the row (e.g. with the cycle-day number) instead of showing two
   *  rows that read identically. */
  duplicateLabel: boolean;
};
