// utils/repPrs.ts
//
// Rep PRs (user request, 2026-11-14: "if i do more reps and the same weight,
// that should also be an achievement"): a working set with more reps than ever
// before at its weight or heavier, at a weight done before. The gold trophy
// stays for weight (utils/achievements.ts prTrophySets). A rep PR wears the
// records medal beside its number (components/PrTrophy.tsx), is a record on the
// post-workout summary (utils/workoutSummary.ts computeSessionRecords), and is
// Home's card only when its workout set no weight PR, never with a
// notification (utils/achievements.ts detectWorkoutAchievements).
//
// The rules, agreed with the user:
//   - More reps than every set before at that weight or heavier, on working
//     sets ticked with their reps in: 80 × 9 after 80 × 8 is one; 60 × 12
//     after 80 × 12 isn't (as many reps with more on the bar is better).
//   - Only at a weight done before: heavier than ever is the trophy's, and any
//     other weight new to the exercise is neither.
//   - Assisted (utils/assisted.ts): more reps at the same help, beating every
//     set at that help or less. A set with no help typed counts for nothing.
//   - A hold (CompletedExercise.isIsometric): a longer hold at the same weight,
//     its seconds kept apart from the exercise's reps (seconds aren't reps).
//     Bodyweight is a weight like any other: 12 push-ups after 10 is one.
//   - One per exercise a session, by identity like the trophy: the heaviest
//     (least help), then the most reps, then the first. A set the session
//     itself beats (as heavy or heavier with as many reps or more, one of them
//     more) isn't one, so the medals mark the records the session leaves, as
//     the trophies do: after 80 × 9 then 82.5 × 9, only the 82.5 (a trophy).
//   - Weights within SAME_KG (utils/units.ts) are the same weight.
//
// Pure and RN-free (scripts/verify-achievements.ts runs it under tsx).

import type { CompletedSet, CompletedWorkout } from "../constants/programs";
import { exerciseIdentity } from "./exerciseNames";
import { isAssistedIdentity, liftBeats } from "./assisted";
import { SAME_KG } from "./units";

/** A set as the marks read it: its kind, whether it's ticked, its reps as
 *  typed (a hold's seconds), and its weight in kg, 0 for none. The trophy's
 *  own shape (utils/achievements.ts PrSetInput). */
export type RepSetInput = { type: "warmup" | "working"; done: boolean; reps: string; weightKg: number };

/** One exercise's sets in a session, by identity (exerciseIdentity), and
 *  whether it was a hold. */
export type RepExercise = { identity: string; hold: boolean; sets: readonly RepSetInput[] };

/** What each exercise did before, by identity and kind (its reps, or a hold's
 *  seconds): every weight it was done at (kg as saved), with the most done
 *  at it. */
export type RepBests = ReadonlyMap<string, ReadonlyMap<number, number>>;

/** A set that's a rep PR, and the most it beat: the most reps (a hold's
 *  seconds) done before at its weight or better. */
export type RepPrHit = { prevReps: number };

/** A session's rep PR on one exercise: the set it was, and the most it beat. */
export type RepPr = { weightKg: number; reps: number; prevReps: number; hold: boolean };

/** Nothing done before. */
export const NO_REP_BESTS: RepBests = new Map();

