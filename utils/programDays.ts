// utils/programDays.ts
//
// Stable identity for a program's workout days.
//
// A day used to be identified by its name, and by its position in the workouts
// map key (`${index}:${label}`). Both are wrong on their own:
//   - the NAME is not unique — a cycle can schedule "Upper" twice — and it
//     changes when the user renames the day, orphaning everything keyed to it;
//   - the INDEX is unique but moves when the cycle is reordered or resized.
//
// So every slot carries a `dayIds[i]` entry that is minted once and never
// changes: renaming rewrites `cyclePattern[i]`, reordering permutes both arrays
// together, and the id keeps pointing at the same day either way. Completed
// sessions record that id (`CompletedWorkout.dayId`), which is what keeps two
// same-named days' progress separate.
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-data-layer.ts).

import type {
  CompletedWorkout,
  Exercise,
  ProgramDayRef,
  SavedProgram,
  WorkoutMap,
} from "../constants/programs";

/** Trim + lowercase, the name-matching convention used across the codebase. */
export function normalizeDayName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Deterministic id for the slot at `index` of a program that predates `dayIds`.
 *
 * Deliberately derived from the position alone: two devices that run the
 * one-shot backfill independently (each holding its own copy of the same
 * pre-`dayIds` program) must agree on the ids, or one device's history would
 * point at slots the other never minted. Random ids only ever get handed to
 * slots created AFTER a program has a `dayIds` array, where no second device
 * can be inventing them in parallel.
 *
 * Only unique within one program — every match is program-scoped for that
 * reason (see workoutMatchesDay in utils/progressStats.ts).
 */
export function legacyDayId(index: number): string {
  return `d${index}`;
}

