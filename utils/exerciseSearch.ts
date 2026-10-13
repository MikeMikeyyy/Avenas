// The exercise picker's search: forgiving, word by word, closest first.
//
// It used to need EVERY word typed to match, so one wrong word hid the exercise
// meant: "inner hip abduction" found nothing, since the inner one is "Inner Hip
// Adduction" and the abduction one "Outer Hip Abduction" (user report,
// 2026-10-12). Now:
//   - each word typed is looked for in the exercise's name, then its other
//     names (former names and `searchTerms`), then its equipment and muscle
//     group: as a whole word, as the start of one ("lat" for "lateral"), after
//     a light plural strip on both sides ("curls", "presses", "flyes"), run
//     together with the next word ("pull down" for "Pulldown", "pushup" for
//     "Push-Up"), as gym shorthand ("db", "tri", "abs"), and, failing all of
//     those, with a typo: one letter wrong, missing, extra or swapped in a word
//     of 5+ letters, two in one of 8+;
//   - an exercise is offered when at least half the words typed are found in
//     it, so a mixed-up or extra word adds possible answers rather than
//     emptying the list. Short of all of them, one must be in a name (an
//     exercise isn't a possible answer for "leg press" just because it works
//     the legs). "with", "the" and the like count neither way;
//   - the closest comes first: more of the words found; then the name being
//     what was typed, ending with it (Box Squat is a squat, Squat to Stand a
//     stretch), starting with it, or holding it, or else another of its names
//     doing so ("military press" for Overhead Press); then how well each word
//     was found (in the name beats elsewhere beats a typo); then the staple
//     lifts (`common`), then the fewest name words beyond the ones typed. Ties
//     go A to Z.
// The muscle chips narrow whatever this finds.
//
// Pure, so scripts/verify-exercise-renames.ts can check it against the catalogue.

export type SearchDoc = {
  /** Stemmed words of the name. */
  name: string[];
  /** Stemmed words of its other names: former names and `searchTerms`. */
  alias: string[];
  /** Stemmed words of its equipment and muscle group. */
  tag: string[];
  /** Each other name's stemmed words. */
  aliasNames: string[][];
  /** The name's words run together, for "pushup" against "Push-Up". */
  nameCompact: string;
  /** Every searched word run together. */
  compact: string;
  /** A staple lift: wins a tie with an exercise just as close. */
  common: boolean;
};

type QueryWord = {
  /** As typed, lowercased. */
  raw: string;
  /** With a plural stripped. */
  stem: string;
  /** Whole words it also stands for (gym shorthand). */
  also: string[];
  /** Which words of the catalogue it's a typo of, worked out as they come up:
   *  most exercises share their words, so each is checked once a search. */
  typos: Map<string, boolean>;
};

export type SearchQuery = {
  /** The words that count, not "with", "the" and the like. */
  words: QueryWord[];
  /** Every word typed, stemmed ("to" and all), for whole-phrase matches. */
  phrase: string[];
};

/** Gym shorthand → the whole words it stands for. Looked up as typed and
 *  stemmed, so "abs" and "pecs" work too. */
const SHORTHAND: Record<string, string[]> = {
  db: ["dumbbell"], bb: ["barbell"], kb: ["kettlebell"], bw: ["bodyweight", "body"],
  bi: ["bicep"], tri: ["tricep"], delt: ["shoulder", "delt"],
  ham: ["hamstring"], hammy: ["hamstring"],
  ab: ["ab", "core"], abs: ["ab", "core"], pec: ["pec", "chest"],
  rdl: ["romanian", "rdl"], sldl: ["stiff"], ohp: ["overhead"], bss: ["bulgarian"],
  hspu: ["handstand"], calve: ["calf", "calve"], calf: ["calf", "calve"],
};

/** Words that say nothing about which exercise: left out of a search unless
 *  they're all there is. */
const STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "using", "with"]);

/** Plurals kept whole: "traps" is the muscle, "trap" the Trap Bar Deadlift. */
const KEEP_PLURAL = new Set(["traps"]);

