// The exercise picker's search: forgiving, word by word.
//
// Plain substring matching missed the obvious: "lateral raises" (a plural) and
// "raise lateral" (word order) found nothing, and "bicep curl" found almost no
// curl, since they're named "Barbell Curl", "Hammer Curl" and so on. Now:
//   - every word typed must match some word of the exercise, by prefix, after
//     a light plural strip on both sides ("curls" → "curl", "presses" →
//     "press", "flyes" → "fly"), in any order;
//   - the words searched are the name, its former names (so an old name still
//     finds it), its other common names and main muscles (`searchTerms`), its
//     equipment and its muscle group, so "bicep curl" finds every curl;
//   - a few gym shorthands expand ("db" dumbbell, "bb" barbell, "tri" triceps);
//   - hyphens and spaces don't matter: "pushup" finds "Push-Up".
// Results rank by how well the NAME matches: the name starting with what was
// typed, then every word found in the name, then matches through the rest.
//
// Pure, so scripts/verify-exercise-renames.ts can check it against the catalogue.

export type SearchDoc = {
  /** Stemmed words of the name. */
  name: string[];
  /** Stemmed words of everything else searched. */
  other: string[];
  /** The name lowercased, for "starts with". */
  nameLower: string;
  /** Every searched word run together, for hyphen/space-free matching. */
  compact: string;
};

/** Gym shorthand → the words it stands for (any one of them matches). */
const SHORTHAND: Record<string, string[]> = {
  db: ["dumbbell"], bb: ["barbell"], kb: ["kettlebell"], bw: ["bodyweight", "body"],
  bi: ["bicep"], tri: ["tricep"], delt: ["shoulder", "delt"],
  ham: ["hamstring"], hammy: ["hamstring"], quad: ["quad"], glute: ["glute"],
  ab: ["ab", "core"], pec: ["pec", "chest"], lat: ["lat"],
  rdl: ["romanian", "rdl"], ohp: ["overhead"],
};

/** Strips a plural ending so singular and plural meet. */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("sses") || word.endsWith("ches") || word.endsWith("shes") || word.endsWith("xes")) return word.slice(0, -2);
  if (word.endsWith("yes")) return word.slice(0, -2);
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

const words = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Builds the searchable form of one exercise. */
export function searchDoc(name: string, other: readonly string[]): SearchDoc {
  const nameWords = words(name);
  const otherWords = other.flatMap(words);
  return {
    name: nameWords.map(stem),
    other: otherWords.map(stem),
    nameLower: name.trim().toLowerCase(),
    compact: [...nameWords, ...otherWords].join(""),
  };
}

/** The searchable form of a catalogue exercise: its name, then its former
 *  names, other common names and muscles, equipment and muscle group. */
export function exerciseSearchDoc(e: {
  name: string; equipment: string; primaryMuscle: string; formerNames?: string[]; searchTerms?: string[];
}): SearchDoc {
  return searchDoc(e.name, [...(e.formerNames ?? []), ...(e.searchTerms ?? []), e.equipment, e.primaryMuscle]);
}

/** The words of a query, or null when there's nothing to search for. */
export function queryWords(query: string): string[] | null {
  const w = words(query);
  return w.length ? w : null;
}

function wordMatches(q: string, doc: SearchDoc, inName: boolean): boolean {
  const pool = inName ? doc.name : [...doc.name, ...doc.other];
  const wants = [stem(q), ...(SHORTHAND[q] ?? []).map(stem)];
  if (pool.some(w => wants.some(x => w.startsWith(x)))) return true;
  // "pushup" against "push-up": run-together text, for longer words only so a
  // short word can't hit the middle of something unrelated.
  return !inName && q.length >= 5 && doc.compact.includes(q);
}

/**
 * How well `doc` matches the query words: 0 best (the name starts with the
 * query), 1 (every word is in the name), 2 (matched through other names,
 * muscles or equipment), or null when it doesn't match.
 */
export function matchScore(query: string, q: readonly string[], doc: SearchDoc): number | null {
  if (!q.every(w => wordMatches(w, doc, false))) return null;
  if (doc.nameLower.startsWith(query.trim().toLowerCase())) return 0;
  return q.every(w => wordMatches(w, doc, true)) ? 1 : 2;
}
