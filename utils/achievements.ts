// utils/achievements.ts
//
// What counts as an achievement, how cards replace and expire, and the words
// used for them. Pure + RN-free (scripts/verify-achievements.ts runs it under
// tsx); storage and notifications are utils/achievementStore.ts.
//
// The rules, all agreed with the product owner:
//   PR        only a heavier top set than ever before, on an exercise logged
//             before. First-time logs, ties, and estimated-1RM or set-volume
//             improvements don't count. One card per session, headlined by
//             the heaviest new record.
//   Workouts  the 10th, 25th, 50th, 100th, 250th and 500th workout, once each.
//   Program   finishing a program that ran its full length. Marking one
//             complete early isn't an achievement.
//   Streak    app-open streak milestones. Not once-only: a streak that's lost
//             and rebuilt earns them again.
//
// Copy rule: no em dashes.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import {
  ACHIEVEMENT_CARD_DAYS,
  STREAK_MILESTONES,
  WORKOUT_MILESTONES,
  type Achievement,
  type AchievementCategory,
  type AchievementsState,
} from "../constants/achievements";
import { computeSessionRecords } from "./workoutSummary";
import { toDisplayWeight, trimNumber } from "./units";

const DAY_MS = 86400000;

/**
 * PR and workout-milestone achievements earned by saving `completed`.
 * `priorHistory` MUST NOT contain `completed` (same contract as
 * computeSessionRecords).
 */
export function detectWorkoutAchievements(
  completed: CompletedWorkout,
  priorHistory: CompletedWorkout[],
  state: AchievementsState,
  now: Date,
): Achievement[] {
  const earnedAt = now.toISOString();
  const out: Achievement[] = [];

  // computeSessionRecords already requires STRICTLY beating the prior best and
  // marks a first-ever log with prevKg null; this keeps just the heaviest-weight
  // records against a real previous best.
  const prs = computeSessionRecords(completed, priorHistory)
    .filter(r => r.kind === "heaviest" && r.prevKg !== null)
    .sort((a, b) => b.valueKg - a.valueKg);
  if (prs.length > 0) {
    out.push({
      id: `pr:${completed.id}`,
      category: "pr",
      earnedAt,
      workoutId: completed.id,
      prs: prs.map(r => ({ exerciseName: r.exerciseName, valueKg: r.valueKg, prevKg: r.prevKg as number })),
    });
  }

  const count = priorHistory.length + 1;
  const key = `workouts:${count}`;
  if (WORKOUT_MILESTONES.includes(count) && !state.awarded.includes(key)) {
    out.push({ id: key, category: "workouts", earnedAt, workoutId: completed.id, count });
  }

  return out;
}

/**
 * The achievement for finishing `program`, where `weekReached` is the week it
 * was on when it ended (getCurrentWeek). Null when it ended early, or when this
 * run of it was already awarded. A re-activated program starts a new run
 * (new startDate), so finishing it again earns it again.
 */
export function detectProgramAchievement(
  program: SavedProgram,
  weekReached: number,
  state: AchievementsState,
  now: Date,
): Achievement | null {
  if (program.totalWeeks <= 0 || weekReached < program.totalWeeks) return null;
  const key = `program:${program.id}:${program.startDate}`;
  if (state.awarded.includes(key)) return null;
  return {
    id: key,
    category: "program",
    earnedAt: now.toISOString(),
    programId: program.id,
    programName: program.name,
    totalWeeks: program.totalWeeks,
  };
}

/** The achievement for an app-open streak reaching `days`, or null. */
export function detectStreakAchievement(days: number, now: Date): Achievement | null {
  if (!STREAK_MILESTONES.includes(days)) return null;
  const earnedAt = now.toISOString();
  return { id: `streak:${days}:${earnedAt}`, category: "streak", earnedAt, days };
}

/** Once-only milestones record their id; PRs and streaks can recur. */
function awardedKey(a: Achievement): string | null {
  return a.category === "workouts" || a.category === "program" ? a.id : null;
}

/**
 * `state` with `earned` added: each new achievement replaces the card in its
 * category, once-only milestones are remembered, and cards past
 * ACHIEVEMENT_CARD_DAYS are dropped. Never mutates its input.
 */