/** A fresh id for a newly created slot. */
export function makeDayId(): string {
  return `day_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `dayIds` grown/trimmed to `length`, preserving the entries already there.
 * A gap takes the deterministic positional id when that id is still free (the
 * legacy-program case: every slot is a gap, so the whole array comes out as
 * d0…dN), and a fresh random id otherwise (a slot appended to a program that
 * already has ids, where `d<index>` could collide with a reordered entry).
 */
export function normalizeDayIds(existing: string[] | undefined, length: number): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < length; i++) {
    const current = existing?.[i];
    if (current && !used.has(current)) {
      out.push(current);
      used.add(current);
      continue;
    }
    const positional = legacyDayId(i);
    const id = used.has(positional) || existing?.includes(positional) ? makeDayId() : positional;
    out.push(id);
    used.add(id);
  }
  return out;
}

/** The stable id of `program`'s slot at `index`, synthesizing the positional
 *  fallback for a program the backfill hasn't reached yet. */
export function dayIdAt(program: Pick<SavedProgram, "dayIds">, index: number): string {
  const id = program.dayIds?.[index];
  return id && id.length > 0 ? id : legacyDayId(index);
}

/** `program` with a complete `dayIds` array (length = cyclePattern.length).
 *  Returns the SAME object when nothing needed filling, so callers can use
 *  identity to decide whether a write is needed. */
export function ensureDayIds(program: SavedProgram): SavedProgram {
  const length = program.cyclePattern.length;
  const current = program.dayIds;
  if (current && current.length === length && current.every(id => !!id)) return program;
  return { ...program, dayIds: normalizeDayIds(current, length) };
}

/** The cycle index of the slot with `dayId`, or -1. */
export function indexOfDayId(program: SavedProgram, dayId: string): number {
  for (let i = 0; i < program.cyclePattern.length; i++) {
    if (dayIdAt(program, i) === dayId) return i;
  }
  return -1;
}

// ─── workouts-map keys ───────────────────────────────────────────────────────
//
// The map is keyed `${index}:${label}`. The INDEX is what makes a key unique —
// the label is carried for readability and is the reason a rename has to be
// handled explicitly everywhere below.

/** The workouts-map key for a slot. */
export function workoutKey(index: number, label: string): string {
  return `${index}:${label}`;
}

/** The display label of a day key ("3:Push" → "Push"). Splits on the FIRST
 *  colon and rejoins the rest, so a label containing ":" round-trips. */
export function dayLabel(key: string): string {
  return key.split(":").slice(1).join(":");
}

/** Split a day key into index + label, or null when it's malformed — so a
 *  re-key pass can skip it rather than writing "NaN:…" back into the map. */
export function parseDayKey(key: string): { idx: number; label: string } | null {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const idx = Number(key.slice(0, sep));
  if (!Number.isInteger(idx) || idx < 0) return null;
  return { idx, label: key.slice(sep + 1) };
}

/** One key per training day, in cycle order. An unnamed training day is keyed
 *  "Workout", matching what the builder saves. */
export function trainingDayKeys(names: string[], isTraining: boolean[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < isTraining.length; i++) {
    if (!isTraining[i]) continue;
    const label = (names[i] ?? "").trim() || "Workout";
    result.push(workoutKey(i, label));
  }
  return result;
}

/**
 * Rebuild `prev` onto the canonical keys for the current cycle, carrying every
 * day's exercises across by CYCLE INDEX.
 *
 * The label is part of the key, so renaming a day changes it ("0:Upper" →
 * "0:Upper A"). Looking the NEW key up in the old map therefore misses, and the
 * `?? []` behind that lookup silently empties the day — which is exactly how a
 * rename used to delete the exercises already added to it. Carrying by index
 * keeps them attached, because the index is the day's identity within a single
 * editing session (a reorder permutes the keys separately, before this runs).
 *
 * Every path that reloads or re-derives the builder's map goes through this:
 * the step-1 → step-2 hop, the three snapshot loads, the draft restore, and the
 * save. They disagreed before, and the one that didn't carry over won whenever
 * the builder was reopened mid-rename.
 */
export function canonicalizeWorkouts(
  prev: WorkoutMap,
  names: string[],
  isTraining: boolean[],
): WorkoutMap {
  const byIdx = new Map<number, Exercise[]>();
  for (const key of Object.keys(prev)) {
    const parsed = parseDayKey(key);
    if (parsed) byIdx.set(parsed.idx, prev[key] ?? []);
  }
  const next: WorkoutMap = {};
  for (const key of trainingDayKeys(names, isTraining)) {
    const parsed = parseDayKey(key);
    next[key] = prev[key] ?? (parsed ? byIdx.get(parsed.idx) : undefined) ?? [];
  }
  return next;
}

/**
 * Move the cycle slot at `from` to `to`, carrying everything that belongs to
 * that day: its Training/Rest flag, its stable id, and its exercises.
 *
 * Ids travel WITH the day, so a session logged against slot 3 still points at
 * that workout once it's dragged to slot 1 — moving a day is not an edit to the
 * day, and `forkChangedDayIds` sees no change to fork on.
 *
 * The workouts map has to be re-keyed because its keys embed the slot index.
 * Each key keeps its OWN label rather than having one rebuilt from
 * `cyclePattern`: a day whose stored label had drifted from the pattern would
 * otherwise look up a key that isn't there, and the `?? []` behind that lookup
 * would silently empty the day.
 *
 * Returns the input unchanged when the move is a no-op or out of range.
 */
export function reorderCycleSlots(
  from: number,
  to: number,
  cycle: {
    cyclePattern: string[];
    isTrainingDay: boolean[];
    dayIds: string[];
    workouts: WorkoutMap;
  },
): { cyclePattern: string[]; isTrainingDay: boolean[]; dayIds: string[]; workouts: WorkoutMap } {
  const length = cycle.cyclePattern.length;
  if (from === to || from < 0 || to < 0 || from >= length || to >= length) return cycle;
  const order = cycle.cyclePattern.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);

  const newIdxOf = new Map<number, number>();
  order.forEach((oldIdx, newIdx) => newIdxOf.set(oldIdx, newIdx));
  const workouts: WorkoutMap = {};
  for (const key of Object.keys(cycle.workouts)) {
    const parsed = parseDayKey(key);
    if (!parsed) continue;
    const newIdx = newIdxOf.get(parsed.idx);
    if (newIdx === undefined) continue;
    workouts[workoutKey(newIdx, parsed.label)] = cycle.workouts[key] ?? [];
  }

  return {
    cyclePattern: order.map(i => cycle.cyclePattern[i]),
    isTrainingDay: order.map(i => cycle.isTrainingDay[i]),
    dayIds: normalizeDayIds(order.map(i => cycle.dayIds[i]), order.length),
    workouts,
  };
}

/**
 * Every training day of `program`'s cycle, as identified refs in cycle order.
 *
 * Deliberately NOT deduped by name: a cycle that schedules "Upper" twice has two
 * distinct days with their own exercises, and every day picker used to collapse
 * them — which made the second one unreachable and sent a tap to the first.
 * Rest and unnamed slots are skipped.
 */
export function programDays(program: SavedProgram): ProgramDayRef[] {
  const refs: ProgramDayRef[] = [];
  program.cyclePattern.forEach((label, index) => {
    if (!label) return;
    if (normalizeDayName(label) === "rest") return;
    const dayId = dayIdAt(program, index);
    refs.push({
      key: `${program.id}::${dayId}`,
      dayId,
      index,
      label,
      programId: program.id,
      programName: program.name,
      programExercises: exerciseNamesOn(program, index, label),
      isHistorical: false,
      absorbsUnidentified: true,
      duplicateLabel: false,
    });
  });
  return markDayRefLabels(refs);
}

/** Normalized names of the exercises programmed on a slot right now. */
export function exerciseNamesOn(program: SavedProgram, index: number, label: string): string[] {
  return exercisesAt(program.workouts, index, label);
}

/**
 * Days that have logged sessions but no longer exist in any in-scope program's
 * cycle — deleted from the cycle, or forked away by `forkChangedDayIds`.
 *
 * Derived from history rather than stored on the program: a session's `dayId`
 * is the record of which day it was performed on, so a day with sessions can
 * always be reconstructed even though the program has moved on. That's what
 * keeps a renamed-and-rebuilt "Upper" visible next to the "Upper A" that
 * replaced it, instead of its sessions silently leaving the page.
 *
 * `workouts` must already be scoped (see filterByProgramScope). Sessions whose
 * program is gone are skipped — nothing to attribute them to.
 */
export function historicalDays(
  workouts: CompletedWorkout[],
  programs: SavedProgram[],
  liveRefs: ProgramDayRef[],
): ProgramDayRef[] {
  const live = new Set(liveRefs.map(r => r.key));
  const programById = new Map(programs.map(p => [p.id, p]));
  // key → the session that names it (most recent wins, so a day renamed twice
  // shows the last name it was actually logged under).
  const found = new Map<string, { programId: string; dayId: string; w: CompletedWorkout }>();
  for (const w of workouts) {
    if (!w.dayId || !w.programId) continue;
    const program = programById.get(w.programId);
    if (!program) continue;
    const key = `${w.programId}::${w.dayId}`;
    if (live.has(key)) continue;
    const prev = found.get(key);
    if (!prev || w.completedAt > prev.w.completedAt) {
      found.set(key, { programId: w.programId, dayId: w.dayId, w });
    }
  }
  return Array.from(found.entries()).map(([key, v]) => ({
    key,
    dayId: v.dayId,
    index: -1,
    label: v.w.workoutName,
    programId: v.programId,
    programName: programById.get(v.programId)?.name ?? "",
    programExercises: [],
    isHistorical: true,
    absorbsUnidentified: false,
    duplicateLabel: false,
  }));
}

/**
 * New `dayIds` for `after`, minting a fresh id for every slot whose day changed
 * identity: its name changed AND the set of exercises on it changed.
 *
 * Minting a new id detaches the slot from its logged sessions, which is the
 * point — those sessions keep the old id and resurface as a historical day (see
 * `historicalDays`), so the Progress page shows "Upper" alongside the "Upper A"
 * that replaced it rather than pooling two different workouts into one trend.
 *
 * Exactly one of the two conditions is never enough, deliberately:
 *   - renamed only ("Upper" → "Upper A", same exercises) is the same workout
 *     under a new label; the row simply relabels and its history follows.
 *   - exercises changed only is normal in-program tuning; the swapped-out
 *     exercise is flagged on the day rather than splitting it.
 *   - moving a day to another slot changes neither, so it never forks — ids
 *     travel with the day, and the Progress page doesn't care which cycle day a
 *     session fell on.
 *
 * "Exercises changed" compares the SET of exercise names. Editing sets, reps,
 * weight or rest is programming, not a different workout, and must not fork.
 */
export function forkChangedDayIds(
  before: { cyclePattern: string[]; dayIds: string[]; workouts: WorkoutMap },
  after: { cyclePattern: string[]; dayIds: string[]; workouts: WorkoutMap },
): string[] {
  const beforeById = new Map<string, { label: string; exercises: string[] }>();
  before.cyclePattern.forEach((label, i) => {
    const id = before.dayIds[i];
    if (!id || !label || normalizeDayName(label) === "rest") return;
    beforeById.set(id, { label, exercises: exercisesAt(before.workouts, i, label) });
  });

  return after.dayIds.map((id, i) => {
    const label = after.cyclePattern[i];
    if (!id || !label || normalizeDayName(label) === "rest") return id;
    const was = beforeById.get(id);
    if (!was) return id; // a slot that didn't exist before — nothing to fork from
    if (normalizeDayName(was.label) === normalizeDayName(label)) return id;
    return sameNameSet(was.exercises, exercisesAt(after.workouts, i, label)) ? id : makeDayId();
  });
}

/** Normalized exercise names on a slot. The label is normalized the way
 *  `trainingDayKeys` writes it, so an untrimmed pattern entry still finds its
 *  own exercises instead of reading as an empty day (which would look like
 *  every exercise changed). */
function exercisesAt(workouts: WorkoutMap, index: number, label: string): string[] {
  const key = workoutKey(index, label.trim() || "Workout");
  return (workouts[key] ?? []).map(e => normalizeDayName(e.name)).filter(n => n.length > 0);
}

/** Do two exercise-name lists hold the same names? Order-independent, and
 *  duplicate-count sensitive (two rows of "Bench Press" is not one). */
function sameNameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((n, i) => n === sortedB[i]);
}

/**
 * `programDays` plus the program's `extraWorkouts` — free workouts the user
 * chose to attach to it. Those have no cycle slot (index -1, id `extra:<name>`)
 * and are deduped by name, since a name is the only identity they have.
 *
 * Only for surfaces that report on what was *logged* (the Progress day list).
 * Day pickers offer the cycle, so they use `programDays`.
 */
export function programDaysWithExtras(program: SavedProgram): ProgramDayRef[] {
  const refs = programDays(program);
  const seen = new Set(refs.map(r => normalizeDayName(r.label)));
  for (const label of program.extraWorkouts ?? []) {
    if (!label) continue;
    const k = normalizeDayName(label);
    if (k === "rest" || seen.has(k)) continue;
    seen.add(k);
    const dayId = `extra:${k}`;
    refs.push({
      key: `${program.id}::${dayId}`,
      dayId,
      index: -1,
      label,
      programId: program.id,
      programName: program.name,
      // A free workout has no prescription, so nothing logged on it can be
      // "swapped out" — leaving this empty suppresses that marker.
      programExercises: [],
      isHistorical: false,
      absorbsUnidentified: true,
      duplicateLabel: false,
    });
  }
  return markDayRefLabels(refs);
}

/**
 * Finalize `absorbsUnidentified` / `duplicateLabel` across a complete day list.
 * First occurrence of a label absorbs the sessions that carry no `dayId`; every
 * occurrence after the first marks the label as duplicated so both rows can be
 * qualified in the UI.
 */
export function markDayRefLabels(refs: ProgramDayRef[]): ProgramDayRef[] {
  const firstOf = new Map<string, number>();
  refs.forEach((r, i) => {
    const k = normalizeDayName(r.label);
    if (!firstOf.has(k)) firstOf.set(k, i);
  });
  const counts = new Map<string, number>();
  for (const r of refs) {
    const k = normalizeDayName(r.label);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return refs.map((r, i) => {
    const k = normalizeDayName(r.label);
    return {
      ...r,
      absorbsUnidentified: firstOf.get(k) === i,
      duplicateLabel: (counts.get(k) ?? 0) > 1,
    };
  });
}
