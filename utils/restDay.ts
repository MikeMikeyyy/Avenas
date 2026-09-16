// utils/restDay.ts
//
// Marking a date as rest, from any screen. The pure rules live in
// utils/skippedDates.ts; this is the storage + prompt layer around them, the
// same split utils/programPause.ts uses for resuming.
//
// The prompt exists because "I'm not training today" is genuinely ambiguous and
// only the user knows which they mean:
//
//   SKIP  — today empties, the cycle holds its place. Tomorrow is whatever it
//           was already going to be, and this round's workout is just missed.
//   PUSH  — today empties AND the cycle slides a day later, so today's workout
//           lands tomorrow and everything after it follows.
//
// PUSH is permanent — there is no "week" for the cycle to snap back to — so the
// copy says so rather than letting someone discover it next Monday.

import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import { getWorkoutForDate } from "./workout";
import { isDateSkipped, isDatePushed, pushDate, skipDate, unskipDate } from "./skippedDates";
import { scheduleCloudPush } from "../lib/syncManager";

export type RestDayMode =
  /** Empty the date, leave the cycle alone. */
  | "skip"
  /** Empty the date and slide the whole cycle a day later. */
  | "push"
  /** Decide by asking — falls back to "skip" when there's nothing to push. */
  | "ask";

function warn(op: string, err: unknown) {
  if (__DEV__) console.warn("[avenas]", op, PROGRAMS_KEY, err);
}

async function commit(programId: string, apply: (p: SavedProgram) => SavedProgram): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
    const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
    const updated = programs.map(p => (p.id === programId ? apply(p) : p));
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    scheduleCloudPush();
  } catch (e) {
    warn("applyRestDay", e);
  }
}

/** What the user settled on. `null` means they backed out and NOTHING was
 *  written — callers must not commit any of their own side effects either. */
export type RestDayOutcome = "skip" | "push" | null;

/**
 * Mark `ymd` as a rest day on `programId`, returning what was actually applied.
 *
 * With mode "ask", prompts only when there is actually a workout to move — a
 * date the cycle already rests on, or one whose slot is empty, has nothing to
 * push, so it is marked off silently.
 *
 * The return value matters: cancelling has to leave the day completely
 * untouched, and the caller usually has its own state and a stored override to
 * roll back with it. So callers should do nothing until this resolves non-null,
 * rather than applying optimistically and undoing on cancel.
 *
 * Re-reads programs at commit time rather than trusting a snapshot the caller
 * is holding, since the Workout tab and Home both write this key.
 */
export async function applyRestDay(
  programId: string,
  ymd: string,
  mode: RestDayMode = "ask",
): Promise<RestDayOutcome> {
  if (mode === "skip") { await commit(programId, p => skipDate(p, ymd)); return "skip"; }
  if (mode === "push") { await commit(programId, p => pushDate(p, ymd)); return "push"; }

  const raw = await AsyncStorage.getItem(PROGRAMS_KEY).catch(() => null);
  const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
  const program = programs.find(p => p.id === programId);
  if (!program) return null;

  const scheduled = getWorkoutForDate(program, ymd);
  // Nothing scheduled to move: just mark it off without an interruption.
  if (!scheduled) { await commit(programId, p => skipDate(p, ymd)); return "skip"; }

  return new Promise<RestDayOutcome>(resolve => {
    Alert.alert(
      "Rest day",
      `${scheduled.name} was scheduled. Skip it, or push it and everything after it back a day?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        {
          text: "Just skip it",
          onPress: () => { void commit(programId, p => skipDate(p, ymd)).then(() => resolve("skip")); },
        },
        {
          text: "Push back a day",
          onPress: () => { void commit(programId, p => pushDate(p, ymd)).then(() => resolve("push")); },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Un-mark `ymd`: no longer rest, and no longer delaying anything after it.
 *
 * This IS "move them back a day" — because a push is recorded against the date
 * rather than baked into `cycleOffset`, removing it restores the original
 * alignment exactly, however many other pushes exist elsewhere.
 */
export async function clearRestDay(programId: string, ymd: string): Promise<void> {
  return commit(programId, p => unskipDate(p, ymd));
}

/** Convenience for screens that need to render the current state. */
export { isDateSkipped, isDatePushed };
