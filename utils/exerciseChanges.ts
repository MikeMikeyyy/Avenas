// utils/exerciseChanges.ts
//
// What a session changed about its program day, and how the cards say so
// (user request and design, 2026-10-13).
//
//   The Journal reads a session against ITS OWN plan (CompletedWorkout.plan,
//   the day's exercises in order when the session was set up): "Planned 2nd"
//   on an exercise done out of order, "Instead of Cable Fly" on a swap-in,
//   "Added" on one added in the session, and a "Skipped" row for one it left
//   out. The Journal card sums them up ("Order changed · 1 swap").
//
//   The Workout tab reads the LAST session of the day against today's plan,
//   one quiet line on each card it concerns: "Last session: done 1st", "Last
//   session: Pec Deck instead", "Last session: skipped" (always "Last
//   session", user decision, 2026-10-14: it was "Last week" for a session in
//   the week before and "Last time" otherwise). When the day has changed in
//   the builder since (its exercises or their order; sets, reps and weights
//   are programming, not a different day), last session followed another plan,
//   so there's nothing to say: next time starts fresh (user decision).
//
//   It also reads TODAY's session against its plan as it goes, the Journal's
//   way (user request, 2026-10-22): a card moved, swapped or added in the
//   session says so at once ("Planned 2nd", "Instead of Bench Press",
//   "Added"), in place of its "Last session" line.
//
// Every exercise done out of its planned place is marked, counted among the
// plan's exercises that were done, so one added or skipped shifts nothing
// (user report, 2026-10-30): move the 5th up to 3rd and the 3rd and 4th it
// went ahead of say "Planned 3rd" and "Planned 4th" beside its "Planned 5th";
// bring the 5th to the top and all five say so. Until then only the one
// moved and the one whose place it took said so (2026-10-22), and the 4th,
// slid down one, keeping quiet read as the line missing.
//
// A session saved before plans existed has no "Planned" or "Skipped" (there's
// nothing to read them against); its swaps and adds still show, a swap on the
// Workout tab only while its place still holds the exercise it replaced. One
// saved before places (no programExerciseId anywhere) says nothing at all.
//
// Pure: no RN imports, so scripts/verify-exercise-changes.ts can run it.

import type { CompletedExercise, CompletedWorkout, PlannedExercise, SavedProgram } from "../constants/programs";
import { indexOfDayId, workoutKey } from "./programDays";
import { sameExercise } from "./exerciseNames";

/** A day's exercises as a plan: each by its id and name (and which custom
 *  exercise of that name), in order. */
export function planOf(exercises: readonly { id: string; name: string; customId?: string }[]): PlannedExercise[] {
  return exercises.map(e => ({ id: e.id, name: e.name, ...(e.customId ? { customId: e.customId } : {}) }));
}

/** The plan `program` has for its day `dayId` right now, or undefined when
 *  there's no such training day (a free workout, a day since deleted). */
export function planForDay(program: SavedProgram | null | undefined, dayId: string | undefined): PlannedExercise[] | undefined {
  if (!program || !dayId) return undefined;
  const slot = indexOfDayId(program, dayId);
  if (slot < 0) return undefined;
  const label = program.cyclePattern[slot];
  if (!label || label === "Rest") return undefined;
  return planOf(program.workouts[workoutKey(slot, label)] ?? []);
}

/** The same exercises in the same order (by identity, utils/exerciseNames.ts).
 *  Sets, reps, weights and rest aren't in a plan, so changing them never makes
 *  two plans differ. */
export function samePlan(a: readonly PlannedExercise[], b: readonly PlannedExercise[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && sameExercise(p, b[i]));
}

/**
 * Which of `placed` (in the order done) are out of their planned place: the
 * k-th of them done isn't the plan's k-th of them.
 */
function outOfPlace(placed: readonly { idx: number; plannedIdx: number }[]): Set<number> {
  const byPlan = [...placed].sort((a, b) => a.plannedIdx - b.plannedIdx);
  return new Set(placed.filter((p, k) => byPlan[k] !== p).map(p => p.idx));
}

/** What one exercise of a session was, against the session's plan. */
export type SessionCue =
  | { kind: "moved"; /** Its place in the plan, from 1. */ plannedPosition: number }
  | { kind: "swapped"; /** The exercise the plan had there. */ from: string }
  | { kind: "added" };

export type SessionChanges = {
  /** One per session exercise, in order; null for one done as planned. */
  cues: (SessionCue | null)[];
  /** The plan's exercises the session left out, each drawn before session
   *  exercise `before` (its planned place; `exercises.length` = at the end). */
  skipped: { id: string; name: string; plannedPosition: number; before: number }[];
  counts: { moved: number; swapped: number; skipped: number; added: number };
};

