// utils/allExercises.ts
//
// The Progress page's Exercise Progress list under "All programs" (user
// request and decisions, 2026-10-26): every exercise logged, from any program,
// day or custom workout, once each (progressStats.ts collectLoggedExercises),
// in one card per muscle group, and a search across all of them. Each opens
// the chart of every session of it (utils/exerciseDaySlots.ts
// exerciseDateSlots).
//
// Pure, so the verify scripts and the training simulation run it.

import type { CustomExercise } from "../constants/exercises";
import type { LoggedExerciseRow } from "../constants/progress";
import { customFor } from "./customExercises";
import { MUSCLE_ORDER } from "./exerciseFavourites";
import { exerciseByName } from "./exerciseLookup";
import type { ExerciseRef } from "./exerciseNames";
import { exerciseSearchDoc, parseQuery, rankMatch, searchDoc, type SearchDoc } from "./exerciseSearch";
import { musclesForExercise } from "./muscleGroups";

/** The card for exercises no muscle is known for: an imported name that
 *  matched nothing, or a custom exercise given none. */
export const OTHER_MUSCLES = "Other";

/** One muscle group's card: its name and its exercises, most recently logged
 *  first. */
export type MuscleGroupRows = { label: string; rows: LoggedExerciseRow[] };

/** The card an exercise is in: a catalogue exercise's own muscle, a custom
 *  one's first (`customs` is every custom exercise it can be, deleted ones and
 *  a trainer's included), else Other. */
export function muscleCardOf(ex: ExerciseRef, customs: CustomExercise[]): string {
  return musclesForExercise(ex, customs)[0] ?? OTHER_MUSCLES;
}

/**
 * The exercises in one card per muscle group (muscleCardOf), in the exercise
 * picker's order (Chest, Back, Shoulders, Legs, Arms, Core), Other last, a
 * group with none left out.
 */
export function groupByMuscle(rows: readonly LoggedExerciseRow[], customs: CustomExercise[]): MuscleGroupRows[] {
  const byCard = new Map<string, LoggedExerciseRow[]>();
  for (const r of rows) {
    const card = muscleCardOf(r, customs);
    const list = byCard.get(card);
    if (list) list.push(r);
    else byCard.set(card, [r]);
  }
  return [...MUSCLE_ORDER, OTHER_MUSCLES].flatMap(label => {
    const list = byCard.get(label);
    return list ? [{ label, rows: list }] : [];
  });
}

/** The catalogue's searchable forms, made as they're first needed. */
const CATALOGUE_DOCS = new Map<string, SearchDoc>();

/** What a search reads of an exercise: a catalogue one by everything the
 *  picker searches (its former and other names, equipment, muscle), a custom
 *  one by its name and muscles, as the picker has it, and a name nothing
 *  knows (an import that matched nothing) by itself. */
function docFor(row: LoggedExerciseRow, customs: CustomExercise[]): SearchDoc {
  const listed = row.customId ? undefined : exerciseByName(row.name);
  if (listed) {
    let doc = CATALOGUE_DOCS.get(listed.id);
    if (!doc) {
      doc = exerciseSearchDoc(listed);
      CATALOGUE_DOCS.set(listed.id, doc);
    }
    return doc;
  }
  return searchDoc(row.name, [], customFor(row, customs)?.muscles ?? []);
}

/**
 * The exercises matching what's typed, closest first, or null when nothing
 * is typed. The exercise picker's search (utils/exerciseSearch.ts): word by
 * word, forgiving of a typo, gym shorthand ("db press") and a renamed
 * exercise's old name. A tie keeps the list's order, most recently logged
 * first.
 */
export function searchLoggedExercises(
  rows: readonly LoggedExerciseRow[],
  text: string,
  customs: CustomExercise[],
): LoggedExerciseRow[] | null {
  const query = parseQuery(text);
  if (!query) return null;
  const ranked: { row: LoggedExerciseRow; score: number; at: number }[] = [];
  rows.forEach((row, at) => {
    const score = rankMatch(query, docFor(row, customs));
    if (score !== null) ranked.push({ row, score, at });
  });
  return ranked.sort((a, b) => b.score - a.score || a.at - b.at).map(r => r.row);
}