export function applyAchievements(state: AchievementsState, earned: Achievement[], now: Date): AchievementsState {
  const cutoff = now.getTime() - ACHIEVEMENT_CARD_DAYS * DAY_MS;
  let cards = state.cards.filter(c => Date.parse(c.earnedAt) >= cutoff);
  const awarded = new Set(state.awarded);
  for (const a of earned) {
    cards = [a, ...cards.filter(c => c.category !== a.category)];
    const key = awardedKey(a);
    if (key) awarded.add(key);
  }
  return { cards, awarded: [...awarded] };
}

/**
 * The cards Home shows right now, newest first: earned within
 * ACHIEVEMENT_CARD_DAYS and, for ones a workout earned, that workout still
 * exists. Deleting the session that set a PR takes its card with it.
 */
export function visibleAchievements(
  state: AchievementsState,
  historyIds: ReadonlySet<string>,
  now: Date,
): Achievement[] {
  const cutoff = now.getTime() - ACHIEVEMENT_CARD_DAYS * DAY_MS;
  return state.cards
    .filter(c => Date.parse(c.earnedAt) >= cutoff)
    .filter(c => !("workoutId" in c) || historyIds.has(c.workoutId))
    .sort((a, b) => Date.parse(b.earnedAt) - Date.parse(a.earnedAt));
}

/** When several are earned at once, the one the notification is about. */
const NOTIFY_PRIORITY: AchievementCategory[] = ["program", "workouts", "pr", "streak"];

export function pickHeadline(earned: Achievement[]): Achievement | null {
  for (const category of NOTIFY_PRIORITY) {
    const hit = earned.find(a => a.category === category);
    if (hit) return hit;
  }
  return null;
}

export type AchievementCopy = {
  /** Card title, one line. */
  title: string;
  /** Card subtitle, before the "Today" / "3 days ago" part. */
  detail: string;
  notifyTitle: string;
  notifyBody: string;
};

/** How many exercises a multi-PR notification names before summarising. */
const NOTIFY_NAME_LIMIT = 3;

/** "100 kg" / "220.5 lbs" from canonical kg. */
export function formatWeight(kg: number, isKg: boolean): string {
  return `${trimNumber(toDisplayWeight(kg, isKg), 1)} ${isKg ? "kg" : "lbs"}`;
}

/** One line per PR, for an expanded card: "100 kg, up from 97.5 kg". */
export function formatPRLine(pr: { valueKg: number; prevKg: number }, isKg: boolean): string {
  return `${formatWeight(pr.valueKg, isKg)}, up from ${formatWeight(pr.prevKg, isKg)}`;
}

export function describeAchievement(a: Achievement, isKg: boolean): AchievementCopy {
  switch (a.category) {
    case "pr": {
      // One PR reads as itself; several are counted in the title and named
      // underneath, so the card says WHAT happened without being tapped.
      if (a.prs.length === 1) {
        const pr = a.prs[0];
        return {
          title: `New PR on ${pr.exerciseName}`,
          detail: formatPRLine(pr, isKg),
          notifyTitle: "New personal record!",
          notifyBody: `${pr.exerciseName}: ${formatPRLine(pr, isKg)}.`,
        };
      }
      const named = a.prs.slice(0, NOTIFY_NAME_LIMIT)
        .map(pr => `${pr.exerciseName} ${formatWeight(pr.valueKg, isKg)}`)
        .join(", ");
      const rest = a.prs.length - NOTIFY_NAME_LIMIT;
      return {
        title: `${a.prs.length} new PRs`,
        detail: a.prs.map(pr => pr.exerciseName).join(", "),
        notifyTitle: `${a.prs.length} new personal records!`,
        notifyBody: rest > 0 ? `${named} and ${rest} more.` : `${named}.`,
      };
    }
    case "workouts":
      return {
        title: `${a.count} workouts logged`,
        detail: "Workout milestone",
        notifyTitle: `${a.count} workouts!`,
        notifyBody: `You've logged ${a.count} workouts. Keep it going.`,
      };
    case "program":
      return {
        title: `Finished ${a.programName}`,
        detail: `${a.totalWeeks}-week program complete`,
        notifyTitle: "Program complete!",
        notifyBody: a.totalWeeks === 1
          ? `You finished ${a.programName}. Great work.`
          : `You finished all ${a.totalWeeks} weeks of ${a.programName}. Great work.`,
      };
    case "streak":
      return {
        title: `${a.days}-day streak`,
        detail: "Streak milestone",
        notifyTitle: `${a.days}-day streak!`,
        notifyBody: `You've shown up ${a.days} days in a row. Keep it going.`,
      };
  }
}