/** What `w` changed about its program day, or null when there's nothing to
 *  read it against (a free or custom workout, a session from before places).
 *  A saved session, or the Workout tab's session still under way, whose
 *  exercises carry the same two fields until Finish writes them. */
export function sessionChanges(w: {
  dayId?: string;
  plan?: readonly PlannedExercise[];
  exercises: readonly Pick<CompletedExercise, "programExerciseId" | "swappedFrom">[];
}): SessionChanges | null {
  const plan = w.plan;
  if (!w.dayId || (!plan && !w.exercises.some(e => e.programExerciseId))) return null;
  const planIdx = new Map((plan ?? []).map((p, i) => [p.id, i]));
  const seen = new Set<string>();
  const placed: { idx: number; plannedIdx: number }[] = [];
  const cues: (SessionCue | null)[] = w.exercises.map((ex, idx) => {
    const pid = ex.programExerciseId;
    if (!pid || seen.has(pid) || (plan && !planIdx.has(pid))) return { kind: "added" };
    seen.add(pid);
    if (plan) placed.push({ idx, plannedIdx: planIdx.get(pid)! });
    return ex.swappedFrom ? { kind: "swapped", from: ex.swappedFrom } : null;
  });

  const moved = outOfPlace(placed);
  for (const p of placed) {
    // A swap-in that also moved says it was a swap: one line each.
    if (moved.has(p.idx) && cues[p.idx] === null) cues[p.idx] = { kind: "moved", plannedPosition: p.plannedIdx + 1 };
  }

  const skipped = (plan ?? []).flatMap((p, i) => {
    if (seen.has(p.id)) return [];
    const after = placed.filter(q => q.plannedIdx > i).map(q => q.idx);
    return [{ id: p.id, name: p.name, plannedPosition: i + 1, before: after.length ? Math.min(...after) : w.exercises.length }];
  });

  return {
    cues,
    skipped,
    counts: {
      moved: moved.size,
      swapped: cues.filter(c => c?.kind === "swapped").length,
      skipped: skipped.length,
      added: cues.filter(c => c?.kind === "added").length,
    },
  };
}

/** A session's changes in a few words, for its Journal card: "Order changed
 *  · 1 swap · 1 skipped · 1 added", or null for one done as planned. */
export function changesSummary(c: SessionChanges | null): string | null {
  if (!c) return null;
  const { moved, swapped, skipped, added } = c.counts;
  const parts = [
    moved > 0 ? "Order changed" : null,
    swapped > 0 ? `${swapped} swap${swapped === 1 ? "" : "s"}` : null,
    skipped > 0 ? `${skipped} skipped` : null,
    added > 0 ? `${added} added` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(" · ") : null;
}

/** What the Workout tab says on a card about the last session of the day. */
export type LastTimeCue =
  | { kind: "moved"; /** Where it was done, from 1. */ donePosition: number }
  | { kind: "swapped"; /** What was done in its place. */ to: string }
  | { kind: "skipped" };

/**
 * The last session of the day against today's `plan`, by program exercise id
 * (the place each card stands in). Empty when there's no last session, or the
 * day has changed in the builder since it (it followed another plan). An
 * exercise the last session added has no place today, so it's never named.
 */
export function lastTimeCues(
  last: CompletedWorkout | null,
  plan: readonly PlannedExercise[] | undefined,
): Record<string, LastTimeCue> {
  if (!last || !plan) return {};
  if (last.plan && !samePlan(last.plan, plan)) return {};
  const changes = sessionChanges(last);
  if (!changes) return {};
  const planAt = new Map(plan.map(p => [p.id, p]));
  const out: Record<string, LastTimeCue> = {};
  last.exercises.forEach((ex, idx) => {
    const cue = changes.cues[idx];
    const pid = ex.programExerciseId;
    if (!cue || !pid || !planAt.has(pid)) return;
    if (cue.kind === "swapped") {
      // With no plan to compare, the place must still hold the exercise the
      // swap replaced: the builder's Change keeps the place for another one.
      if (!last.plan && !sameExercise(planAt.get(pid), { name: cue.from, customId: ex.swappedFromId })) return;
      out[pid] = { kind: "swapped", to: ex.name };
    } else if (cue.kind === "moved") {
      out[pid] = { kind: "moved", donePosition: idx + 1 };
    }
  });
  for (const s of changes.skipped) {
    if (planAt.has(s.id)) out[s.id] = { kind: "skipped" };
  }
  return out;
}
