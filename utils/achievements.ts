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
//   Rep PR    more reps than ever at a weight done before (utils/repPrs.ts,
//             user request 2026-11-14). Its own card, earned only by a
//             session with no weight PR, and never a notification: rep PRs
//             come most weeks, and a notification after almost every
//             session is what the PR rule above was written to end.
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
  type RepPRDetail,
} from "../constants/achievements";
import { computeSessionRecords, isRepRecord } from "./workoutSummary";
import { exerciseIdentity } from "./exerciseNames";
import { isAssistedIdentity, liftBeats } from "./assisted";
import { toDisplayWeight, trimNumber } from "./units";

const DAY_MS = 86400000;

/** A number typed or stored on a set, or 0 for anything not above zero. */
function positive(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Of two weights an exercise has been done at, the better: the heavier, or
 *  for an assisted exercise the less help (utils/assisted.ts). 0 is none. */
function betterOf(a: number, b: number, assisted: boolean): number {
  if (a <= 0) return b;
  if (b <= 0) return a;
  return liftBeats(a, b, assisted) ? a : b;
}

/**
 * The best each exercise has been lifted at in `history`, in kg, by identity
 * (exerciseIdentity): a working set ticked with its reps in, at a weight. The
 * heaviest, or for an assisted exercise the least assistance. It's what a set
 * has to beat to be a PR, the same best the PR card measures (computePRs'
 * heaviest). An exercise done only at bodyweight, or never, has none: its
 * first weighted set is a first, not a PR.
 */
export function bestLiftsBefore(history: readonly CompletedWorkout[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const w of history) addBestLifts(best, w);
  return best;
}

/** `w`'s sets added to `best`: bestLiftsBefore one session at a time. */
function addBestLifts(best: Map<string, number>, w: CompletedWorkout): void {
  for (const ex of w.exercises) {
    const key = ex.name ? exerciseIdentity(ex) : "";
    if (!key) continue;
    const assisted = isAssistedIdentity(key);
    for (const s of ex.sets) {
      if (s.type !== "working" || !s.done || positive(s.reps) === 0) continue;
      const kg = positive(s.weight);
      const next = betterOf(kg, best.get(key) ?? 0, assisted);
      if (next > 0) best.set(key, next);
    }
  }
}

/** A set as the PR trophy reads it: its kind, whether it's ticked, its reps
 *  as typed, and its weight in kg. */
export type PrSetInput = { type: "warmup" | "working"; done: boolean; reps: string; weightKg: number };

/**
 * Whether one set beats its exercise's best from before this workout
 * (`bestKg`, bestLiftsBefore): a working set, ticked, with its reps in, at a
 * weight better than it: heavier, or for an `assisted` exercise less help. No
 * best, none at all. Which of these wears the trophy is prTrophySets': one
 * per exercise.
 */
export function isPrSet(set: PrSetInput, bestKg: number | undefined, assisted = false): boolean {
  return bestKg !== undefined && set.type === "working" && set.done && positive(set.reps) > 0
    && set.weightKg > 0 && liftBeats(set.weightKg, bestKg, assisted);
}

/**
 * Which of a session's sets wear the PR trophy beside their number (user
 * decision, 2026-11-05): ONE per exercise, the first set, in the session's
 * order, at the heaviest weight that beat its best (isPrSet). A later set at
 * that weight only matches the record, and a heavier one takes the trophy
 * from it: 75 then 75 over a best of 70 is the first 75's, 75 then 78 the
 * 78's. So the trophies mark the records the session leaves, the PR card's.
 * An assisted exercise's is the set at the least assistance (utils/assisted.ts):
 * 25 then 20 over a best of 30 is the 20's.
 * By identity, so an exercise done on two cards is one. It was every set over
 * the old best until then, my call, never the user's. `bestOf`: an exercise's
 * best from before the session, undefined for none.
 */
export function prTrophySets(
  exercises: readonly { identity: string; sets: readonly PrSetInput[] }[],
  bestOf: (identity: string) => number | undefined,
): boolean[][] {
  const bestOfEx = (identity: string) => (identity ? bestOf(identity) : undefined);
  const prOf = (identity: string, s: PrSetInput) => isPrSet(s, bestOfEx(identity), isAssistedIdentity(identity));
  const top = new Map<string, number>();
  for (const ex of exercises) {
    const assisted = isAssistedIdentity(ex.identity);
    for (const s of ex.sets) {
      if (prOf(ex.identity, s)) top.set(ex.identity, betterOf(s.weightKg, top.get(ex.identity) ?? 0, assisted));
    }
  }
  const worn = new Set<string>();
  return exercises.map(ex => ex.sets.map(s => {
    if (worn.has(ex.identity) || s.weightKg !== top.get(ex.identity) || !prOf(ex.identity, s)) return false;
    worn.add(ex.identity);
    return true;
  }));
}

/**
 * Which of a SAVED workout's sets wear the PR trophy (prTrophySets): per
 * exercise, each set in saved order, against the sessions completed before it
 * (achievementsForWorkout's prior), so a heavier session since never takes a
 * trophy away. `history` may include `workout` itself. An unreadable
 * completedAt has nothing before it, so no trophies.
 */
export function prSetsOfWorkout(workout: CompletedWorkout, history: readonly CompletedWorkout[]): boolean[][] {
  const at = Date.parse(workout.completedAt);
  const best = bestLiftsBefore(
    Number.isFinite(at) ? history.filter(w => w.id !== workout.id && Date.parse(w.completedAt) < at) : [],
  );
  return prTrophySets(trophyInputs(workout), identity => best.get(identity));
}

/** A saved workout's exercises as the trophy reads them, in saved order. */
function trophyInputs(workout: CompletedWorkout): { identity: string; sets: PrSetInput[] }[] {
  return workout.exercises.map(ex => ({
    identity: ex.name ? exerciseIdentity(ex) : "",
    sets: ex.sets.map(s => ({ type: s.type, done: s.done, reps: s.reps, weightKg: positive(s.weight) })),
  }));
}

/**
 * How many trophies a whole history wears: every session's prSetsOfWorkout,
 * worked out in one pass, for the Journal's Your Training card
 * (utils/trainingTotals.ts), whose PR count must be the marks the sessions
 * show. As there, sessions finished at the same moment don't count each other,
 * and one with an unreadable completedAt wears none and counts towards no
 * other's.
 */
export function countTrophies(history: readonly CompletedWorkout[]): number {
  const timed = history
    .map(w => ({ w, at: Date.parse(w.completedAt) }))
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  const best = new Map<string, number>();
  let count = 0;
  for (let i = 0; i < timed.length;) {
    let j = i;
    while (j < timed.length && timed[j].at === timed[i].at) j++;
    for (let k = i; k < j; k++) {
      for (const row of prTrophySets(trophyInputs(timed[k].w), identity => best.get(identity))) {
        for (const worn of row) if (worn) count++;
      }
    }
    for (let k = i; k < j; k++) addBestLifts(best, timed[k].w);
    i = j;
  }
  return count;
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
  // The heaviest, or for an assisted exercise the least help (bestLiftsBefore).
  const assisted = isAssistedIdentity(identity);
  const ownBest = (w: CompletedWorkout): number => {
    let kg = 0;
    for (const ex of w.exercises) {
      if (!ex.name || exerciseIdentity(ex) !== identity) continue;
      for (const s of ex.sets) {
        if (s.type === "working" && s.done && positive(s.reps) > 0) kg = betterOf(positive(s.weight), kg, assisted);
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
    for (let k = i; k < j; k++) best = betterOf(ownBest(timed[k].w), best, assisted);
    i = j;
  }
  return out;
}

/**
 * PR (or else rep PR) and workout-milestone achievements earned by saving
 * `completed`.
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
  const records = computeSessionRecords(completed, priorHistory);
  const prs = records
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
  } else {
    // Rep PRs (utils/repPrs.ts) are a session's card only when it set no
    // weight PR, and a card of their own, so they never take a weight PR's
    // away (user decision, 2026-11-14: rep PRs keep Home quiet).
    const repPrs = records.filter(isRepRecord);
    if (repPrs.length > 0) {
      out.push({
        id: `reps:${completed.id}`,
        category: "reps",
        earnedAt,
        workoutId: completed.id,
        repPrs: repPrs.map(r => ({
          exerciseName: r.exerciseName, weightKg: r.valueKg, reps: r.reps, prevReps: r.prevReps,
          ...(r.hold ? { hold: true as const } : {}), ...(r.assisted ? { assisted: true as const } : {}),
        })),
      });
    }
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

/** When several are earned at once, the one the notification is about. Rep
 *  PRs aren't here: they never notify (see the rules at the top). */
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

/** One line per PR, for an expanded card: "100 kg, up from 97.5 kg". An
 *  assisted exercise's record is LESS than the one it beat (utils/assisted.ts),
 *  and that's how one is told: "20 kg assistance, down from 25 kg". The card
 *  stores only the two weights, and a PR is never a tie, so they always say. */
export function formatPRLine(pr: { valueKg: number; prevKg: number }, isKg: boolean): string {
  return pr.valueKg < pr.prevKg
    ? `${formatWeight(pr.valueKg, isKg)} assistance, down from ${formatWeight(pr.prevKg, isKg)}`
    : `${formatWeight(pr.valueKg, isKg)}, up from ${formatWeight(pr.prevKg, isKg)}`;
}

/** A count of reps or seconds as typed: "9", "8.5". */
const count = (n: number) => trimNumber(n, 1);

/** One rep PR's line, for its card: "9 reps at 80 kg, up from 8"; at
 *  bodyweight "12 reps, up from 10"; assisted "9 reps with 20 kg assistance,
 *  up from 8"; a hold "60 s at 20 kg, up from 45 s" ("60 s, up from 45 s"). */
export function formatRepPRLine(
  r: Pick<RepPRDetail, "weightKg" | "reps" | "prevReps" | "hold" | "assisted">,
  isKg: boolean,
): string {
  const done = r.hold ? `${count(r.reps)} s` : `${count(r.reps)} ${r.reps === 1 ? "rep" : "reps"}`;
  const at = r.weightKg <= 0 ? ""
    : r.assisted ? ` with ${formatWeight(r.weightKg, isKg)} assistance` : ` at ${formatWeight(r.weightKg, isKg)}`;
  return `${done}${at}, up from ${r.hold ? `${count(r.prevReps)} s` : count(r.prevReps)}`;
}

/** A rep PR's set, short, where its record is shown beside it (the
 *  post-workout summary, the workout page): "80 kg × 9", "12 reps" at
 *  bodyweight; a hold "20 kg, 60 s" or "60 s". An assisted one's weight is
 *  its help, as it was logged. */
export function formatRepSet(r: Pick<RepPRDetail, "weightKg" | "reps" | "hold">, isKg: boolean): string {
  if (r.hold) return r.weightKg > 0 ? `${formatWeight(r.weightKg, isKg)}, ${count(r.reps)} s` : `${count(r.reps)} s`;
  return r.weightKg > 0 ? `${formatWeight(r.weightKg, isKg)} × ${count(r.reps)}` : `${count(r.reps)} ${r.reps === 1 ? "rep" : "reps"}`;
}

/** How much a rep PR beat the most before by: "1 rep", "2 reps", "15 s". */
export function formatRepGain(r: Pick<RepPRDetail, "reps" | "prevReps" | "hold">): string {
  const more = r.reps - r.prevReps;
  return r.hold ? `${count(more)} s` : `${count(more)} ${more === 1 ? "rep" : "reps"}`;
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
    case "reps": {
      // Never sent (NOTIFY_PRIORITY), but said the way the card says it.
      if (a.repPrs.length === 1) {
        const r = a.repPrs[0];
        const kind = r.hold ? "hold" : "rep";
        return {
          title: `New ${kind} PR on ${r.exerciseName}`,
          detail: formatRepPRLine(r, isKg),
          notifyTitle: `New ${kind} PR!`,
          notifyBody: `${r.exerciseName}: ${formatRepPRLine(r, isKg)}.`,
        };
      }
      const kind = a.repPrs.every(r => r.hold) ? "hold" : "rep";
      const named = a.repPrs.slice(0, NOTIFY_NAME_LIMIT).map(r => r.exerciseName).join(", ");
      const rest = a.repPrs.length - NOTIFY_NAME_LIMIT;
      return {
        title: `${a.repPrs.length} new ${kind} PRs`,
        detail: a.repPrs.map(r => r.exerciseName).join(", "),
        notifyTitle: `${a.repPrs.length} new ${kind} PRs!`,
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
