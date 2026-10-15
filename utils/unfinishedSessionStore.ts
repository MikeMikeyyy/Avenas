// utils/unfinishedSessionStore.ts
//
// The phone side of utils/unfinishedSession.ts. A session reaches the history
// by one road, Finish's and a filed session's alike (saveSessionToHistory).
// A session its day has left behind, never finished, goes to the Journal with
// what was entered in it (fileStaleDraft), and leaves a notice saying so for
// components/UnfinishedWorkoutWatcher.tsx to show once.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PROGRAMS_KEY, UNFINISHED_NOTICE_KEY, WORKOUT_DATES_KEY, WORKOUT_DRAFT_KEY, WORKOUT_HISTORY_KEY,
  WORKOUT_TIMER_PAUSED_KEY, WORKOUT_TIMER_START_KEY,
  type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { scheduleCloudPush } from "../lib/syncManager";
import { awardWorkoutAchievements } from "./achievementStore";
import { UNIT_KEY } from "./units";
import { getEffectiveToday } from "./workout";
import {
  completedFromDraft, draftIsOver, noticeFor, sessionSpan,
  type SavedClock, type UnfinishedNotice, type WorkoutDraft,
} from "./unfinishedSession";

/**
 * Adds a session to the history (newest first) and its day to the workout
 * dates, each read→write awaited in turn so a writer beside it can't be lost
 * (CLAUDE.md), then backs it up and checks it for records and milestones
 * against the history before it. A session already there (by id) isn't added
 * twice, so a filing cut short can run again. Returns the history after it.
 * Throws if storage does.
 */
export async function saveSessionToHistory(completed: CompletedWorkout, isKg: boolean): Promise<CompletedWorkout[]> {
  const datesRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
  const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
  if (!dates.includes(completed.date)) {
    await AsyncStorage.setItem(WORKOUT_DATES_KEY, JSON.stringify([...dates, completed.date]));
  }
  const histRaw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY);
  const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
  if (history.some(w => w.id === completed.id)) return history;
  const next = [completed, ...history];
  await AsyncStorage.setItem(WORKOUT_HISTORY_KEY, JSON.stringify(next));
  scheduleCloudPush();
  // PRs and workout milestones, checked against the history BEFORE this
  // session. Fire and forget: it never throws, and a failure mustn't block.
  void awardWorkoutAchievements(completed, history, isKg);
  return next;
}

/** A custom workout's name added to a program's other workouts
 *  (`extraWorkouts`), when it was started to be added to the program. */
export async function addExtraWorkout(programId: string, name: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
  const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
  let changed = false;
  const next = programs.map(p => {
    if (p.id !== programId) return p;
    const extras = p.extraWorkouts ?? [];
    if (extras.includes(name)) return p;
    changed = true;
    return { ...p, extraWorkouts: [...extras, name] };
  });
  if (changed) await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(next));
}

