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
// The exercises that MOVED are marked, not every one whose number changed:
// the ones outside the longest run still in the plan's order (of a swapped
// pair, the one done earlier than planned), and with each, the one whose
// place it took, the exercise the plan had where it was done (user request,
// 2026-10-22: move the 5th up to 4th and the 4th says "Planned 4th" too, so
// you can see what it traded places with). The others a long move shifted
// along by one keep quiet: bring the 5th to the top and only it and the 1st
// say so, not the four that slid down.
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
 * Which of `placed` (in the order done) moved: everything outside the longest
 * run still in plan order. Of runs as long as each other, the one keeping the
 * exercises that weren't done EARLIER than planned wins, so of a swapped pair
 * it's the one brought forward that's marked.
 */
function movedOf(placed: readonly { idx: number; plannedIdx: number }[]): Set<number> {
  const n = placed.length;
  // Where each would sit if nothing had moved: its rank in plan order.
  const rank = new Map([...placed].sort((a, b) => a.plannedIdx - b.plannedIdx).map((p, r) => [p.idx, r]));
  const keeps: number[] = placed.map((p, i) => (i >= (rank.get(p.idx) ?? 0) ? 1 : 0));
  const len = new Array<number>(n).fill(1);
  const score = keeps.slice();
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (placed[j].plannedIdx >= placed[i].plannedIdx) continue;
      const l = len[j] + 1;
      const s = score[j] + keeps[i];
      if (l > len[i] || (l === len[i] && s > score[i])) {
        len[i] = l;
        score[i] = s;
        prev[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < n; i++) {
    if (end < 0 || len[i] > len[end] || (len[i] === len[end] && score[i] > score[end])) end = i;
  }
  const inRun = new Set<number>();
  for (let i = end; i >= 0; i = prev[i]) inRun.add(i);
  return new Set(placed.filter((_, i) => !inRun.has(i)).map(p => p.idx));
}

/**
 * The exercises whose place a `moved` one took: for each, the one the plan
 * had at the spot it was done (its k-th among `placed`, in the order done, is
 * the plan's k-th of them). Never one that moved itself.
 */
function displacedBy(placed: readonly { idx: number; plannedIdx: number }[], moved: ReadonlySet<number>): Set<number> {
  const byPlan = [...placed].sort((a, b) => a.plannedIdx - b.plannedIdx);
  const out = new Set<number>();
  placed.forEach((p, k) => {
    const there = byPlan[k];
    if (moved.has(p.idx) && there && !moved.has(there.idx)) out.add(there.idx);
  });
  return out;
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

  const moved = movedOf(placed);
  const displaced = displacedBy(placed, moved);
  for (const p of placed) {
    // A swap-in that also moved says it was a swap: one line each.
    const outOfPlace = moved.has(p.idx) || displaced.has(p.idx);
    if (outOfPlace && cues[p.idx] === null) cues[p.idx] = { kind: "moved", plannedPosition: p.plannedIdx + 1 };
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
      moved: moved.size + displaced.size,
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
