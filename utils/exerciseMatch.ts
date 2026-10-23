// utils/exerciseMatch.ts
//
// Which Avenas exercise another app's exercise is, for an import
// (utils/workoutImport.ts). Hevy and Strong write an exercise as "Name
// (Equipment)", some with a variation after a dash: "Bench Press (Barbell)",
// "Lat Pulldown - Close Grip (Cable)", "Triceps Pushdown (Cable - Straight
// Bar)". The catalogue says "Barbell Bench Press". Three outcomes:
//
//   matched  sure: one of your own custom exercises of that name; a catalogue
//            name, or one it used to have, written the same way give or take
//            punctuation and plurals; with no variation, the name with its
//            equipment put first ("Barbell Bench Press") or the name alone when
//            the catalogue's exercise uses that equipment ("Leg Press
//            (Machine)"); or a name in IMPORT_NAMES, the common lifts the rest
//            only guesses at.
//   check    the one exercise that goes by it as another common name
//            (`searchTerms`: "Chin Up (Assisted)" is the Assisted Pull-Up), or
//            the closest the picker's own search finds (utils/exerciseSearch.ts)
//            among exercises holding every word of the name before the
//            brackets. One named only in the source's own words comes first
//            ("Barbell Curl" for "Bicep Curl (Barbell)", never "Reverse Wrist
//            Curl" for "Reverse Curl (Barbell)"), then the equipment and the
//            variation count towards the closest. Shown for the person to look
//            over.
//   none     nothing close. Imported under its own name: in the Journal and
//            its history, never offered in the picker (user decision,
//            2026-10-23).
//
// Pure, so scripts/verify-import.ts covers it.

import { EXERCISES } from "../constants/exerciseData";
import type { CustomExercise, Exercise } from "../constants/exercises";
import { exerciseSearchDoc, parseQuery, rankMatch, stem, type SearchDoc } from "./exerciseSearch";
import { liveCustoms } from "./customExercises";

export type ExerciseMatch =
  | { kind: "matched" | "check"; name: string; customId?: string }
  | { kind: "none" };

/** What's offered in the picker; a retired exercise is never a new match. */
const CATALOGUE = EXERCISES.filter(e => !e.hidden);
const DOCS = new Map<string, SearchDoc>(CATALOGUE.map(e => [e.id, exerciseSearchDoc(e)]));

