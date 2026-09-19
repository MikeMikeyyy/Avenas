// utils/journalFeed.ts
//
// The Journal timeline: journal entries and completed workouts in one
// newest-first list.
//
// They are separate stores on purpose (@avenas_journal_entries and
// @avenas/workout_history, separate cloud tables, separate writers) and nothing
// here changes that — the merge is a RENDER concern, and this is the one place
// it happens. Two screens show this feed:
//
//   app/journal.tsx                        your own, 14 days
//   components/journal/ClientJournalView   a client's, on the trainer's client
//                                          page, 30 days
//
// They had a copy each, and the windows had already drifted apart. The window
// stays a parameter (the difference is real: your own journal is a working log,
// a client's is something a trainer reviews), but everything else — which field
// each side is timestamped by, what gets dropped, the ordering — is decided
// here so the two feeds can't disagree about anything else.
//
// The two sides are timestamped by DIFFERENT fields, and that's the part worth
// getting right in one place: an entry by `createdAt`, a workout by
// `completedAt`. A workout's `date` is the day it was TRAINED, which for a
// backdated log (journal → log a past workout) is weeks before it was written.
// Ordering by `date` would file it under a day you never opened the app.
//
// Pure: no RN imports, so scripts/verify-journal-feed.ts can run it.

import type { CompletedWorkout } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";

export type JournalFeedItem =
  | { kind: "journal"; data: JournalEntry; ts: number }
  | { kind: "workout"; data: CompletedWorkout; ts: number };

const DAY_MS = 24 * 60 * 60 * 1000;

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
