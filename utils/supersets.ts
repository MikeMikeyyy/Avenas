// utils/supersets.ts
//
// Supersets (user request, 2026-11-15: "doing 2 exercises at the same time. 1
// set bench press and then straight to a shoulder press etc, and then set 2
// will be back to bench press followed by shoulder press again"). Two or more
// exercises next to each other in a day (or a session) that share a
// `supersetId` (Exercise.supersetId, CompletedExercise.supersetId) are done in
// rounds: each one's warm-ups first, then set 1 of each in turn, set 2 of each,
// and on, one with more sets doing its extra ones at the end. No rest between
// the exercises of a round; the superset's rest after each round, which every
// member carries (joining one gives it the superset's rest, and the builder
// sets it on all of them).
//
// What makes a superset is the run, never the id alone: two or more ADJACENT
// exercises with the same id. One left on its own, or apart from its partners,
// isn't in one, and cleanSupersets drops its id on every load and save path.
// Joining, leaving and moving go through the functions here, so a superset
// stays whole: a member dragged within its superset stays in it, one dragged
// out leaves it, and anything dropped into the middle of one lands just past
// it rather than splitting it.
//
// The user's picks, 2026-11-15: no rest inside a round, warm-ups before the
// rounds, separate cards joined by a line, built by hand (the AI never
// suggests one).
//
// Pure (scripts/verify-supersets.ts).

/** Anything in a day's or a session's list that can be in a superset. */
export type SupersetMember = { supersetId?: string };

/** A member's id, "" for none (or a blank one). */
function idOf(m: SupersetMember | undefined): string {
  return typeof m?.supersetId === "string" && m.supersetId.trim() !== "" ? m.supersetId : "";
}

const span = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);

