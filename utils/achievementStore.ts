// utils/achievementStore.ts
//
// The storage + delivery side of achievements: read the stored state, run the
// pure detection (utils/achievements.ts), write the result, then send ONE
// notification for the most notable thing earned. Every entry point is fire and
// forget and swallows its own errors, because none of them may ever break
// saving a workout, completing a program or opening the app.
//
// Local-only by design: cards last a week, so a new phone simply starts without
// last week's.

import {
  ACHIEVEMENTS_KEY,
  EMPTY_ACHIEVEMENTS,
  type Achievement,
  type AchievementsState,
} from "../constants/achievements";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import {
  applyAchievements,
  describeAchievement,
  detectProgramAchievement,
  detectStreakAchievement,
  detectWorkoutAchievements,
  pickHeadline,
} from "./achievements";
import { notifyAchievement } from "./notificationScheduler";
import { getJSON, setJSON } from "./storage";

function warn(op: string, err: unknown) {
  if (__DEV__) console.warn("[avenas]", op, ACHIEVEMENTS_KEY, err);
}

/** A PR card written before `prs` held every record: it carried the headline
 *  exercise plus a "plus N more" count. Rebuild it as a one-PR card rather than
 *  dropping it, so a card earned minutes before an update survives. */
type LegacyPRCard = { category: "pr"; exerciseName?: string; valueKg?: number; prevKg?: number };

function normalizeCard(card: Achievement): Achievement | null {
  if (card?.category !== "pr") return card ?? null;
  if (Array.isArray(card.prs) && card.prs.length > 0) return card;
  const legacy = card as unknown as LegacyPRCard;
  if (typeof legacy.exerciseName !== "string" || typeof legacy.valueKg !== "number" || typeof legacy.prevKg !== "number") {
    return null;
  }
  return { ...card, prs: [{ exerciseName: legacy.exerciseName, valueKg: legacy.valueKg, prevKg: legacy.prevKg }] };
}

export async function loadAchievements(): Promise<AchievementsState> {
  const raw = await getJSON<AchievementsState>(ACHIEVEMENTS_KEY, EMPTY_ACHIEVEMENTS);
  const cards = Array.isArray(raw?.cards) ? raw.cards : [];
  return {
    cards: cards.map(normalizeCard).filter((c): c is Achievement => c !== null),
    awarded: Array.isArray(raw?.awarded) ? raw.awarded : [],
  };
}

// Serialises every read -> detect -> write, so a streak milestone landing while
// a workout is saved can't overwrite the other's card.
let chain: Promise<unknown> = Promise.resolve();

function record(detect: (state: AchievementsState, now: Date) => Achievement[]): Promise<Achievement[]> {
  const run = chain.then(async () => {
    const state = await loadAchievements();
    const now = new Date();
    const earned = detect(state, now);
    if (earned.length > 0) await setJSON(ACHIEVEMENTS_KEY, applyAchievements(state, earned, now));
    return earned;
  });
  chain = run.catch(() => {});
  return run;
}

function notifyHeadline(earned: Achievement[], isKg: boolean) {
  const top = pickHeadline(earned);
  if (!top) return;
  const copy = describeAchievement(top, isKg);
  notifyAchievement(copy.notifyTitle, copy.notifyBody);
}

/** After a workout is saved. `priorHistory` is the history WITHOUT `completed`. */
export async function awardWorkoutAchievements(
  completed: CompletedWorkout,
  priorHistory: CompletedWorkout[],
  isKg: boolean,
): Promise<void> {
  try {
    const earned = await record((state, now) => detectWorkoutAchievements(completed, priorHistory, state, now));
    notifyHeadline(earned, isKg);
  } catch (e) {
    warn("awardWorkoutAchievements", e);
  }
}

/** After a program's status becomes "completed". `weekReached` = getCurrentWeek
 *  at the moment it ended. */
export async function awardProgramAchievement(program: SavedProgram, weekReached: number): Promise<void> {
  try {
    const earned = await record((state, now) => {
      const a = detectProgramAchievement(program, weekReached, state, now);
      return a ? [a] : [];
    });
    notifyHeadline(earned, true);
  } catch (e) {
    warn("awardProgramAchievement", e);
  }
}

/** When the app-open streak increments to `days`. */
export async function awardStreakAchievement(days: number): Promise<void> {
  try {
    const earned = await record((_state, now) => {
      const a = detectStreakAchievement(days, now);
      return a ? [a] : [];
    });
    notifyHeadline(earned, true);
  } catch (e) {
    warn("awardStreakAchievement", e);
  }
}