/** A saved number of milliseconds, or null. */
function savedMs(raw: string | null): number | null {
  const n = raw === null ? NaN : parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The workout clock as WorkoutTimerContext saved it. */
export async function loadSavedClock(): Promise<SavedClock> {
  const [startRaw, pausedRaw] = await Promise.all([
    AsyncStorage.getItem(WORKOUT_TIMER_START_KEY),
    AsyncStorage.getItem(WORKOUT_TIMER_PAUSED_KEY),
  ]);
  return { startMs: savedMs(startRaw), pausedMs: savedMs(pausedRaw) };
}

/** The Workout tab's saved session, if it holds one the tab could have written. */
export async function loadDraft(): Promise<WorkoutDraft | null> {
  const raw = await AsyncStorage.getItem(WORKOUT_DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw) as WorkoutDraft | null;
  if (!draft || typeof draft !== "object" || !draft.log || !draft.workoutInfo) return null;
  return draft;
}

// Told when a workout is filed while the app is open (the Workout tab's day
// ending under it), so the notice shows then rather than on the next return.
const filedListeners = new Set<() => void>();
export function onUnfinishedFiled(listener: () => void): () => void {
  filedListeners.add(listener);
  return () => { filedListeners.delete(listener); };
}

/** The notice of a workout filed unfinished, taken so it shows once. */
export async function takeUnfinishedNotice(): Promise<UnfinishedNotice | null> {
  try {
    const raw = await AsyncStorage.getItem(UNFINISHED_NOTICE_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(UNFINISHED_NOTICE_KEY);
    return JSON.parse(raw) as UnfinishedNotice;
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "takeUnfinishedNotice", UNFINISHED_NOTICE_KEY, e);
    return null;
  }
}

/**
 * The Workout tab's saved session, filed to the Journal once it's over: from a
 * day before today and not still being done (utils/unfinishedSession.ts
 * draftIsOver). Run at launch before anything is drawn (app/_layout.tsx), so
 * Home and the Journal open with it and the Workout tab starts on the new day,
 * and by the Workout tab when its day ends with the app open. A session still
 * on its day, or a late night still being logged, is left alone. One that's
 * over is saved if anything was entered in it, leaves a notice for
 * components/UnfinishedWorkoutWatcher.tsx, then goes, its clock with it: the
 * clock was its, and left running it showed a workout under way for hours.
 * Every step can run again, so a filing cut short finishes next time. `filed`
 * is what was saved; `stale` says a session that was over was found (and is
 * gone). Never throws.
 */
export function fileStaleDraft(now: Date = new Date()): Promise<{ stale: boolean; filed: CompletedWorkout | null }> {
  // One at a time: the launch, the Workout tab and the watcher can all ask at
  // once, and two reading the same draft would each save it (the history keeps
  // one, by id) and each leave a notice, which then showed twice.
  const run = filing.then(() => fileStaleDraftNow(now));
  filing = run.catch(() => {});
  return run;
}
let filing: Promise<unknown> = Promise.resolve();

async function fileStaleDraftNow(now: Date): Promise<{ stale: boolean; filed: CompletedWorkout | null }> {
  try {
    const [draft, progRaw, histRaw, clock, unitRaw] = await Promise.all([
      loadDraft(),
      AsyncStorage.getItem(PROGRAMS_KEY),
      AsyncStorage.getItem(WORKOUT_HISTORY_KEY),
      loadSavedClock(),
      AsyncStorage.getItem(UNIT_KEY),
    ]);
    // None, or not one the tab could have written: its restore throws that away.
    if (!draft) return { stale: false, filed: null };
    const programs: SavedProgram[] = progRaw ? JSON.parse(progRaw) : [];
    const active = programs.find(p => p.status === "active") ?? null;
    const history: CompletedWorkout[] = histRaw ? JSON.parse(histRaw) : [];
    if (!draftIsOver(draft, getEffectiveToday(active, history, now), clock, now.getTime())) {
      return { stale: false, filed: null };
    }

    // The unit setting is "kg" or "lbs", kg until changed (contexts/UnitContext.tsx).
    const isKg = unitRaw === null || unitRaw === "kg";
    // Named by when it ended, so filing the same session again finds it saved.
    const span = sessionSpan(draft, clock);
    const filed = completedFromDraft(draft, clock, `workout_${span ? span.end.getTime() : now.getTime()}`, isKg, now);
    if (filed) {
      await saveSessionToHistory(filed, isKg);
      await AsyncStorage.setItem(UNFINISHED_NOTICE_KEY, JSON.stringify(noticeFor(filed)));
    }
    await AsyncStorage.multiRemove([WORKOUT_DRAFT_KEY, WORKOUT_TIMER_START_KEY, WORKOUT_TIMER_PAUSED_KEY]);
    // As Finish does for a custom workout started to be added to the program.
    if (filed && draft.isFreeWorkout && draft.freeWorkoutAddToProgram && active) {
      await addExtraWorkout(active.id, filed.workoutName);
    }
    if (filed) filedListeners.forEach(l => l());
    return { stale: true, filed };
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "fileStaleDraft", WORKOUT_DRAFT_KEY, e);
    return { stale: false, filed: null };
  }
}
