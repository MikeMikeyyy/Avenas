// utils/nextSet.ts
//
// Where a workout session is up to. One answer for everything that points at
// it: the glowing set on the Workout screen, the lock screen's next set (and the
// order its tick button walks the rest in), and the card the page opens on after
// a relaunch or a tap on the in-progress bar.
//
// It follows the set you ticked LAST, by when you ticked it (user decision,
// 2026-09-30). Sets left unticked behind it were skipped: they wait for the end,
// where Complete Workout's "Incomplete Sets" warning takes you back to them. It
// used to be the first unticked set on the page, so one skipped set held the
// glow and the lock screen on it for the rest of the session, and a lock-screen
// tick landed on the skipped set instead of the one just done.
//
// After the set ticked last, the order is:
//   1. every unticked set below it on the page: the rest of the exercise you're
//      on, then the exercises after it (a superset partner included);
//   2. then, from the top, exercises you haven't started (you did a later one
//      first while a machine was taken);
//   3. then the skipped sets: unticked, above it, in exercises you've started.
// With nothing ticked it's just the page's order. A set ticked without a time
// (a draft saved by an older build) counts as older than any timed one, and
// between two of those the lower on the page is the later.

export type TickableSet = { done: boolean; doneAt?: number };

type TickableLog = Record<string, { warmup: TickableSet[]; working: TickableSet[] } | undefined>;

export type PendingSetRef = {
  exId: string;
  /** The exercise's place on the page. */
  exIndex: number;
  setType: "warmup" | "working";
  /** Index within that type's array in the log. */
  setIdx: number;
  /** Row on the exercise's card, warmups first, the way the card draws them. */
  flatIdx: number;
  /** Left unticked behind the set ticked last, in an exercise already started. */
  skipped: boolean;
};

/** Every unticked set, in the order the session will get to them. */
export function pendingSetsInOrder(exerciseIds: readonly string[], log: TickableLog): PendingSetRef[] {
  type Row = Omit<PendingSetRef, "skipped"> & { set: TickableSet };
  const rows: Row[] = [];
  exerciseIds.forEach((exId, exIndex) => {
    const exLog = log[exId];
    if (!exLog) return;
    exLog.warmup.forEach((set, setIdx) => {
      rows.push({ exId, exIndex, setType: "warmup", setIdx, flatIdx: setIdx, set });
    });
    exLog.working.forEach((set, setIdx) => {
      rows.push({ exId, exIndex, setType: "working", setIdx, flatIdx: exLog.warmup.length + setIdx, set });
    });
  });

  // The set ticked last. `>=` hands a tie (two untimed ticks) to the lower row.
  let anchor = -1;
  let latest = -Infinity;
  rows.forEach((r, i) => {
    if (!r.set.done) return;
    const at = r.set.doneAt ?? 0;
    if (at >= latest) { latest = at; anchor = i; }
  });

  const pending = (r: Row, skipped: boolean): PendingSetRef => ({
    exId: r.exId, exIndex: r.exIndex, setType: r.setType, setIdx: r.setIdx, flatIdx: r.flatIdx, skipped,
  });
  if (anchor === -1) return rows.filter(r => !r.set.done).map(r => pending(r, false));

  const started = new Set(rows.filter(r => r.set.done).map(r => r.exIndex));
  const below: PendingSetRef[] = [];
  const unstarted: PendingSetRef[] = [];
  const skipped: PendingSetRef[] = [];
  rows.forEach((r, i) => {
    if (r.set.done) return;
    if (i > anchor) below.push(pending(r, false));
    else if (!started.has(r.exIndex)) unstarted.push(pending(r, false));
    else skipped.push(pending(r, true));
  });
  return [...below, ...unstarted, ...skipped];
}

/** The set a session is up to: the head of pendingSetsInOrder, or null once every set is ticked. */
export function nextSetOf(exerciseIds: readonly string[], log: TickableLog): PendingSetRef | null {
  return pendingSetsInOrder(exerciseIds, log)[0] ?? null;
}
