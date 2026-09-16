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
//           The button names the day, because that day is what gets dropped.
//   PUSH  — today empties AND the cycle slides a day later, so today's workout
//           lands tomorrow and everything after it follows. Phrased as moving
//           the workouts FORWARD: nothing is lost, it all just happens later.
//
// PUSH is permanent — there is no "week" for the cycle to snap back to — so the
// copy says so rather than letting someone discover it next Monday.

import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import { toYMD } from "./dates";
import { cycleDrift } from "./cycleDrift";
import { getWorkoutForDate, normalizeDriftDates, resolveDayIndex } from "./workout";
import { isDateSkipped, isDatePushed, isDatePulled, pullDate, pushDate, skipDate, unskipDate } from "./skippedDates";
import { scheduleCloudPush } from "../lib/syncManager";
import { resyncScheduledNotifications } from "./notificationScheduler";

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
    // normalizeDriftDates on every write, the same discipline canonicalizeWorkouts
    // gets: a mark stored earlier can be invalidated by the one being added now
    // (a push in front of a pull slides a workout onto it), and the reader is a
    // dumb count by design so it will not catch that itself.
    const updated = programs.map(p => (p.id === programId ? normalizeDriftDates(apply(p)) : p));
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    scheduleCloudPush();
    // The queued reminders were built against the OLD schedule, so without this
    // you get "Upper is on the schedule today" on a day you just marked off —
    // and after a pull, no reminder at all on the day the workout moved to.
    resyncScheduledNotifications();
  } catch (e) {
    warn("applyRestDay", e);
  }
}

/** The next date from `fromYMD` (inclusive) that the cycle rests on and that
 *  isn't already marked, or null within one cycle. What a push offers to spend
 *  so the program doesn't end up a day longer. */
export function nextRestDate(program: SavedProgram, fromYMD: string): string | null {
  for (let i = 0; i <= program.cycleDays; i++) {
    const ymd = addDays(fromYMD, i);
    if (!ymd) return null;
    if (isDateSkipped(program, ymd) || isDatePulled(program, ymd)) continue;
    if (program.pausedAt && ymd >= program.pausedAt) return null;
    const idx = resolveDayIndex(program, ymd);
    if (idx === null) continue;
    const name = program.cyclePattern[idx];
    if (!name || name === "Rest") return ymd;
  }
  return null;
}

function addDays(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return toYMD(d);
}

/** What the user settled on. `null` means they backed out and NOTHING was
 *  written — callers must not commit any of their own side effects either.
 *  "pushPull" moved the schedule AND spent a rest day to pay for it, so the
 *  program's length is unchanged. */
export type RestDayOutcome = "skip" | "push" | "pushPull" | null;

/** Short weekday label for a date, e.g. "Thu". Used in the repayment button,
 *  where the day name is more use than the date. */
function labelFor(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "the next";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + "'s";
}

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

  // Where the day could be paid back from, worked out against the schedule AS
  // IT WILL BE once the push lands — so the offer names a date that is really a
  // rest day, not one the push is about to move a workout onto.
  const afterPush = pushDate(program, ymd);
  const repay = nextRestDate(afterPush, addDays(ymd, 1) ?? ymd);

  return new Promise<RestDayOutcome>(resolve => {
    Alert.alert(
      "Rest day",
      `${scheduled.name} was scheduled. Skip it this round, or move it and everything after it forward a day?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        // Naming the day in the button is what makes the choices concrete: the
        // first drops THIS workout, the others keep it and differ only in who
        // pays for the extra day — the program's end, or a rest day.
        {
          text: `Skip "${scheduled.name}" this week`,
          onPress: () => { void commit(programId, p => skipDate(p, ymd)).then(() => resolve("skip")); },
        },
        {
          text: "Move workouts forward",
          onPress: () => { void commit(programId, p => pushDate(p, ymd)).then(() => resolve("push")); },
        },
        // Only offered when there IS a rest day to spend. On a cycle with no
        // rest in it, this would silently delete a session.
        ...(repay ? [{
          text: `Move forward, use ${labelFor(repay)} rest day`,
          onPress: () => {
            void commit(programId, p => pullDate(pushDate(p, ymd), repay))
              .then(() => resolve("pushPull"));
          },
        }] : []),
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Un-mark `ymd`: no longer rest, and no longer delaying anything after it.
 *
 * This IS the undo for "move workouts forward" — because a push is recorded
 * against the date rather than baked into `cycleOffset`, removing it restores
 * the original alignment exactly, however many other pushes exist elsewhere.
 * That reversibility is what the week strip's up arrow is advertising.
 */
export async function clearRestDay(programId: string, ymd: string): Promise<void> {
  return commit(programId, p => unskipDate(p, ymd));
}

/**
 * Spend the rest day on `ymd`: it schedules the next day's workout instead, and
 * everything after moves up with it, so the program finishes a day sooner.
 *
 * Confirms first, because unlike marking a day off this ADDS a session to a day
 * the user was expecting to be free. `clearRestDay` undoes it.
 */
export async function applyPullDay(programId: string, ymd: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(PROGRAMS_KEY).catch(() => null);
  const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
  const program = programs.find(p => p.id === programId);
  if (!program) return false;

  // What lands here once the rest is spent — named in the prompt so it's clear
  // this isn't just deleting a day off.
  const moved = getWorkoutForDate(pullDate(program, ymd), ymd);
  const drift = cycleDrift(program, ymd);

  return new Promise<boolean>(resolve => {
    Alert.alert(
      "Use this rest day?",
      moved
        ? `${moved.name} moves here, and everything after it comes forward a day.${drift > 0 ? " Your program goes back to finishing on its original date." : " Your program will finish a day earlier."}`
        : "Everything after this day comes forward a day.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Use it",
          onPress: () => { void commit(programId, p => pullDate(p, ymd)).then(() => resolve(true)); },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Convenience for screens that need to render the current state. */
export { isDateSkipped, isDatePushed, isDatePulled };
