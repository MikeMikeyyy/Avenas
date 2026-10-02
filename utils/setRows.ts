// utils/setRows.ts
//
// The Workout screen's set rows, by identity. Each set in a session has its own
// id (SetLog.id in app/(tabs)/workout.tsx), and a row is that set's: it opens
// when the set is added, closes when it's removed, and removing it takes
// exactly that set out of the log.
//
// They went by position: "working-3" was whichever set sat fourth, and "−"
// removed the last set once its row had closed. Add a set while that row was
// still closing (a second tap landing on Add Set as the row shrank under it)
// and the new set was the last one, so it was removed instead, while the closed
// row stayed in the log as a set you couldn't see or tick.
//
// Pure, so scripts/verify-rest-timer.ts can play the race out.

export type SetType = "warmup" | "working";

/** All a row needs of a set: its id. */
type Keyed = { id?: string };

/** A set row's key: its id, or where it sits for a set without one (the
 *  read-only rows of a completed workout). */
export function setRowKey(set: Keyed, type: SetType, localIdx: number): string {
  return set.id ?? `${type}-${localIdx}`;
}

/** An exercise's sets without the one whose row was removed. Null when there's
 *  nothing to take: no such set, or it's the exercise's only one. */
export function withoutSet<T extends Keyed>(warmup: T[], working: T[], rowKey: string): { warmup: T[]; working: T[] } | null {
  if (warmup.length + working.length <= 1) return null;
  const keep = (sets: T[], type: SetType) => sets.filter((s, i) => setRowKey(s, type, i) !== rowKey);
  const next = { warmup: keep(warmup, "warmup"), working: keep(working, "working") };
  return next.warmup.length === warmup.length && next.working.length === working.length ? null : next;
}

/** The rows a card last drew, and which of them just opened. */
export type DrawnRows = { sig: string; count: number; added: Set<string> | null };

const sigOf = (keys: string[]) => keys.join("|");

/** A card's first rows: none of them opens. */
export function firstRows(keys: string[]): DrawnRows {
  return { sig: sigOf(keys), count: keys.length, added: null };
}

/** The rows after a change to them. A row opens only when its set was added:
 *  every row drawn before is still there, with more after them. A swapped or
 *  reset exercise has all new sets, and opening every row of it would read as
 *  sets appearing out of nowhere. */
export function nextRows(prev: DrawnRows, keys: string[]): DrawnRows {
  const before = new Set(prev.sig ? prev.sig.split("|") : []);
  const fresh = keys.filter(k => !before.has(k));
  const allKept = keys.length - fresh.length === prev.count;
  return { sig: sigOf(keys), count: keys.length, added: allKept && fresh.length > 0 ? new Set(fresh) : null };
}

/** Whether the card's rows have changed since `drawn`. */
export const rowsChanged = (drawn: DrawnRows, keys: string[]) => drawn.sig !== sigOf(keys);