/** A new superset's id. */
export function makeSupersetId(): string {
  return `ss_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The supersets in a list: each the indexes, in order, of a run of 2+
 *  adjacent exercises sharing an id. */
export function supersetRuns(list: readonly SupersetMember[]): number[][] {
  const runs: number[][] = [];
  let i = 0;
  while (i < list.length) {
    const id = idOf(list[i]);
    let j = i + 1;
    if (id) while (j < list.length && idOf(list[j]) === id) j++;
    if (id && j - i >= 2) runs.push(span(i, j));
    i = j;
  }
  return runs;
}

/** The superset the exercise at `i` is in (its members' indexes), or null. */
export function runOf(list: readonly SupersetMember[], i: number): number[] | null {
  return supersetRuns(list).find(run => run.includes(i)) ?? null;
}

/** The list as it's done, in blocks: each superset whole, each other exercise
 *  on its own. Focus mode shows a block at a time. */
export function blocksOf(list: readonly SupersetMember[]): number[][] {
  const runs = supersetRuns(list);
  const out: number[][] = [];
  let r = 0;
  for (let i = 0; i < list.length;) {
    if (r < runs.length && runs[r][0] === i) {
      out.push(runs[r]);
      i = runs[r][runs[r].length - 1] + 1;
      r += 1;
    } else {
      out.push([i]);
      i += 1;
    }
  }
  return out;
}

/** Where each exercise stands in its superset, for its card: first, between
 *  two, or last; null when it's in none. */
export type SupersetPlace = "first" | "middle" | "last";
export function supersetPlaces(list: readonly SupersetMember[]): (SupersetPlace | null)[] {
  const places: (SupersetPlace | null)[] = list.map(() => null);
  for (const run of supersetRuns(list)) {
    run.forEach((i, k) => { places[i] = k === 0 ? "first" : k === run.length - 1 ? "last" : "middle"; });
  }
  return places;
}

/** Each exercise's superset id when it's really in one, else undefined: what
 *  a session saves. */
export function supersetIdsOf(list: readonly SupersetMember[]): (string | undefined)[] {
  const ids: (string | undefined)[] = list.map(() => undefined);
  for (const run of supersetRuns(list)) for (const i of run) ids[i] = idOf(list[i]);
  return ids;
}

/** `m` with no superset id. */
function alone<T extends SupersetMember>(m: T): T {
  const { supersetId: _drop, ...rest } = m;
  return rest as T;
}

/** The list with the ids of exercises in no superset dropped: one left on its
 *  own, or apart from its partners. The same array when there's nothing to
 *  drop. */
export function cleanSupersets<T extends SupersetMember>(list: readonly T[]): T[] {
  const keep = supersetIdsOf(list);
  let changed = false;
  const out = list.map((m, i) => {
    if (m.supersetId === undefined || keep[i] === m.supersetId) return m;
    changed = true;
    return alone(m);
  });
  return changed ? out : (list as T[]);
}

/** Every superset in a day's list cleaned (cleanSupersets), day by day: the
 *  same map when nothing changes. */
export function cleanSupersetsIn<T extends SupersetMember>(map: Record<string, T[]>): Record<string, T[]> {
  let changed = false;
  const out: Record<string, T[]> = {};
  for (const [key, list] of Object.entries(map)) {
    const cleaned = Array.isArray(list) ? cleanSupersets(list) : list;
    if (cleaned !== list) changed = true;
    out[key] = cleaned;
  }
  return changed ? out : map;
}

/**
 * The exercise at `pick` joined to the superset of the one at `at` (making
 * one of the two when `at` is in none), moved to just after its last member,
 * and every member given `at`'s rest, the superset's. It leaves any superset it
 * was in. The list unchanged when it's already in `at`'s, or either is out of
 * range.
 */
export function joinSuperset<T extends SupersetMember & { restSeconds?: number }>(
  list: readonly T[],
  at: number,
  pick: number,
  newId: () => string = makeSupersetId,
): T[] {
  if (at === pick || !list[at] || !list[pick]) return [...list];
  if (runOf(list, at)?.includes(pick)) return [...list];
  // Out of where it was: a superset of two it leaves is none.
  const base = cleanSupersets(list.filter((_, k) => k !== pick).map(m => m));
  const target = at > pick ? at - 1 : at;
  const run = runOf(base, target) ?? [target];
  const id = run.length > 1 ? idOf(base[target]) : newId();
  const rest = base[target].restSeconds;
  const joined: T = { ...alone(list[pick]), supersetId: id };
  const out = [...base];
  out.splice(run[run.length - 1] + 1, 0, joined);
  const members = new Set([...run, run[run.length - 1] + 1]);
  return out.map((m, k) => {
    if (!members.has(k)) return m;
    const withId = m.supersetId === id ? m : { ...m, supersetId: id };
    return rest === undefined || withId.restSeconds === rest ? withId : { ...withId, restSeconds: rest };
  });
}

/**
 * The exercise at `i` out of its superset: from either end it just leaves;
 * from between two it steps out to just after the superset, which stays
 * whole. A superset left with one is none. The list cleaned and otherwise
 * unchanged when it's in none.
 */
export function leaveSuperset<T extends SupersetMember>(list: readonly T[], i: number): T[] {
  const run = runOf(list, i);
  if (!run) return cleanSupersets(list);
  const first = run[0];
  const last = run[run.length - 1];
  if (i === first || i === last) return cleanSupersets(list.map((m, k) => (k === i ? alone(m) : m)));
  const out = list.filter((_, k) => k !== i);
  // The superset's last member is now at last - 1: just after it.
  out.splice(last, 0, alone(list[i]));
  return cleanSupersets(out);
}

/**
 * A reorder's move (the reorder sheet's drop: the exercise at `from` put at
 * `to` in the list without it) keeping supersets whole. Moved within its own
 * superset it stays in it, in its new place; moved apart from its partners it
 * leaves it; dropped between two members of another superset it lands just
 * past that superset, after it going down and before it going up, rather than
 * splitting it.
 */
export function moveKeepingSupersets<T extends SupersetMember>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || !list[from] || to < 0 || to >= list.length) return [...list];
  const moving = list[from];
  const own = idOf(moving);
  const ownRun = runOf(list, from);
  const rest = list.filter((_, k) => k !== from);
  let at = to;
  const before = rest[at - 1];
  const after = rest[at];
  const inside = before && after && idOf(before) !== "" && idOf(before) === idOf(after);
  if (inside && idOf(before) !== own) {
    // Between two of another superset's members: to its far edge.
    const run = runOf(rest, at - 1) ?? [at - 1];
    at = to > from ? run[run.length - 1] + 1 : run[0];
  }
  const out = [...rest];
  out.splice(at, 0, moving);
  // Still in its own superset only if it's still whole around it.
  if (own && ownRun) {
    const now = runOf(out, at);
    if (!now || now.length !== ownRun.length) out[at] = alone(moving);
  }
  return cleanSupersets(out);
}

/** A set as the order and the rest read it. */
type Ticked = { done: boolean };
type RoundLog = Readonly<Record<string, { warmup: readonly Ticked[]; working: readonly Ticked[] } | undefined>>;

/** A session's sets in the order they're done: block by block, a superset's
 *  warm-ups (each member's, in turn) then its rounds, any other exercise its
 *  warm-ups then its working sets. Each is [exercise index, kind, index in
 *  that kind]. */
export function setsInSessionOrder(
  supersetIds: readonly (string | undefined)[],
  counts: readonly { warmup: number; working: number }[],
): [number, "warmup" | "working", number][] {
  const out: [number, "warmup" | "working", number][] = [];
  // One per exercise in `counts`, each with its id when it has one.
  for (const block of blocksOf(counts.map((_, i) => ({ supersetId: supersetIds[i] })))) {
    for (const i of block) for (let k = 0; k < (counts[i]?.warmup ?? 0); k++) out.push([i, "warmup", k]);
    const rounds = Math.max(0, ...block.map(i => counts[i]?.working ?? 0));
    for (let r = 0; r < rounds; r++) {
      for (const i of block) if (r < (counts[i]?.working ?? 0)) out.push([i, "working", r]);
    }
  }
  return out;
}

/**
 * The rest to start once a set is ticked: the exercise's own, except a
 * superset's working set that another member's set of the same round is still
 * waiting for, which is none (straight on to it; the timer's start dismisses a
 * rest still running). So a round rests once, after its last set, whichever
 * order its sets were done in. `log` is as it stands with the set ticked or
 * not; the set itself never counts.
 */
export function restAfterSet(
  exercises: readonly (SupersetMember & { id: string; restSeconds?: number })[],
  log: RoundLog,
  exId: string,
  type: "warmup" | "working",
  idx: number,
): number {
  const i = exercises.findIndex(e => e.id === exId);
  if (i < 0) return 0;
  const own = exercises[i].restSeconds ?? 0;
  if (type !== "working") return own;
  const run = runOf(exercises, i);
  if (!run) return own;
  const waiting = run.some(k => k !== i && log[exercises[k].id]?.working[idx]?.done === false);
  return waiting ? 0 : own;
}

/** "Shoulder Press", "Shoulder Press and Rows", "Rows, Dips and Curls". */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The names of the others in the superset of the exercise at `i`, in order;
 *  none when it's in none. */
export function partnerNames<T extends SupersetMember & { name: string }>(list: readonly T[], i: number): string[] {
  return (runOf(list, i) ?? []).filter(k => k !== i).map(k => list[k].name);
}

/**
 * For an exercise's Superset With step (components/SupersetPickStep.tsx): what
 * else it can be put in a superset with, the list's others in order but those
 * already in its superset, each with the others of the superset it's in (it
 * leaves that one); and its own superset's others. `i` -1 is none.
 */
export function supersetChoicesFor<T extends SupersetMember & { name: string }>(
  list: readonly T[],
  i: number,
  keyOf: (item: T, index: number) => string,
): { choices: { key: string; name: string; with?: string[] }[]; partners: string[] } {
  if (i < 0 || !list[i]) return { choices: [], partners: [] };
  const own = new Set(runOf(list, i) ?? [i]);
  const choices = list.flatMap((m, k) => {
    if (own.has(k)) return [];
    const others = partnerNames(list, k);
    return [{ key: keyOf(m, k), name: m.name, ...(others.length ? { with: others } : {}) }];
  });
  return { choices, partners: partnerNames(list, i) };
}

/** Each superset member's "Superset with …" line, by key, for a list of rows
 *  (the reorder sheet's). */
export function supersetLines<T extends SupersetMember & { name: string }>(
  list: readonly T[],
  keyOf: (item: T, index: number) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  list.forEach((m, i) => {
    const others = partnerNames(list, i);
    if (others.length) out.set(keyOf(m, i), `Superset with ${namesList(others)}`);
  });
  return out;
}