/** A name's words, lowercased, apostrophes dropped and plurals stripped. */
function wordsOf(name: string): string[] {
  return name.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

/** A name's words run together: "Push-Ups", "push up" and "Pushup" are all
 *  "pushup", "Farmers Walk" and "Farmer's Walk" both "farmerwalk". */
export function looseKey(name: string): string {
  return wordsOf(name).join("");
}

const BY_LOOSE = new Map<string, Exercise>();
for (const e of CATALOGUE) {
  for (const n of [e.name, ...(e.formerNames ?? [])]) {
    const k = looseKey(n);
    if (!BY_LOOSE.has(k)) BY_LOOSE.set(k, e);
  }
}

/** Another common name (`searchTerms`) only one exercise goes by: "assisted
 *  chin up" is the Assisted Pull-Up. A guess, not a match: another app may mean
 *  a variation by it. */
const BY_ALIAS = (() => {
  const owners = new Map<string, Exercise[]>();
  for (const e of CATALOGUE) {
    for (const term of e.searchTerms ?? []) {
      const k = looseKey(term);
      const list = owners.get(k) ?? [];
      if (!list.includes(e)) list.push(e);
      owners.set(k, list);
    }
  }
  return new Map([...owners].filter(([, list]) => list.length === 1).map(([k, list]) => [k, list[0]]));
})();

/**
 * Hevy and Strong names, by looseKey, to the catalogue's name: the common
 * lifts the search only guesses at, and the few it gets wrong. Each one is
 * checked against the catalogue in scripts/verify-import.ts.
 */
const IMPORT_NAMES: Record<string, string> = Object.fromEntries(Object.entries({
  "Squat (Barbell)": "Barbell Back Squat",
  "Bench Press - Close Grip (Barbell)": "Close-Grip Bench Press",
  "Incline Bench Press (Dumbbell)": "Incline Dumbbell Press",
  "Incline Bench Press (Smith Machine)": "Smith Machine Incline Press",
  "Decline Bench Press (Smith Machine)": "Smith Machine Decline Press",
  "Incline Chest Press (Machine)": "Incline Machine Chest Press",
  "Iso-Lateral Chest Press (Machine)": "Machine Chest Press",
  "Chest Fly (Dumbbell)": "Dumbbell Fly",
  "Incline Chest Fly (Dumbbell)": "Incline Dumbbell Fly",
  "Cable Fly Crossovers": "Cable Crossover",
  "Low Cable Fly Crossovers": "Cable Fly Low To High",
  "Chest Dip (Assisted)": "Assisted Dip",
  "Seated Shoulder Press (Machine)": "Machine Shoulder Press",
  "Overhead Press (Dumbbell)": "Dumbbell Shoulder Press",
  "Rear Delt Reverse Fly (Dumbbell)": "Rear Delt Fly",
  "Rear Delt Reverse Fly (Machine)": "Machine Rear Delt Fly",
  "Rear Delt Reverse Fly (Cable)": "Cable Rear Delt Fly",
  "Lat Pulldown - Close Grip (Cable)": "Close-Grip Lat Pulldown",
  "Lat Pulldown (Machine)": "Lat Pulldown",
  "Straight Arm Lat Pulldown (Cable)": "Straight-Arm Pulldown",
  "Seated Cable Row - V Grip (Cable)": "Seated Cable Row",
  "Seated Cable Row - Bar Grip": "Seated Cable Row",
  "Seated Row (Cable)": "Seated Cable Row",
  "Iso-Lateral Row (Machine)": "Seated Machine Row",
  "Bent Over Row (Dumbbell)": "Dumbbell Row",
  "Back Extension (Hyperextension)": "Back Extension",
  "Bicep Curl (Barbell)": "Barbell Curl",
  "Bicep Curl (Cable)": "Cable Curl",
  "Bicep Curl (Machine)": "Machine Preacher Curl",
  "Hammer Curl (Cable)": "Rope Hammer Curl",
  "Preacher Curl (Barbell)": "Preacher Curl",
  "Reverse Curl (Barbell)": "Reverse Curl",
  "Incline Curl (Dumbbell)": "Incline Dumbbell Curl",
  "Spider Curl (Dumbbell)": "Spider Curl",
  "EZ Bar Biceps Curl": "EZ-Bar Curl",
  "Triceps Rope Pushdown": "Rope Tricep Pushdown",
  "Triceps Pushdown (Cable - Straight Bar)": "Tricep Pushdown",
  "Triceps Extension (Dumbbell)": "Overhead Triceps Extension",
  "Skullcrusher (Barbell)": "Skull Crusher",
  "Skullcrusher (Dumbbell)": "Dumbbell Skull Crusher",
  "Walking Lunge (Dumbbell)": "Dumbbell Lunge",
  "Standing Calf Raise (Smith)": "Smith Machine Calf Raise",
  "Calf Raise (Machine)": "Standing Calf Raise Machine",
  "Ab Wheel": "Ab Wheel Rollout",
  "Elliptical Trainer": "Elliptical",
  "Stair Machine": "Stair Climber",
}).map(([from, to]) => [looseKey(from), to]));

/** Every name IMPORT_NAMES leads to, for scripts/verify-import.ts to find in
 *  the catalogue. */
export const IMPORT_NAME_TARGETS: readonly string[] = [...new Set(Object.values(IMPORT_NAMES))];

/** "Bench Press (Barbell)" in its parts: the name, the equipment in brackets,
 *  and any variation (after a spaced dash, outside the brackets or in them). */
function partsOf(raw: string): { full: string; base: string; equipment: string | null; variation: string[] } {
  const full = raw.trim().replace(/\s+/g, " ");
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(full);
  const [base, ...outside] = (m ? m[1] : full).split(/\s+-\s+/);
  const [equipment, ...inside] = m ? m[2].split(/\s+-\s+/) : [];
  return { full, base: base.trim(), equipment: equipment?.trim() || null, variation: [...outside, ...inside] };
}

/** Whether what the brackets say is the catalogue exercise's own equipment.
 *  "Weighted" and "Bodyweight" are both a body-weight exercise. */
function sameEquipment(catalogue: string, said: string): boolean {
  const c = looseKey(catalogue);
  const s = looseKey(said);
  return c === s || (c === "bodyweight" && s === "weighted");
}

const matched = (e: Exercise): ExerciseMatch => ({ kind: "matched", name: e.name });

/** The Avenas exercise `raw`, as another app named it, is (see above). */
export function matchExerciseName(raw: string, customs: CustomExercise[] = []): ExerciseMatch {
  const p = partsOf(raw);
  if (!p.full) return { kind: "none" };
  const key = looseKey(p.full);

  const own = liveCustoms(customs).find(c => looseKey(c.name) === key);
  if (own) return { kind: "matched", name: own.name, ...(own.id ? { customId: own.id } : {}) };

  const fixed = IMPORT_NAMES[key] ? BY_LOOSE.get(looseKey(IMPORT_NAMES[key])) : undefined;
  if (fixed) return matched(fixed);
  const whole = BY_LOOSE.get(key);
  if (whole) return matched(whole);
  // With nothing saying it's another variation ("Close Grip"), the name with
  // its equipment first, or alone when that's the exercise's own equipment.
  const frontKey = p.equipment ? looseKey(`${p.equipment} ${p.base}`) : null;
  if (p.variation.length === 0) {
    const front = frontKey ? BY_LOOSE.get(frontKey) : undefined;
    if (front) return matched(front);
    const alone = BY_LOOSE.get(looseKey(p.base));
    if (alone && (!p.equipment || sameEquipment(alone.equipment, p.equipment))) return matched(alone);
  }
  const alias = BY_ALIAS.get(key) ?? (frontKey && p.variation.length === 0 ? BY_ALIAS.get(frontKey) : undefined);
  if (alias) return { kind: "check", name: alias.name };

  // The search's closest, among exercises holding every word of the name.
  const required = parseQuery(p.base);
  const ranking = parseQuery([p.equipment ?? "", p.base, ...p.variation].join(" "));
  if (!required || !ranking) return { kind: "none" };
  const said = new Set(wordsOf([p.equipment ?? "", p.base, ...p.variation].join(" ")));
  let best: { e: Exercise; score: number } | null = null;
  for (const e of CATALOGUE) {
    const doc = DOCS.get(e.id)!;
    const all = rankMatch(required, doc);
    if (all === null || Math.floor(all / 1_000_000) < required.words.length) continue;
    // Named only in the source's words: the same exercise, not one with a word
    // the source never said.
    const within = wordsOf(e.name).every(w => said.has(w)) ? 1e12 : 0;
    const score = within + (rankMatch(ranking, doc) ?? all);
    if (!best || score > best.score) best = { e, score };
  }
  return best ? { kind: "check", name: best.e.name } : { kind: "none" };
}
