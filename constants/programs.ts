import { cycleDrift } from "../utils/cycleDrift";

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
import { parseStoredDate, toYMD } from "../utils/dates";
export { parseStoredDate };

/**
 * Which week of the program `today` falls in, 1-based and clamped to
 * `totalWeeks`.
 *
 * `today` is a parameter so this can be tested and so callers that already know
 * the effective date don't disagree with it; it defaults to now.
 *
 * Counted against the program's own timeline, not the calendar: every day the
 * user pushed held the cycle still, so it has to hold the WEEK still too, or the
 * two drift apart and the program quietly loses a day of programming off the
 * end for each push. Spending a rest day (a pull) pays that back. This is the
 * same `cycleDrift` the scheduler uses, so "week 6" and "the workout the cycle
 * says is due" can never disagree.
 */
export function getCurrentWeek(program: SavedProgram, today: Date = new Date()): number {
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
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  // Round, not floor: a span crossing a daylight-saving transition is 23 or 25
  // hours on that day, and flooring the millisecond quotient drops a whole day.
  const daysSince = Math.round((day.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor((daysSince - cycleDrift(program, toYMD(day))) / 7) + 1;
  return Math.min(Math.max(week, 1), program.totalWeeks);
}

/**
 * The date the program is now due to finish, or null when `startDate` is
 * unparseable.
 *
 * Derived, never stored, so it always reflects the timeline as it stands:
 * pushing a day moves it out, spending a rest day brings it back, and a hold
 * moves it by however long the hold lasts (because resuming shifts `startDate`
 * — see utils/programPause.ts).
 */
export function programFinishDate(program: SavedProgram): Date | null {
  const start = parseStoredDate(program.startDate);
  if (!start) return null;
  start.setHours(0, 0, 0, 0);
  const span = program.totalWeeks * 7 - 1;

  // A FIXED POINT, not a formula. The end date is pushed out by the marks that
  // fall before it — but pushing it out can bring further marks inside the
  // window, which push it out again. Iterate until it stops moving. Bounded by
  // the number of marks, so it always terminates; do not "simplify" this into a
  // single expression.
  let end = new Date(start);
  end.setDate(end.getDate() + span);
  const bound = (program.pushedDates?.length ?? 0) + (program.pulledDates?.length ?? 0) + 1;
  for (let i = 0; i < bound; i++) {
    const next = new Date(start);
    next.setDate(next.getDate() + span + cycleDrift(program, toYMD(end)));
    if (next.getTime() === end.getTime()) break;
    end = next;
  }
  return end;
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
  /**
   * Dates ("YYYY-MM-DD") the user has explicitly marked as rest, overriding
   * whatever the cycle schedules there. A skipped date resolves to "no workout"
   * everywhere, because `resolveDayIndex` (utils/workout.ts) checks this at the
   * one chokepoint every scheduling path funnels through — Home's week strip and
   * today card, the Workout tab, the notification scheduler, the Progress
   * planned-count and the streak all follow from that single check.
   *
   * Notably a skipped day is NOT a missed workout day for the streak: you chose
   * to rest, so it can't cost you anything (see utils/streak.ts).
   *
   * Stored on the program rather than in its own key so it rides the cloud
   * snapshot and so no resolver needs a new parameter. Skipping a date does not
   * move the cycle — see `pushedDates` for that.
   */
  skippedDates?: string[];
  /**
   * The subset of `skippedDates` that also DELAYS the cycle: every date after a
   * pushed date resolves one cycle-day earlier, so the workout that would have
   * fallen on the pushed date lands the next day and everything after it
   * follows. Always kept as a subset — a pushed date is always skipped.
   *
   * Anchored to a date, deliberately. The obvious implementation is to nudge
   * `cycleOffset`, but that is a phase shift over the WHOLE timeline with no
   * anchor: pushing Tuesday also re-labels Monday, which silently swallows a
   * workout you already did. Counting pushes that fall strictly before the date
   * being resolved (see cycleIndexForDate) leaves everything earlier alone.
   *
   * Undoing a push is removing the date, which restores the original alignment.
   * A push makes the program a day LONGER; `pulledDates` is how that is paid
   * back.
   */
  pushedDates?: string[];
  /**
   * Rest days that absorbed a moved workout — the mirror of `pushedDates`.
   * Everything from a pulled date onward resolves one cycle-day later than the
   * calendar suggests, cancelling the push before it.
   *
   * Never managed directly by the user. "Do it tomorrow" writes a push on the
   * missed date AND a pull on the next rest day as one action
   * (`planDoItTomorrow`, utils/skippedDates.ts), so the shift ends there and the
   * following week is back on the planned days. Undoing the push removes its
   * pull (`unskipDate`); "Set Workout Date" clears them all (`clearShifts`).
   * Net drift (pushes minus pulls) is `cycleDrift` in utils/cycleDrift.ts.
   *
   * NOT a subset of `skippedDates` — a pulled date still schedules something,
   * namely whatever the next day was going to hold.
   *
   * Only ever recorded against a date the cycle rests on, and only from today
   * onward. `cycleDrift` re-checks that at resolve time, because a push added
   * afterwards can slide a workout onto a date that was a rest when this was
   * written; such a pull goes inert rather than deleting the session.
   */
  pulledDates?: string[];
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
