// utils/assisted.ts
//
// Exercises whose weight is help, not load: an assisted pull-up or dip
// machine's counterweight (user request, 2026-11-07: a heavier set on an
// assisted pull-up got the PR trophy, when it was the easier one). Less is
// harder, so less is the record: the trophy, the PR card, the records, the
// Strength chart (drawn the other way up, so stronger still climbs) and
// Compare all go by the least assistance. Assistance isn't weight lifted, so
// these count no volume and no estimated 1RM, as a hold counts none.
//
// What makes one assisted is the exercise, never a session: the catalogue's
// own flag (scripts/exercise-library.json "assisted"), or a custom exercise's
// Assisted switch (CustomExercise.assisted). Nothing is stamped on what's
// logged, so turning the switch on or off reads all of that exercise's history
// the new way, never half of it.
//
// Custom exercises are known from the lists this phone holds, kept here so
// every count can ask without a list being handed through it:
//   own      your own (CUSTOM_KEY), the definition that wins
//   carried  other people's, carried in your programs (customDetails)
//   client   a client's own, while a trainer's phone shows their training
// utils/assistedStore.ts fills the first two from storage at launch and after
// a change; the screens that change them note them here.
//
// Pure and RN-free (the verify scripts run it under tsx).

import { EXERCISES } from "../constants/exerciseData";
import type { CustomExercise } from "../constants/exercises";
import { exerciseIdentity, exerciseKey, type ExerciseRef } from "./exerciseNames";

/** The catalogue's assisted exercises, by name key (exerciseKey). */
const LIBRARY = new Set(EXERCISES.filter(e => e.assisted).map(e => exerciseKey(e.name)));

export type AssistedSource = "own" | "carried" | "client";

const known: Record<AssistedSource, Map<string, boolean>> = {
  own: new Map(),
  carried: new Map(),
  client: new Map(),
};

/** The custom exercises one source knows, replacing what it knew. Deleted
 *  ones too: their sessions are still read. */
export function noteAssistedCustoms(source: AssistedSource, list: readonly CustomExercise[]): void {
  const next = new Map<string, boolean>();
  for (const c of list) next.set(exerciseIdentity({ name: c.name, customId: c.id }), c.assisted === true);
  known[source] = next;
}

/** Whether an exercise's weight is assistance: your own custom exercise's
 *  switch, else the one it was carried with, else a client's, else the
 *  catalogue's flag. */
export function isAssisted(ex: ExerciseRef): boolean {
  return isAssistedIdentity(exerciseIdentity(ex));
}

/** The same, by an exercise's identity (exerciseIdentity), for the counts that
 *  key exercises by it. A custom exercise's identity is "custom:<id>", a
 *  catalogue one's its name key, which is what LIBRARY holds. */
export function isAssistedIdentity(id: string): boolean {
  if (!id) return false;
  for (const source of ["own", "carried", "client"] as const) {
    const said = known[source].get(id);
    if (said !== undefined) return said;
  }
  return !id.startsWith("custom:") && LIBRARY.has(id);
}

/** Whether weight `a` is a better lift than `b`: heavier, or for an assisted
 *  exercise less help. Equal never is (a tie isn't a record). */
export function liftBeats(a: number, b: number, assisted: boolean): boolean {
  return assisted ? a < b : a > b;
}
