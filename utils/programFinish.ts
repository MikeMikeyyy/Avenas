// utils/programFinish.ts
//
// The phone side of a program ending by itself (user decision, 2026-11-05: once
// the last session is done it completes; Mark Complete is for ending one
// early). The rules are pure, in utils/programLifecycle.ts: runFinishedOn says
// when a run has finished (its last session done, or its last day gone by),
// completeFinishedRun completes it, and programsAfterDeletedSession picks it
// back up when the session that finished it is deleted (Delete & Redo on the
// last workout). Here they're read from and written to the phone.
//
// Asked after each session is saved (the Workout tab's Finish, a workout filed
// unfinished, a Journal log), after one is deleted, and as the app opens and
// comes back to the front (utils/programPause.ts settleActiveProgram, before
// the week-idle hold). No react-native here: the session store imports this,
// and scripts/verify-unfinished-session.ts loads that under plain Node.

import {
  PROGRAMS_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_HISTORY_KEY,
  type CompletedWorkout, type SavedProgram,
} from "../constants/programs";
import { scheduleCloudPush } from "../lib/syncManager";
import { awardProgramAchievement } from "./achievementStore";
import { completeFinishedRun, programsAfterDeletedSession } from "./programLifecycle";
import { getJSON, removeKey, setJSON } from "./storage";
import { getEffectiveToday, type DayOverride } from "./workout";

async function readPrograms(): Promise<SavedProgram[]> {
  const list = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  return Array.isArray(list) ? list : [];
}

async function readHistory(): Promise<CompletedWorkout[]> {
  const list = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Complete the active program when its run has finished, on the day it did,
 * as Mark Complete would: it's backed up, and having run its full length it
 * earns the achievement. Returns the program as completed, or null when
 * nothing finished. Never throws.
 *
 * Today's pick goes with the run when nothing's been done on it, as Mark
 * Complete's does: Home would offer it with no program to do it in, while the
 * Workout tab said No Active Program. One already done stays, so a Delete &
 * Redo of the last session (which picks the program back up) redoes the day
 * that was picked; one from another day is never read, so it's left alone.
 */
export async function completeIfFinished(): Promise<SavedProgram | null> {
  try {
    const programs = await readPrograms();
    const active = programs.find(p => p.status === "active") ?? null;
    if (!active) return null;
    const history = await readHistory();
    // The day the app is on: before 3am, a last workout from last night can
    // still be done.
    const today = getEffectiveToday(active, history);
    const { programs: updated, finished } = completeFinishedRun(programs, history, today);
    if (!finished) return null;
    await setJSON(PROGRAMS_KEY, updated);
    const pick = await getJSON<DayOverride | null>(WORKOUT_DAY_OVERRIDE_KEY, null);
    if (pick?.date === today && !history.some(w => w.date === today)) await removeKey(WORKOUT_DAY_OVERRIDE_KEY);
    scheduleCloudPush();
    void awardProgramAchievement(finished.program, finished.week);
    return updated.find(p => p.id === finished.program.id) ?? null;
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "completeIfFinished", PROGRAMS_KEY, e);
    return null;
  }
}

/**
 * After `deleted` has been taken out of the history: the program it finished
 * picked back up, when it's what finished it and the program's last day hasn't
 * gone by (programsAfterDeletedSession). True when one was. Never throws.
 */
export async function reopenIfUnfinished(deleted: CompletedWorkout): Promise<boolean> {
  try {
    const programs = await readPrograms();
    const updated = programsAfterDeletedSession(programs, deleted, await readHistory());
    if (updated === programs) return false;
    await setJSON(PROGRAMS_KEY, updated);
    scheduleCloudPush();
    return true;
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "reopenIfUnfinished", PROGRAMS_KEY, e);
    return false;
  }
}
