// utils/journalFeed.ts
//
// The Journal timeline: journal entries and completed workouts in one
// newest-first list.
//
// They are separate stores on purpose (@avenas_journal_entries and
// @avenas/workout_history, separate cloud tables, separate writers) and nothing
// here changes that — the merge is a RENDER concern, and this is the one place
// it happens. Two screens show this feed, as Recent Activity, over the same
// RECENT_ACTIVITY_DAYS:
//
//   app/journal.tsx                        your own
//   components/journal/ClientJournalView   a client's, on the trainer's client
//                                          page
//
// They had a copy each, and the windows had already drifted apart. A client's
// reached back 30 days, as something a trainer reviews, until the user asked
// for it to show what their own does (2026-11-07). Which field each side is
// timestamped by, what gets dropped and the ordering are decided here too, so
// the two feeds can't disagree about anything.
//
// The two sides are timestamped by DIFFERENT fields, and that's the part worth
// getting right in one place: an entry by `createdAt`, a workout by
// `completedAt`. A workout's `date` is the day it was TRAINED, which for a
// backdated log (journal → log a past workout) is weeks before it was written.
// Ordering by `date` would file it under a day you never opened the app.
//
// Both screens also filter Recent Activity by session number ("3rd session" on
// a card), several at once: `sessionNumbers` and `sessionFeed` below.
//
// Pure: no RN imports, so scripts/verify-journal-feed.ts can run it.

import type { CompletedWorkout } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";

export type JournalFeedItem =
  | { kind: "journal"; data: JournalEntry; ts: number }
  | { kind: "workout"; data: CompletedWorkout; ts: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back Recent Activity reaches, on your Journal and a client's
 *  alike. Older workouts are a tap on their day of the calendar away, and the
 *  session filter searches the whole history (sessionFeed). */
export const RECENT_ACTIVITY_DAYS = 14;

/**
 * Entries and workouts from the last `windowDays`, newest first.
 *
 * An item whose timestamp can't be parsed is DROPPED rather than floated to one
 * end: it has no place in a time-ordered list, and `NaN` compares false against
 * everything, so leaving it in would put it wherever the sort happened to land
 * it. Bad data should be invisible here, not first.
 *
 * Ties keep their input order (sort is stable), which puts a journal entry
 * above a workout written in the same millisecond. Nothing depends on that; it
 * just needs to be the same on both screens.
 */
export function buildJournalFeed({ entries, workouts, windowDays, now = Date.now() }: {
  entries: JournalEntry[];
  workouts: CompletedWorkout[];
  /** How far back the feed reaches. */
  windowDays: number;
  /** Injectable for tests. */
  now?: number;
}): JournalFeedItem[] {
  const cutoff = now - windowDays * DAY_MS;

  const items: JournalFeedItem[] = [
    ...entries.map((data): JournalFeedItem => ({ kind: "journal", data, ts: Date.parse(data.createdAt) })),
    ...workouts.map((data): JournalFeedItem => ({ kind: "workout", data, ts: Date.parse(data.completedAt) })),
  ].filter(i => Number.isFinite(i.ts) && i.ts >= cutoff);

  return items.sort((a, b) => b.ts - a.ts);
}

/** Which session of its program day a workout was, the number its card reads
 *  ("3rd session"), or null for one no program owns. Each screen passes its
 *  `useJournalWorkoutInfo`, so the filter and the card can't disagree. */
export type SessionOf = (w: CompletedWorkout) => number | null;

/** The session numbers anything in `workouts` was, ascending: the choices the
 *  Recent Activity filter offers. */
export function sessionNumbers(workouts: CompletedWorkout[], sessionOf: SessionOf): number[] {
  const seen = new Set<number>();
  for (const w of workouts) {
    const n = sessionOf(w);
    if (n != null) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Recent Activity filtered to the session numbers picked: every workout whose
 * number is one of `selected`, grouped by number ascending, newest first within
 * each.
 *
 * Over the WHOLE history, not the feed's window: a program day comes round once
 * a week, so a fortnight holds about two numbers per day and "every 1st
 * session" would find nothing. Journal entries have no number and never match.
 * An unparseable completedAt is dropped, as it is from the feed.
 */
export function sessionFeed({ workouts, sessionOf, selected }: {
  workouts: CompletedWorkout[];
  sessionOf: SessionOf;
  selected: ReadonlySet<number>;
}): { session: number; items: JournalFeedItem[] }[] {
  const groups = new Map<number, JournalFeedItem[]>();
  for (const data of workouts) {
    const n = sessionOf(data);
    const ts = Date.parse(data.completedAt);
    if (n == null || !selected.has(n) || !Number.isFinite(ts)) continue;
    const group = groups.get(n) ?? [];
    group.push({ kind: "workout", data, ts });
    groups.set(n, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([session, items]) => ({ session, items: items.sort((a, b) => b.ts - a.ts) }));
}
