// scripts/verify-journal-feed.ts
//
// The Journal timeline: what reaches it, in what order, and what doesn't.
//
// Run: npx tsx scripts/verify-journal-feed.ts

import { buildJournalFeed, sessionFeed, sessionNumbers } from "../utils/journalFeed";
import type { CompletedWorkout } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${what}\n    expected ${b}\n    actual   ${a}`);
}

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const entry = (id: string, createdAt: string): JournalEntry =>
  ({ id, title: id, body: "", createdAt });

/** `date` is the day TRAINED, `completedAt` when it was written — deliberately
 *  different here, because that gap is what a backdated log looks like. */
const workout = (id: string, completedAt: string, date = "2000-01-01"): CompletedWorkout =>
  ({ id, date, workoutName: id, completedAt, exercises: [], duration: 0 } as unknown as CompletedWorkout);

const ids = (items: { data: { id: string } }[]) => items.map(i => i.data.id);
const feed = (o: Partial<Parameters<typeof buildJournalFeed>[0]> = {}) =>
  buildJournalFeed({ entries: [], workouts: [], windowDays: 14, now: NOW, ...o });

// ─── both sources reach it ───────────────────────────────────────────────────
eq(
  ids(feed({ entries: [entry("j", daysAgo(1))], workouts: [workout("w", daysAgo(2))] })),
  ["j", "w"],
  "entries and workouts are one list",
);
eq(feed().length, 0, "nothing in, nothing out");

// ─── ordering ────────────────────────────────────────────────────────────────
eq(
  ids(feed({
    entries: [entry("j-old", daysAgo(5)), entry("j-new", daysAgo(1))],
    workouts: [workout("w-mid", daysAgo(3))],
  })),
  ["j-new", "w-mid", "j-old"],
  "newest first, interleaved across both sources",
);

// ─── the window ──────────────────────────────────────────────────────────────
eq(
  ids(feed({ entries: [entry("in", daysAgo(13)), entry("out", daysAgo(15))] })),
  ["in"],
  "14-day window drops what's older",
);
eq(
  ids(feed({ windowDays: 30, entries: [entry("in", daysAgo(29)), entry("out", daysAgo(31))] })),
  ["in"],
  "the window is a parameter: a client's journal reaches back a month",
);
eq(
  ids(feed({ entries: [entry("edge", new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString())] })),
  ["edge"],
  "the cutoff itself is included, not dropped",
);
eq(
  ids(feed({ entries: [entry("future", daysAgo(-1))] })),
  ["future"],
  "a timestamp in the future still shows (a clock change shouldn't hide an entry)",
);

// ─── a workout is placed by completedAt, NOT by the day it was trained ───────
eq(
  ids(feed({
    entries: [entry("written-today", daysAgo(0))],
    // Trained a year ago, logged a minute ago: it belongs at the top, where the
    // user just put it, not filtered out for being a year old.
    workouts: [workout("backdated", daysAgo(0), "2025-09-18")],
  })),
  ["written-today", "backdated"],
  "a backdated log is placed by when it was WRITTEN",
);
eq(
  ids(feed({ workouts: [workout("old-log", daysAgo(20), "2026-09-18")] })),
  [],
  "...and an old log doesn't reappear just because its trained date is recent",
);

// ─── bad data is invisible, not first ────────────────────────────────────────
eq(
  ids(feed({
    entries: [entry("good", daysAgo(1)), entry("broken", "not a date")],
    workouts: [workout("also-broken", "")],
  })),
  ["good"],
  "an unparseable timestamp is dropped rather than sorted somewhere arbitrary",
);

// ─── the session filter ──────────────────────────────────────────────────────
// Session numbers as the cards would read them; "free" belongs to no program.
const SESSION: Record<string, number | null> = { a1: 1, b1: 1, a2: 2, a3: 3, old1: 1, free: null, bad: 2 };
const sessionOf = (w: CompletedWorkout) => SESSION[w.id] ?? null;
const history = [
  workout("a1", daysAgo(15)), workout("b1", daysAgo(3)), workout("a2", daysAgo(8)),
  workout("a3", daysAgo(1)), workout("old1", daysAgo(90)), workout("free", daysAgo(2)),
  workout("bad", "not a date"),
];
const groups = (selected: number[]) =>
  sessionFeed({ workouts: history, sessionOf, selected: new Set(selected) })
    .map(g => [g.session, ids(g.items)]);

eq(sessionNumbers(history, sessionOf), [1, 2, 3], "the chips are every number the history holds, ascending, once each");
eq(sessionNumbers([workout("free", daysAgo(1))], sessionOf), [], "no program sessions, no chips");
eq(groups([1]), [[1, ["b1", "a1", "old1"]]], "one number: all of its sessions, newest first, from the whole history, not the window");
eq(groups([3, 1]), [[1, ["b1", "a1", "old1"]], [3, ["a3"]]], "several at once, grouped by number ascending whatever order they were picked in");
eq(groups([2]), [[2, ["a2"]]], "an unparseable completedAt is dropped here too");
eq(groups([4]), [], "a number nothing was finds nothing");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ journal feed invariants hold");
