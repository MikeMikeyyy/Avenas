// utils/importStore.ts
//
// An import from another app saved, and undone (Settings > Import & Export,
// utils/workoutImport.ts). The sessions go in as the Journal's log saves one
// (app/log-workout.tsx): into the workout history, their days into the workout
// dates. No achievement cards: these are old sessions, not ones just done, and
// a hundred-workout milestone for a file would mean nothing.
//
// What each import added is kept on this phone (IMPORT_LOG_KEY) so it can be
// undone (user request, 2026-10-23): each session by its day, finish and name,
// which a restore keeps (it gives every session a new id). An imported session
// edited since keeps its place if its finish or name changed. Never synced: a
// new phone has nothing to undo.
//
// Read and written in one go, with what was there put back if any write fails,
// so an import or an undo happens whole or not at all, and fails out loud
// (throws): the screen says so.
//
// The file read for the review waits here in memory meanwhile
// (setPendingImport), being too big to pass to the review screen as a param.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { IMPORT_LOG_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout } from "../constants/programs";
import { getJSON } from "./storage";
import type { ImportSource, ParsedImport } from "./workoutImport";

export type ImportRecord = {
  /** When it was imported (epoch ms): also which one it is. */
  at: number;
  source: ImportSource;
  workouts: { date: string; completedAt: string; workoutName: string }[];
};

/** More history than the phone can hold (an Android limit, see saveImport). */
export class ImportTooLargeError extends Error {}

/**
 * The most the saved history may come to on Android, in characters. Android's
 * storage (AsyncStorage's SQLite) reads a value back through a 2 MB window,
 * so a history saved any bigger couldn't be read again and would look empty;
 * about 650 workouts of six exercises fit. iPhones keep each value in a file of
 * its own, with no such limit.
 */
export const ANDROID_HISTORY_LIMIT_CHARS = 1_500_000;

const keyOf = (w: Pick<CompletedWorkout, "date" | "completedAt" | "workoutName">) =>
  `${w.date}|${w.completedAt}|${w.workoutName}`;

/** Every import still on record, newest first. */
export async function loadImports(): Promise<ImportRecord[]> {
  const list = await getJSON<ImportRecord[]>(IMPORT_LOG_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** A key's raw value; a value that isn't JSON throws rather than reading as
 *  empty, so nothing is written over what's there. */
async function readList<T>(key: string): Promise<{ raw: string | null; list: T[] }> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return { raw, list: [] };
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error(`${key} isn't a list`);
  return { raw, list: list as T[] };
}

/** Writes each value in turn; on a failure, puts back what was there and throws. */
async function writeAll(writes: { key: string; value: string; was: string | null }[]): Promise<void> {
  const done: typeof writes = [];
  try {
    for (const w of writes) {
      await AsyncStorage.setItem(w.key, w.value);
      done.push(w);
    }
  } catch (e) {
    for (const w of done.reverse()) {
      try {
        if (w.was === null) await AsyncStorage.removeItem(w.key);
        else await AsyncStorage.setItem(w.key, w.was);
      } catch {
        // Nothing more to try: the error below is what's reported.
      }
    }
    throw e;
  }
}

/**
 * Adds `workouts` to the history. Any on a day that has a workout by now is
 * left out (the review counted against the history as it was then).
 * `maxHistoryChars` caps the history's saved size: Android's storage can't
 * read back a value much over 2 MB, and a history it can't read back would
 * read as empty.
 */
export async function saveImport(
  workouts: CompletedWorkout[],
  source: ImportSource,
  opts: { maxHistoryChars?: number; now?: number } = {},
): Promise<{ added: number; skipped: number }> {
  const history = await readList<CompletedWorkout>(WORKOUT_HISTORY_KEY);
  const taken = new Set(history.list.map(w => w.date));
  const adding = workouts.filter(w => !taken.has(w.date));
  if (adding.length === 0) return { added: 0, skipped: workouts.length };

  const nextHistory = JSON.stringify([...history.list, ...adding]);
  if (opts.maxHistoryChars !== undefined && nextHistory.length > opts.maxHistoryChars) {
    throw new ImportTooLargeError("history too large");
  }
  const dates = await readList<string>(WORKOUT_DATES_KEY);
  const nextDates = [...new Set([...dates.list, ...adding.map(w => w.date)])];
  const log = await readList<ImportRecord>(IMPORT_LOG_KEY);
  const record: ImportRecord = {
    at: opts.now ?? Date.now(),
    source,
    workouts: adding.map(w => ({ date: w.date, completedAt: w.completedAt, workoutName: w.workoutName })),
  };
  await writeAll([
    { key: WORKOUT_HISTORY_KEY, value: nextHistory, was: history.raw },
    { key: WORKOUT_DATES_KEY, value: JSON.stringify(nextDates), was: dates.raw },
    { key: IMPORT_LOG_KEY, value: JSON.stringify([record, ...log.list]), was: log.raw },
  ]);
  return { added: adding.length, skipped: workouts.length - adding.length };
}

/**
 * Takes out what the import made at `at` added, and its record. A day keeps
 * its place in the workout dates while anything else is logged on it. How many
 * sessions came out.
 */
export async function undoImport(at: number): Promise<number> {
  const log = await readList<ImportRecord>(IMPORT_LOG_KEY);
  const record = log.list.find(r => r.at === at);
  if (!record) return 0;
  const history = await readList<CompletedWorkout>(WORKOUT_HISTORY_KEY);
  // As many of each as it added: the same session twice comes out twice.
  const owed = new Map<string, number>();
  for (const w of record.workouts) owed.set(keyOf(w), (owed.get(keyOf(w)) ?? 0) + 1);
  const kept = history.list.filter(w => {
    const n = owed.get(keyOf(w)) ?? 0;
    if (n === 0) return true;
    owed.set(keyOf(w), n - 1);
    return false;
  });
  const dates = await readList<string>(WORKOUT_DATES_KEY);
  const stillLogged = new Set(kept.map(w => w.date));
  const freed = new Set(record.workouts.map(w => w.date).filter(d => !stillLogged.has(d)));
  await writeAll([
    { key: WORKOUT_HISTORY_KEY, value: JSON.stringify(kept), was: history.raw },
    { key: WORKOUT_DATES_KEY, value: JSON.stringify(dates.list.filter(d => !freed.has(d))), was: dates.raw },
    { key: IMPORT_LOG_KEY, value: JSON.stringify(log.list.filter(r => r.at !== at)), was: log.raw },
  ]);
  return history.list.length - kept.length;
}

// ─── The file being reviewed ─────────────────────────────────────────────────

let pending: { parsed: ParsedImport; fileName: string } | null = null;

export function setPendingImport(next: { parsed: ParsedImport; fileName: string } | null): void {
  pending = next;
}

export function pendingImport(): { parsed: ParsedImport; fileName: string } | null {
  return pending;
}
