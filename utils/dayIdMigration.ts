// utils/dayIdMigration.ts
//
// One-shot backfill that gives every program's cycle slots a stable `dayIds`
// entry and reattaches already-logged sessions to the slot they were performed
// on.
//
// Before this, a workout day was identified only by its name. Two days called
// "Upper" were indistinguishable, and renaming a day cut every logged session
// loose from it. Both are fixed going forward by `SavedProgram.dayIds` +
// `CompletedWorkout.dayId`; this module repairs the data that already exists.
//
// How an existing session is attributed, in order:
//   1. Exactly one slot in its program still carries the session's name → that
//      slot. The common case, and the most trustworthy signal there is.
//   2. Several slots share the name → the cycle math for the session's DATE
//      picks between them when it lands on one of them, else the first.
//   3. No slot carries the name (the day was renamed — "Upper" became
//      "Upper A") → the cycle math for the date, which doesn't care about
//      names at all. This is what stops a rename from orphaning history.
//   4. Nothing resolves → left alone. It falls back to name matching at query
//      time exactly as it does today; nothing is lost, nothing is invented.
//
// Free workouts (programId "") and sessions whose program is gone are skipped:
// they belong to no slot, so there is no id to give them.
//
// Safety: programs, history and the done-flag are written together via a single
// AsyncStorage.multiSet, so a crash can't leave the ids assigned but the history
// unattributed. Same pattern as utils/weightMigration.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PROGRAMS_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type SavedProgram,
} from "../constants/programs";
import { dayIdAt, ensureDayIds, normalizeDayName } from "./programDays";
import { cycleIndexForDate } from "./workout";

export const DAY_ID_MIGRATION_KEY = "@avenas/day_ids_migration_done";

/** Every program with a complete `dayIds` array. Pure. */
export function assignProgramDayIds(programs: SavedProgram[]): SavedProgram[] {
  return programs.map(ensureDayIds);
}

/** Cycle slots of `program` that are actual training days, with their ids. */
function trainingSlots(program: SavedProgram): { index: number; label: string; dayId: string }[] {
  const slots: { index: number; label: string; dayId: string }[] = [];
  program.cyclePattern.forEach((label, index) => {
    if (!label || normalizeDayName(label) === "rest") return;
    slots.push({ index, label, dayId: dayIdAt(program, index) });
  });
  return slots;
}

/**
 * The slot `w` was performed on, or null when it can't be determined.
 * Exported for the verify script — the precedence rules are the whole point of
 * this module, so they're worth asserting directly.
 */
export function resolveHistoricDayId(w: CompletedWorkout, program: SavedProgram): string | null {
  const slots = trainingSlots(program);
  if (slots.length === 0) return null;

  const wanted = normalizeDayName(w.workoutName ?? "");
  const named = slots.filter(s => normalizeDayName(s.label) === wanted);
  if (named.length === 1) return named[0].dayId;

  // Read the cycle math directly rather than resolveDayIndex: a hold placed on
  // the program AFTER this session was logged must not blank out which day it
  // was performed on.
  const idx = cycleIndexForDate(program, w.date);
  const dated = idx === null ? undefined : slots.find(s => s.index === idx);

  if (named.length > 1) {
    // Same name on several slots: trust the date when it points at one of them,
    // otherwise keep it deterministic and take the first.
    return dated && named.some(n => n.index === dated.index) ? dated.dayId : named[0].dayId;
  }
  // Renamed day — the name matches nothing, so the date is all we have.
  return dated ? dated.dayId : null;
}

/**
 * Stamp `dayId` on every history record that belongs to a program and doesn't
 * have one yet. Records that already carry a dayId, free workouts, and records
 * whose program is gone come back untouched. Pure.
 */
export function backfillHistoryDayIds(
  history: CompletedWorkout[],
  programs: SavedProgram[],
): CompletedWorkout[] {
  const byId = new Map(programs.map(p => [p.id, p]));
  return history.map(w => {
    if (w.dayId) return w;
    if (!w.programId) return w; // "" = free workout, undefined = unattributed legacy
    const program = byId.get(w.programId);
    if (!program) return w;
    const dayId = resolveHistoricDayId(w, program);
    return dayId ? { ...w, dayId } : w;
  });
}

/**
 * Run the backfill once. No-op after the first successful run. Safe to await at
 * startup before any screen reads programs or history.
 */
export async function runDayIdMigrationIfNeeded(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(DAY_ID_MIGRATION_KEY);
    if (done === "1") return;

    const [progRaw, histRaw] = await Promise.all([
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
    ]);

    const programs: SavedProgram[] = progRaw ? assignProgramDayIds(JSON.parse(progRaw)) : [];
    const pairs: [string, string][] = [];
    if (progRaw) pairs.push([PROGRAMS_KEY, JSON.stringify(programs)]);
    if (histRaw) {
      const history: CompletedWorkout[] = JSON.parse(histRaw);
      pairs.push([WORKOUT_HISTORY_KEY, JSON.stringify(backfillHistoryDayIds(history, programs))]);
    }
    pairs.push([DAY_ID_MIGRATION_KEY, "1"]);

    // Single batched write: ids, attributions and the flag commit together.
    await AsyncStorage.multiSet(pairs);
  } catch (e) {
    if (__DEV__) console.warn("[avenas] day id migration", e);
  }
}