/** A number typed or stored on a set, or 0 for anything not above zero. */
function positive(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** An exercise's key in RepBests: its identity, its holds apart. */
const kindKey = (identity: string, hold: boolean) => (hold ? `${identity}\u0000hold` : identity);

/** A saved set as the marks read it. */
const savedSet = (s: CompletedSet): RepSetInput => ({ type: s.type, done: s.done, reps: s.reps, weightKg: positive(s.weight) });

/** Whether a set counts, before or now: a working set ticked with its reps in,
 *  for an assisted exercise with its help typed. */
function counts(s: RepSetInput, assisted: boolean): boolean {
  return s.type === "working" && s.done && positive(s.reps) > 0 && (assisted ? s.weightKg > 0 : s.weightKg >= 0);
}

/** `w`'s sets added to `into` (only exercise `only`, when given). */
function noteWorkout(into: Map<string, Map<number, number>>, w: CompletedWorkout, only?: string): void {
  for (const ex of w.exercises) {
    const identity = ex.name ? exerciseIdentity(ex) : "";
    if (!identity || (only !== undefined && identity !== only)) continue;
    const assisted = isAssistedIdentity(identity);
    const key = kindKey(identity, ex.isIsometric === true);
    for (const saved of ex.sets) {
      const s = savedSet(saved);
      if (!counts(s, assisted)) continue;
      let at = into.get(key);
      if (!at) {
        at = new Map();
        into.set(key, at);
      }
      const reps = positive(s.reps);
      if (reps > (at.get(s.weightKg) ?? 0)) at.set(s.weightKg, reps);
    }
  }
}

/** What every exercise did in `history`: what a set has to beat. */
export function repBestsBefore(history: readonly CompletedWorkout[]): RepBests {
  const out = new Map<string, Map<number, number>>();
  for (const w of history) noteWorkout(out, w);
  return out;
}

/** Whether weight `kg` was done before, within SAME_KG. */
function doneAt(at: ReadonlyMap<number, number>, kg: number): boolean {
  for (const w of at.keys()) if (Math.abs(w - kg) < SAME_KG) return true;
  return false;
}

/** The most done before at `kg` or better: as heavy or heavier, or for an
 *  assisted exercise as little help or less. */
function mostFrom(at: ReadonlyMap<number, number>, kg: number, assisted: boolean): number {
  let most = 0;
  for (const [w, reps] of at) {
    if ((assisted ? w < kg + SAME_KG : w > kg - SAME_KG) && reps > most) most = reps;
  }
  return most;
}

/** The exercise's best weight before, of either kind: the trophy's best
 *  (utils/achievements.ts bestLiftsBefore), the heaviest or the least help,
 *  above 0. Undefined for none. */
function bestWeight(bests: RepBests, identity: string, assisted: boolean): number | undefined {
  let best: number | undefined;
  for (const key of [kindKey(identity, false), kindKey(identity, true)]) {
    const at = bests.get(key);
    if (!at) continue;
    for (const w of at.keys()) {
      if (w > 0 && (best === undefined || liftBeats(w, best, assisted))) best = w;
    }
  }
  return best;
}

/** Whether weight `a` is better than `b` by more than SAME_KG: heavier, or for
 *  an assisted exercise less help. */
const clearlyBetter = (a: number, b: number, assisted: boolean) => Math.abs(a - b) >= SAME_KG && liftBeats(a, b, assisted);

/**
 * Which of a session's sets are rep PRs, and what each beat: by the rules at
 * the top, against `bests` (repBestsBefore of the sessions before it). Per
 * exercise and set as given; null for a set that isn't one. Every exercise at
 * once, since one can be on two cards and still has one.
 */
export function repPrHits(exercises: readonly RepExercise[], bests: RepBests): (RepPrHit | null)[][] {
  // What the session itself did of each exercise and kind.
  const done = new Map<string, { kg: number; reps: number }[]>();
  for (const ex of exercises) {
    if (!ex.identity) continue;
    const assisted = isAssistedIdentity(ex.identity);
    const key = kindKey(ex.identity, ex.hold);
    const list = done.get(key) ?? [];
    for (const s of ex.sets) if (counts(s, assisted)) list.push({ kg: s.weightKg, reps: positive(s.reps) });
    done.set(key, list);
  }
  // Beaten by a set of the session: heavier with as many reps or more, or the
  // same weight with more.
  const beatenHere = (key: string, kg: number, reps: number, assisted: boolean) =>
    (done.get(key) ?? []).some(o =>
      clearlyBetter(o.kg, kg, assisted) ? o.reps >= reps : Math.abs(o.kg - kg) < SAME_KG && o.reps > reps);

  const picked = new Map<string, { i: number; j: number; kg: number; reps: number; hit: RepPrHit }>();
  exercises.forEach((ex, i) => {
    if (!ex.identity) return;
    const assisted = isAssistedIdentity(ex.identity);
    const key = kindKey(ex.identity, ex.hold);
    const at = bests.get(key);
    if (!at) return;
    const best = bestWeight(bests, ex.identity, assisted);
    ex.sets.forEach((s, j) => {
      if (!counts(s, assisted)) return;
      const kg = s.weightKg;
      const reps = positive(s.reps);
      // A weight new to it: heavier than ever is the trophy's (a set never
      // wears both), any other is neither.
      if (!doneAt(at, kg) || (best !== undefined && kg > 0 && liftBeats(kg, best, assisted))) return;
      const prevReps = mostFrom(at, kg, assisted);
      if (reps <= prevReps || beatenHere(key, kg, reps, assisted)) return;
      // One per exercise: the heaviest (least help), then the most reps, then
      // the first.
      const cur = picked.get(ex.identity);
      const better = !cur || (Math.abs(kg - cur.kg) >= SAME_KG ? liftBeats(kg, cur.kg, assisted) : reps > cur.reps);
      if (better) picked.set(ex.identity, { i, j, kg, reps, hit: { prevReps } });
    });
  });

  const hits = exercises.map(ex => ex.sets.map((): RepPrHit | null => null));
  for (const p of picked.values()) hits[p.i][p.j] = p.hit;
  return hits;
}

/** repPrHits, as which sets wear the medal. */
export function repPrSets(exercises: readonly RepExercise[], bests: RepBests): boolean[][] {
  return repPrHits(exercises, bests).map(row => row.map(hit => hit !== null));
}

/** A saved workout's exercises as the marks read them, in saved order. */
function exercisesOf(workout: CompletedWorkout): RepExercise[] {
  return workout.exercises.map(ex => ({
    identity: ex.name ? exerciseIdentity(ex) : "",
    hold: ex.isIsometric === true,
    sets: ex.sets.map(savedSet),
  }));
}

/**
 * Which of a SAVED workout's sets wear the rep PR medal: per exercise, each set
 * in saved order, against the sessions completed before it, exactly as its
 * trophies are read (utils/achievements.ts prSetsOfWorkout), so a session since
 * never takes one away. `history` may include `workout` itself. An unreadable
 * completedAt has nothing before it, so no medals.
 */
export function repPrSetsOfWorkout(workout: CompletedWorkout, history: readonly CompletedWorkout[]): boolean[][] {
  const at = Date.parse(workout.completedAt);
  const before = Number.isFinite(at) ? history.filter(w => w.id !== workout.id && Date.parse(w.completedAt) < at) : [];
  return repPrSets(exercisesOf(workout), repBestsBefore(before));
}

/**
 * How many medals a whole history wears: every session's repPrSetsOfWorkout,
 * worked out in one pass, for the Journal's Your Training card
 * (utils/trainingTotals.ts), whose PR count must be the marks the sessions
 * show (utils/achievements.ts countTrophies is the trophies'). As there,
 * sessions finished at the same moment don't count each other, and one with an
 * unreadable completedAt wears none and counts towards no other's.
 */
export function countMedals(history: readonly CompletedWorkout[]): number {
  const timed = history
    .map(w => ({ w, at: Date.parse(w.completedAt) }))
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  const running = new Map<string, Map<number, number>>();
  let count = 0;
  for (let i = 0; i < timed.length;) {
    let j = i;
    while (j < timed.length && timed[j].at === timed[i].at) j++;
    for (let k = i; k < j; k++) {
      for (const row of repPrSets(exercisesOf(timed[k].w), running)) {
        for (const worn of row) if (worn) count++;
      }
    }
    for (let k = i; k < j; k++) noteWorkout(running, timed[k].w);
    i = j;
  }
  return count;
}

/**
 * `completed`'s rep PRs, by exercise identity: what the post-workout summary
 * lists and Home's card names. `priorHistory` MUST NOT contain `completed`
 * (computeSessionRecords' contract).
 */
export function sessionRepPrs(completed: CompletedWorkout, priorHistory: readonly CompletedWorkout[]): Map<string, RepPr> {
  const exercises = exercisesOf(completed);
  const hits = repPrHits(exercises, repBestsBefore(priorHistory));
  const out = new Map<string, RepPr>();
  exercises.forEach((ex, i) => ex.sets.forEach((s, j) => {
    const hit = hits[i][j];
    if (hit) out.set(ex.identity, { weightKg: s.weightKg, reps: positive(s.reps), prevReps: hit.prevReps, hold: ex.hold });
  }));
  return out;
}

/**
 * For every workout in `history`, one exercise's bests (by identity) from the
 * sessions completed before it: what repPrSetsOfWorkout measures that
 * exercise's sets against, for a whole history in one pass (the Exercise
 * History page's medals). As there, sessions finished at the same moment don't
 * count each other, and one with an unreadable completedAt has none (no
 * medals) and counts towards no other's, as utils/achievements.ts
 * bestBeforeEach does for the trophies.
 */
export function repBestsBeforeEach(history: readonly CompletedWorkout[], identity: string): Map<string, RepBests> {
  const timed = history
    .map(w => ({ w, at: Date.parse(w.completedAt) }))
    .filter(x => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  const out = new Map<string, RepBests>();
  const running = new Map<string, Map<number, number>>();
  for (let i = 0; i < timed.length;) {
    let j = i;
    while (j < timed.length && timed[j].at === timed[i].at) j++;
    const before: RepBests = new Map([...running].map(([key, at]) => [key, new Map(at)] as const));
    for (let k = i; k < j; k++) out.set(timed[k].w.id, before);
    for (let k = i; k < j; k++) noteWorkout(running, timed[k].w, identity);
    i = j;
  }
  return out;
}
