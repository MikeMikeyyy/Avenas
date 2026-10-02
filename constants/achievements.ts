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
 * App-open streak lengths that earn a milestone (see utils/streak.ts): round
 * numbers, every `STREAK_EARLY_STEP` days up to `STREAK_MILESTONE_STEP`, then
 * every `STREAK_MILESTONE_STEP` for as long as the streak runs: 10, 20, 30,
 * 40, 50, 100, 150, 200 and on (user decision, 2026-10-02). They were 7, 14
 * and 30, picked to match the flame's tiers, and a 14-day card read as an odd
 * number to celebrate. Before that the list stopped at 365, so the longest
 * streaks in the app earned nothing ever again; the 50s never run out.
 */
export const STREAK_EARLY_STEP = 10;
export const STREAK_MILESTONE_STEP = 50;

/** Whether a streak of `days` earns a milestone. */
export function isStreakMilestone(days: number): boolean {
  if (days <= 0) return false;
  const step = days <= STREAK_MILESTONE_STEP ? STREAK_EARLY_STEP : STREAK_MILESTONE_STEP;
  return days % step === 0;
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
