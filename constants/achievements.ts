// constants/achievements.ts
//
// Achievements: the short-lived cards under Recent Activity on Home, and the
// notification that goes with each. Detection and copy live in
// utils/achievements.ts (pure, tested by scripts/verify-achievements.ts);
// storage and delivery in utils/achievementStore.ts.
//
// Deliberately few categories, each meant to be worth celebrating. Before this,
// a "personal record" notification fired after almost every session: logging an
// exercise for the first time counted, and so did any rise in estimated 1RM or
// single-set volume.

export const ACHIEVEMENTS_KEY = "@avenas/achievements";

/** Each category holds at most ONE card; a newer achievement replaces it. */
export type AchievementCategory = "pr" | "workouts" | "program" | "streak";

/** Total workouts logged that earn a milestone. */
export const WORKOUT_MILESTONES: readonly number[] = [10, 25, 50, 100, 250, 500];

/**
 * App-open streak lengths that earn a milestone (see utils/streak.ts).
 *
 * The early ones are hand-picked, close together while a streak is young and
 * the flame is still changing tier. Past the last tier — where you choose which
 * flame you wear — they settle into every `STREAK_MILESTONE_STEP` days and
 * never run out. The list used to stop at 365, so the longest streaks in the
 * app earned nothing ever again.
 */
export const STREAK_MILESTONES: readonly number[] = [7, 14, 30];
export const STREAK_MILESTONE_STEP = 50;

/** Whether a streak of `days` earns a milestone. */
export function isStreakMilestone(days: number): boolean {
  if (STREAK_MILESTONES.includes(days)) return true;
  return days >= STREAK_MILESTONE_STEP && days % STREAK_MILESTONE_STEP === 0;
}

/** How long a card stays on Home after it's earned. */
export const ACHIEVEMENT_CARD_DAYS = 7;

type Base = {
  /** Unique per card. For once-only milestones it doubles as the awarded key. */
  id: string;
  /** ISO timestamp. */
  earnedAt: string;
};

/** One exercise's new best, as set in a single session. */
export type PRDetail = {
  exerciseName: string;
  valueKg: number;
  prevKg: number;
};

/** Values are stored raw (weights in canonical kg) and formatted at display
 *  time, so a kg/lbs switch re-expresses cards instead of freezing old text. */
export type Achievement =
  | (Base & {
      category: "pr";
      workoutId: string;
      /** EVERY PR the session set, heaviest first. A session with five PRs is
       *  still one card: it lists them when tapped, rather than saying "plus 4
       *  more" and sending the user to the workout to guess which. */
      prs: PRDetail[];
    })
  | (Base & { category: "workouts"; workoutId: string; count: number })
  | (Base & { category: "program"; programId: string; programName: string; totalWeeks: number })
  | (Base & { category: "streak"; days: number });

export type AchievementsState = {
  /** Current cards, at most one per category. Expired ones are pruned on write. */
  cards: Achievement[];
  /** Once-only milestones already earned ("workouts:100", "program:<id>:<start>"),
   *  so deleting and redoing a workout can't award the same milestone twice. */
  awarded: string[];
};

export const EMPTY_ACHIEVEMENTS: AchievementsState = { cards: [], awarded: [] };
