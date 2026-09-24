// utils/clientAchievements.ts
//
// The achievement cards a trainer sees above a client's Recent Activity: the
// same compact cards the client has on Home, rebuilt from the training the
// trainer can already read (migration 0032). Pure + RN-free, so
// scripts/verify-client-achievements.ts runs it under tsx.
//
// Rebuilt rather than read, because the client's own cards are local-only
// (@avenas/achievements never leaves their phone). Every rule is the one their
// phone applies: the same detect functions, the same one-card-per-category
// replacement, the same week-long expiry (utils/achievements.ts). What the
// rebuild has to supply is what their phone knew at the time, and it takes it
// from the record instead:
//   - "prior history" is every session completed before this one, which is
//     exactly what a workout finished live was compared against;
//   - "earned at" is when the session was completed, or the day a program was
//     marked complete (completedDate carries no time, so its start).
// A session logged after the fact is the one place the two can part: the
// client's phone compared it against everything logged by then, later sessions
// included, and dated its card the day it was logged.
//
// Streak cards are never rebuilt. The streak is the one thing here that stays
// on the client's phone (see the Privacy Policy), so a trainer has nothing to
// rebuild one from.
//
// Copy rule: no em dashes.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { ACHIEVEMENT_CARD_DAYS, EMPTY_ACHIEVEMENTS, type Achievement } from "../constants/achievements";
import {
  applyAchievements,
  detectProgramAchievement,
  detectWorkoutAchievements,
  visibleAchievements,
} from "./achievements";
import { parseStoredDate } from "./dates";

const DAY_MS = 86400000;

/**
 * The cards a client's Home would show `now`, newest first, from their workout
 * history and programs. Order of `history` doesn't matter; it's walked by
 * completion time.
 */
export function deriveClientAchievements(
  history: CompletedWorkout[],
  programs: SavedProgram[],
  now: Date,
): Achievement[] {
  const cutoff = now.getTime() - ACHIEVEMENT_CARD_DAYS * DAY_MS;
  const byTime = [...history].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  const earned: Achievement[] = [];

  // Only a session inside the card window can put a card on screen, but it's
  // measured against everything before it, however old.
  byTime.forEach((w, i) => {
    const at = Date.parse(w.completedAt);
    if (!(at >= cutoff)) return;
    earned.push(...detectWorkoutAchievements(w, byTime.slice(0, i), EMPTY_ACHIEVEMENTS, new Date(at)));
  });

  // A program's run ends with status "completed". currentWeek holds the week it
  // had reached, which is what decides it (finishing early earns nothing):
  // getCurrentWeek can't be asked, since it reports totalWeeks for any
  // completed program. An unparseable completedDate means no date to put on the
  // card, so no card, rather than a year-0 one.
  for (const p of programs) {
    if (p.status !== "completed") continue;
    const done = parseStoredDate(p.completedDate);
    if (!done) continue;
    const a = detectProgramAchievement(p, p.currentWeek, EMPTY_ACHIEVEMENTS, done);
    if (a) earned.push(a);
  }

  // Oldest first, so within a category the newest replaces the rest, exactly
  // as it did on their phone one save at a time.
  earned.sort((a, b) => Date.parse(a.earnedAt) - Date.parse(b.earnedAt));
  const state = applyAchievements(EMPTY_ACHIEVEMENTS, earned, now);
  return visibleAchievements(state, new Set(history.map(w => w.id)), now);
}