/** Strips a plural ending so singular and plural meet. */
export function stem(word: string): string {
  if (word.length <= 3 || KEEP_PLURAL.has(word)) return word;
  if (word.endsWith("sses") || word.endsWith("ches") || word.endsWith("shes") || word.endsWith("xes")) return word.slice(0, -2);
  if (word.endsWith("yes")) return word.slice(0, -2);
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

const words = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Builds the searchable form of an exercise from its name, its other names
 *  and its tags (equipment, muscle groups). */
export function searchDoc(name: string, aliases: readonly string[], tags: readonly string[], common = false): SearchDoc {
  const nameWords = words(name);
  const aliasWords = aliases.flatMap(words);
  const tagWords = tags.flatMap(words);
  return {
    name: nameWords.map(stem),
    alias: aliasWords.map(stem),
    tag: tagWords.map(stem),
    aliasNames: aliases.map(a => words(a).map(stem)).filter(a => a.length > 0),
    nameCompact: nameWords.join(""),
    compact: [...nameWords, ...aliasWords, ...tagWords].join(""),
    common,
  };
}

/** The searchable form of a catalogue exercise. */
export function exerciseSearchDoc(e: {
  name: string; equipment: string; primaryMuscle: string; formerNames?: string[]; searchTerms?: string[]; common?: boolean;
}): SearchDoc {
  return searchDoc(e.name, [...(e.formerNames ?? []), ...(e.searchTerms ?? [])], [e.equipment, e.primaryMuscle], !!e.common);
}

/** What's in the search box as a query, or null when there's nothing to search for. */
export function parseQuery(text: string): SearchQuery | null {
  const all = words(text);
  if (!all.length) return null;
  const counted = all.filter(w => !STOP_WORDS.has(w));
  return {
    words: (counted.length ? counted : all).map(raw => {
      const s = stem(raw);
      return { raw, stem: s, also: SHORTHAND[raw] ?? SHORTHAND[s] ?? [], typos: new Map() };
    }),
    phrase: all.map(stem),
  };
}

// How a query word was found, best first.
const IN_NAME = 7;        // a word of the name
const START_OF_NAME = 6;  // the start of one, or run together in the name
const IN_ALIAS = 5;       // another of its names
const IN_TAG = 4;         // its equipment or muscle group
const TYPO_IN_NAME = 3;   // the name, with a typo
const TYPO_ELSEWHERE = 2; // another name or a tag, with a typo

/** True when `a` and `b` are at most `max` edits apart: a letter changed,
 *  added, dropped, or two side by side swapped. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d.push([i]);
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { d[0].push(j); continue; }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i].push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (i > 0 && rowMin > max) return false;
  }
  return d[a.length][b.length] <= max;
}

/** A typed word against a word of the exercise, allowing a typo. Compared with
 *  the word's start too, since the last word may still be being typed. */
function typoOf(word: QueryWord, w: string): boolean {
  const cached = word.typos.get(w);
  if (cached !== undefined) return cached;
  const q = word.stem;
  const max = q.length >= 8 ? 2 : q.length >= 5 ? 1 : 0;
  let hit = false;
  if (max && w.length >= 4) {
    for (let len = Math.max(4, q.length - max); len <= Math.min(w.length, q.length + max) && !hit; len++) {
      hit = withinEdits(q, w.slice(0, len), max);
    }
  }
  word.typos.set(w, hit);
  return hit;
}

/** How well one query word is found in `doc`: one of the levels above, 0 for not at all. */
function wordLevel(word: QueryWord, doc: SearchDoc): number {
  // Shorthand stands for whole words only: "abs" means the core, not the
  // start of "abduction".
  const is = (x: string) => x === word.stem || word.also.includes(x);
  const startsWith = (x: string) => x.startsWith(word.stem);
  if (doc.name.some(is)) return IN_NAME;
  if (doc.name.some(startsWith)) return START_OF_NAME;
  // Run together, for longer words only, so a short one can't hit the middle
  // of something unrelated.
  const long = word.stem.length >= 5;
  if (long && doc.nameCompact.includes(word.stem)) return START_OF_NAME;
  if (doc.alias.some(x => is(x) || startsWith(x)) || (long && doc.compact.includes(word.stem))) return IN_ALIAS;
  if (doc.tag.some(x => is(x) || startsWith(x))) return IN_TAG;
  if (doc.name.some(x => typoOf(word, x))) return TYPO_IN_NAME;
  if (doc.alias.some(x => typoOf(word, x)) || doc.tag.some(x => typoOf(word, x))) return TYPO_ELSEWHERE;
  return 0;
}

/** How closely a name (its stemmed words) holds what was typed: 4 it's the
 *  same, 3 it ends with it, 2 it starts with it, 1 it holds it, 0 not at all.
 *  The last word typed may be half typed. */
function nameHolds(name: string[], typed: string[]): number {
  const k = typed.length;
  if (!k || k > name.length) return 0;
  const at = (start: number) => typed.every((t, i) => (i === k - 1 ? name[start + i].startsWith(t) : name[start + i] === t));
  if (k === name.length && typed.every((t, i) => name[i] === t)) return 4;
  if (at(name.length - k)) return 3;
  if (at(0)) return 2;
  for (let s = 1; s < name.length - k; s++) if (at(s)) return 1;
  return 0;
}

/**
 * How well `doc` matches the query: a number, higher first, or null when it
 * isn't one of the possible answers (fewer than half the words typed found,
 * or, short of all of them, none in a name).
 */
export function rankMatch(query: SearchQuery, doc: SearchDoc): number | null {
  const levels = query.words.map(w => wordLevel(w, doc));
  // Two words typed apart that the exercise writes as one: "pull down",
  // "t bar". Both count as found where the joined word is.
  for (let i = 0; i + 1 < query.words.length; i++) {
    const joined = query.words[i].raw + query.words[i + 1].raw;
    if (joined.length < 4) continue;
    const level = doc.nameCompact.includes(joined) ? START_OF_NAME : doc.compact.includes(joined) ? IN_ALIAS : 0;
    levels[i] = Math.max(levels[i], level);
    levels[i + 1] = Math.max(levels[i + 1], level);
  }
  const found = levels.filter(l => l > 0).length;
  if (found === 0 || found < Math.ceil(levels.length / 2)) return null;
  if (found < levels.length && !levels.some(l => l >= IN_ALIAS || l === TYPO_IN_NAME)) return null;
  const quality = levels.reduce((sum, l) => sum + l, 0);
  const inName = levels.filter(l => l === IN_NAME || l === START_OF_NAME || l === TYPO_IN_NAME).length;
  // The name as typed beats another of its names as typed, which beats a
  // name that only holds it.
  const name = nameHolds(doc.name, query.phrase);
  const alias = Math.max(0, ...doc.aliasNames.map(a => nameHolds(a, query.phrase)));
  const phrase = Math.max([0, 4, 6, 7, 8][name], [0, 2, 3, 3, 5][alias]);
  const extraWords = Math.min(49, Math.max(0, doc.name.length - inName));
  return found * 1_000_000 + phrase * 10_000 + quality * 100 + (doc.common ? 50 : 0) + (49 - extraWords);
}
