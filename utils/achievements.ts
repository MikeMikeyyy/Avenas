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
  EMPTY_ACHIEVEMENTS,
  isStreakMilestone,
  WORKOUT_MILESTONES,
  type Achievement,
  type AchievementCategory,
  type AchievementsState,
} from "../constants/achievements";
import { computeSessionRecords } from "./workoutSummary";
import { exerciseIdentity } from "./exerciseNames";
import { toDisplayWeight, trimNumber } from "./units";

const DAY_MS = 86400000;

/** A number typed or stored on a set, or 0 for anything not above zero. */
function positive(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The heaviest each exercise has been lifted in `history`, in kg, by identity
 * (exerciseIdentity): a working set ticked with its reps in, at a weight. It's
 * what a set has to beat to be a PR, the same best the PR card measures
 * (computePRs' heaviest). An exercise done only at bodyweight, or never, has
 * none: its first weighted set is a first, not a PR.
 */
export function bestLiftsBefore(history: readonly CompletedWorkout[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const w of history) {
    for (const ex of w.exercises) {
      const key = ex.name ? exerciseIdentity(ex) : "";
      if (!key) continue;
      for (const s of ex.sets) {
        if (s.type !== "working" || !s.done || positive(s.reps) === 0) continue;
        const kg = positive(s.weight);
        if (kg > (best.get(key) ?? 0)) best.set(key, kg);
      }
    }
  }
  return best;
}

/**
 * Whether one set is a new PR, for the trophy beside its number on the Workout
 * tab (user request, 2026-10-22): a working set, ticked, with its reps in,
 * heavier than `bestKg`, its exercise's best from before this workout
 * (bestLiftsBefore). No best, none at all. Every set that beats the old best
 * gets one, so 102.5 then 105 over a best of 100 is two.
 */
export function isPrSet(
  set: { type: "warmup" | "working"; done: boolean; reps: string; weightKg: number },
  bestKg: number | undefined,
): boolean {
  return bestKg !== undefined && set.type === "working" && set.done && positive(set.reps) > 0 && set.weightKg > bestKg;
}

/**
 * Which of a SAVED workout's sets wear the PR trophy: per exercise, each set
 * in saved order, against the sessions completed before it
 * (achievementsForWorkout's prior), so a heavier session since never takes a
 * trophy away. `history` may include `workout` itself. An unreadable
 * completedAt has nothing before it, so no trophies.
 */
export function prSetsOfWorkout(workout: CompletedWorkout, history: readonly CompletedWorkout[]): boolean[][] {
  const at = Date.parse(workout.completedAt);
  const best = bestLiftsBefore(
    Number.isFinite(at) ? history.filter(w => w.id !== workout.id && Date.parse(w.completedAt) < at) : [],
  );
  return workout.exercises.map(ex => {
    const bestKg = ex.name ? best.get(exerciseIdentity(ex)) : undefined;
    return ex.sets.map(s => isPrSet({ type: s.type, done: s.done, reps: s.reps, weightKg: positive(s.weight) }, bestKg));
  });
}

/**
 * For every workout in `history`, one exercise's best (by identity,
 * exerciseIdentity) from the sessions completed before it: what
 * prSetsOfWorkout measures that exercise's sets against, worked out for a whole
 * history in one pass, for a page listing every session of one exercise (the
 * Exercise History page's trophies). As there, sessions finished at the same
 * moment don't count each other, and one with an unreadable completedAt has no
 * best (no trophies) and counts towards no other's. Undefined: nothing to beat.
 */
export function bestBeforeEach(history: readonly CompletedWorkout[], identity: string): Map<string, number | undefined> {
  const ownBest = (w: CompletedWorkout): number => {
    let kg = 0;
    for (const ex of w.exercises) {
      if (!ex.name || exerciseIdentity(ex) !== identity) continue;
      for (const s of ex.sets) {
        if (s.type === "working" && s.done && positive(s.reps) > 0) kg = Math.max(kg, positive(s.weight));
      }
    }
    return kg;
  };
  const timed = history
    .map(w => ({ w, at: Date.parse(w.completedAt) }))
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  const out = new Map<string, number | undefined>();
  let best = 0;
  for (let i = 0; i < timed.length;) {
    let j = i;
    while (j < timed.length && timed[j].at === timed[i].at) j++;
    for (let k = i; k < j; k++) out.set(timed[k].w.id, best > 0 ? best : undefined);
    for (let k = i; k < j; k++) best = Math.max(best, ownBest(timed[k].w));
    i = j;
  }
  return out;
}

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
 * `state` with a workout milestone's card given to `completed`, when the
 * session it was on has been deleted and `completed` reaches that count again
 * (Delete & Redo, or the next session after a delete). The milestone was
 * announced once and isn't again (`awarded`), but its card went with the
 * deleted session and never came back, while a trainer's rebuild
 * (utils/clientAchievements.ts) shows it on the new one (user request,
 * 2026-10-16: deleting and redoing a workout mustn't lose anything). It keeps
 * the week it was earned in. `state` itself otherwise; `priorHistory` as for
 * detectWorkoutAchievements.
 */
export function withMilestoneCardMoved(
  state: AchievementsState,
  completed: CompletedWorkout,
  priorHistory: CompletedWorkout[],
): AchievementsState {
  const key = `workouts:${priorHistory.length + 1}`;
  const card = state.cards.find(c => c.id === key);
  if (!card || card.category !== "workouts" || card.workoutId === completed.id) return state;
  if (priorHistory.some(w => w.id === card.workoutId)) return state;
  return { ...state, cards: state.cards.map(c => (c.id === key ? { ...card, workoutId: completed.id } : c)) };
}

/**
 * What `workout` earned when it was saved: its PRs, and the workout milestone
 * if it was one. Measured against every session completed BEFORE it, which is
 * what a workout finished live was compared against (the rebuild
 * utils/clientAchievements.ts does), so a session keeps showing what it earned
 * at the time rather than what it would earn against today's history. The
 * workout detail screen and the program page both read it. `history` may
 * include `workout` itself; it's left out. An unreadable completedAt earns
 * nothing rather than throwing.
 */
export function achievementsForWorkout(workout: CompletedWorkout, history: CompletedWorkout[]): Achievement[] {
  const at = Date.parse(workout.completedAt);
  if (!Number.isFinite(at)) return [];
  const prior = history.filter(w => w.id !== workout.id && Date.parse(w.completedAt) < at);
  return detectWorkoutAchievements(workout, prior, EMPTY_ACHIEVEMENTS, new Date(at));
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
  if (!isStreakMilestone(days)) return null;
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
