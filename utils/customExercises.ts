// utils/customExercises.ts
//
// Your own custom exercises: which are live, which one an exercise is, and what
// deleting one does (user request, 2026-10-15).
//
//   * IDENTITY. One made from now on has an id (`CustomExercise.id`), recorded
//     on every program day and logged session that uses it (`customId`), so a
//     deleted exercise and a new one later given its name are two exercises:
//     the new one starts with no history, "last time" numbers, chart, records
//     or star. One made before ids is known by its name, as it always was, so
//     nothing logged before needed rewriting (utils/exerciseNames.ts
//     exerciseIdentity).
//   * DELETING keeps what was logged and ends its use. It stays in the list,
//     hidden (`deletedAt`): out of the picker and the slots, but still what its
//     sessions are read with (their muscles on the radar, its steps). It comes
//     out of every program (withoutCustomExercise), and its photo, video and
//     star go (utils/customExerciseStore.ts).
//
// Pure, so scripts/verify-custom-identity.ts covers it.

import type { CustomExercise } from "../constants/exercises";
import type { WorkoutMap } from "../constants/programs";
import type { ExerciseRef } from "./exerciseNames";

/** A custom exercise's own name is matched as typed: trimmed, any case. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isLive(c: CustomExercise): boolean {
  return !c.deletedAt;
}

/** The ones you can pick, edit and delete, and that take your slots. */
export function liveCustoms(list: CustomExercise[]): CustomExercise[] {
  return list.filter(isLive);
}

let seq = 0;
/** A new custom exercise's id: unique on this phone and, with the random tail,
 *  across an account's phones. */
export function newCustomId(now: number = Date.now()): string {
  seq = (seq + 1) % 1296;
  return `cx${now.toString(36)}${seq.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The custom exercise an exercise is, a deleted one included (its sessions are
 * still read with it): by its id when it has one, else the one of its name made
 * before ids, a live one before a deleted one. Undefined for a catalogue
 * exercise or a name nobody has.
 */
export function customFor(ex: ExerciseRef, customs: CustomExercise[]): CustomExercise | undefined {
  if (ex.customId) return customs.find(c => c.id === ex.customId);
  const named = customs.filter(c => !c.id && sameName(c.name, ex.name));
  return named.find(isLive) ?? named[0];
}

/** Whether `ex` is a custom exercise that has been deleted. */
export function isDeletedExercise(ex: ExerciseRef, customs: CustomExercise[]): boolean {
  return !!customFor(ex, customs)?.deletedAt;
}

/**
 * The custom id an exercise picked by name gets: your live exercise of that
 * name, else a trainer's carried one (the picker offers each name once). None
 * for the catalogue, or for one made before ids.
 */
export function customIdForName(name: string, own: CustomExercise[], carried: CustomExercise[] = []): string | undefined {
  const mine = own.find(c => isLive(c) && sameName(c.name, name));
  if (mine) return mine.id;
  return carried.find(c => !c.deletedAt && sameName(c.name, name))?.id;
}

/**
 * Whether a program exercise is `target`: by its id when it has one; one made
 * before ids by its name, on rows that are your own, not a trainer's exercise
 * of that name carried with a program (`customDetails`).
 */
export function isThisCustom(
  ex: { name: string; customId?: string; customDetails?: unknown },
  target: CustomExercise,
): boolean {
  if (target.id) return ex.customId === target.id;
  return !ex.customId && !ex.customDetails && sameName(ex.name, target.name);
}

/** The days with `target` taken out of them, and the same object back when it
 *  wasn't in any, so a caller can tell. */
export function withoutCustomExercise(workouts: WorkoutMap, target: CustomExercise): WorkoutMap {
  let changed = false;
  const next: WorkoutMap = {};
  for (const [key, list] of Object.entries(workouts)) {
    if (!Array.isArray(list)) { next[key] = list; continue; }
    const kept = list.filter(ex => !isThisCustom(ex, target));
    if (kept.length !== list.length) changed = true;
    next[key] = kept.length !== list.length ? kept : list;
  }
  return changed ? next : workouts;
}

/** The days with every row of `target` under its new `name` (a rename on
 *  create-custom-exercise), and the same object back when it had none. */
export function withRenamedCustom(workouts: WorkoutMap, target: CustomExercise, name: string): WorkoutMap {
  let changed = false;
  const next: WorkoutMap = {};
  for (const [key, list] of Object.entries(workouts)) {
    if (!Array.isArray(list)) { next[key] = list; continue; }
    let dayChanged = false;
    const out = list.map(ex => {
      if (ex.name === name || !isThisCustom(ex, target)) return ex;
      dayChanged = true;
      return { ...ex, name };
    });
    next[key] = dayChanged ? out : list;
    changed ||= dayChanged;
  }
  return changed ? next : workouts;
}

/**
 * The days with each row of one of your live exercises (by its id) under the
 * exercise's current name, and the same object back when none needed it. The
 * builder holds its days in memory while an exercise is renamed from its
 * picker, and would otherwise save the old name back. One made before ids
 * can't be told from its old name here; the rename's cascade has those.
 */
export function withCurrentCustomNames(workouts: WorkoutMap, customs: CustomExercise[]): WorkoutMap {
  const names = new Map<string, string>();
  for (const c of customs) if (c.id && isLive(c)) names.set(c.id, c.name);
  if (names.size === 0) return workouts;
  let changed = false;
  const next: WorkoutMap = {};
  for (const [key, list] of Object.entries(workouts)) {
    if (!Array.isArray(list)) { next[key] = list; continue; }
    let dayChanged = false;
    const out = list.map(ex => {
      const name = ex.customId ? names.get(ex.customId) : undefined;
      if (!name || name === ex.name) return ex;
      dayChanged = true;
      return { ...ex, name };
    });
    next[key] = dayChanged ? out : list;
    changed ||= dayChanged;
  }
  return changed ? next : workouts;
}

/** What's kept of a deleted exercise: what its sessions are read with (name,
 *  muscles, steps). Its photo and video are deleted with it. */
export function tombstoneOf(c: CustomExercise, today: string): CustomExercise {
  return {
    ...(c.id ? { id: c.id } : {}),
    name: c.name,
    muscles: c.muscles,
    ...(c.steps && c.steps.length > 0 ? { steps: c.steps } : {}),
    ...(c.description ? { description: c.description } : {}),
    deletedAt: today,
  };
}

/** The live exercise of this name (live names are unique), with its place in
 *  the list. */
export function liveIndexOf(customs: CustomExercise[], name: string): number {
  return customs.findIndex(c => isLive(c) && sameName(c.name, name));
}

/** Whether another of your live exercises already has this name. A deleted
 *  one's name is free: the new exercise is a new one. */
export function customNameTaken(name: string, customs: CustomExercise[], editingIndex = -1): boolean {
  return customs.some((c, i) => i !== editingIndex && isLive(c) && sameName(c.name, name));
}
