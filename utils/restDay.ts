// utils/restDay.ts
//
// Not doing a planned workout, from any screen. The pure rules and the move
// planning live in utils/skippedDates.ts (testable, RN-free); this is the
// storage + prompt layer around them, the same split utils/programPause.ts uses
// for resuming.
//
// The prompt offers exactly two things, because those are the two things people
// mean when they miss a session:
//
//   MAKE REST DAY     — miss this one, the rest of the week is untouched.
//   MOVE TO TOMORROW  — it moves a day, the next rest day absorbs the shift,
//                       and you're back on your usual days after that.
//
// The message is one short line per button, named exactly as the button is,
// saying only what differs and naming a REAL day ("Thursday's rest becomes
// Legs"). A native alert grows with its message, so it's kept to that.
//
// An earlier version offered three choices with abstract labels, and its "use
// Friday's rest day" button named an internal bookkeeping date while THURSDAY
// was the day that visibly changed. Nobody could tell the choices apart. If the
// copy has to explain the model, the model is wrong; if it can describe the
// result in a line, it's right.

import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";
import { MONTH_NAMES, todayYMD } from "./dates";
import { getWorkoutForDate, normalizeDriftDates } from "./workout";
import { isDatePulled, isDatePushed, isDateSkipped, planDoItTomorrow, skipDate, unskipDate } from "./skippedDates";
import { scheduleCloudPush } from "../lib/syncManager";
import { resyncScheduledNotifications } from "./notificationScheduler";

export type RestDayMode =
  /** Miss the workout, leave the rest of the week alone. */
  | "skip"
  /** Move it to the next day and absorb the shift into the next rest day. */
  | "moveToTomorrow"
  /** Decide by asking. Days with nothing scheduled are just marked off. */
  | "ask";

function warn(op: string, err: unknown) {
  if (__DEV__) console.warn("[avenas]", op, PROGRAMS_KEY, err);
}

async function commit(programId: string, apply: (p: SavedProgram) => SavedProgram): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
    const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
    // normalizeDriftDates on every write, the same discipline canonicalizeWorkouts
    // gets: a mark stored earlier can be invalidated by the one being added now,
    // and the reader is a dumb count by design so it will not catch that itself.
    const updated = programs.map(p => (p.id === programId ? normalizeDriftDates(apply(p)) : p));
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    scheduleCloudPush();
    // The queued reminders were built against the OLD schedule, so without this
    // you get a reminder for a workout you just moved, and none on the day it
    // moved to.
    resyncScheduledNotifications();
  } catch (e) {
    warn("applyRestDay", e);
  }
}

/** What the user settled on. `null` means they backed out and NOTHING was
 *  written — callers must not commit any of their own side effects either.
 *  "moved" kept the workout; "extended" is a move that had no rest day to absorb
 *  it, so the program now finishes a day later. */
export type RestDayOutcome = "skip" | "moved" | "extended" | null;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parse(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "Thursday", or "Thursday 1 Oct" once it's far enough away that the weekday
 *  alone would be ambiguous. */
function dayName(ymd: string, from: string): string {
  const d = parse(ymd);
  const f = parse(from);
  if (!d) return "that day";
  const weekday = WEEKDAYS[d.getDay()];
  const days = f ? Math.round((d.getTime() - f.getTime()) / 86400000) : 0;
  return days > 6 ? `${weekday} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}` : weekday;
}

/** "Tomorrow" for today, otherwise the next day's name ("Saturday"). The prompt
 *  can be opened for any upcoming day from the week strip, and "Move to
 *  tomorrow" on a Friday tapped from Tuesday would name the wrong day. */
function nextDayPhrase(ymd: string): string {
  if (ymd === todayYMD()) return "Tomorrow";
  const d = parse(ymd);
  if (!d) return "the next day";
  d.setDate(d.getDate() + 1);
  return WEEKDAYS[d.getDay()];
}

/**
 * Stop `ymd` from being a training day on `programId`, returning what was
 * actually applied.
 *
 * With mode "ask", prompts only when there's a workout scheduled. A date that
 * already schedules nothing is marked off silently — there's no choice to make.
 *
 * The return value matters: cancelling must leave the day completely untouched,
 * and the caller usually has its own state and a stored override to roll back
 * with it. So callers should do nothing until this resolves non-null, rather
 * than applying optimistically and undoing on cancel.
 *
 * Re-reads programs at commit time rather than trusting a snapshot the caller
 * is holding, since the Workout tab and Home both write this key — and re-plans
 * against that fresh copy too, so the move committed is the one for the program
 * as it actually is.
 */
export async function applyRestDay(
  programId: string,
  ymd: string,
  mode: RestDayMode = "ask",
): Promise<RestDayOutcome> {
  if (mode === "skip") { await commit(programId, p => skipDate(p, ymd)); return "skip"; }
  if (mode === "moveToTomorrow") {
    let kind: "moved" | "extended" = "moved";
    await commit(programId, p => {
      const plan = planDoItTomorrow(p, ymd);
      kind = plan.kind === "absorbed" ? "moved" : "extended";
      return plan.program;
    });
    return kind;
  }

  const raw = await AsyncStorage.getItem(PROGRAMS_KEY).catch(() => null);
  const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
  const program = programs.find(p => p.id === programId);
  if (!program) return null;

  const scheduled = getWorkoutForDate(program, ymd);
  // Nothing scheduled: just mark it off without an interruption.
  if (!scheduled) { await commit(programId, p => skipDate(p, ymd)); return "skip"; }

  const name = scheduled.name;
  const next = nextDayPhrase(ymd);
  const plan = planDoItTomorrow(program, ymd);

  // One short line per button, naming it exactly as the button does, and saying
  // only the one thing that differs: what happens to the rest of the week. A
  // native alert grows with its message, so every word here makes it taller.
  const moveLabel = `Move to ${next}`;
  let moveCopy: string;
  if (plan.kind === "extended") {
    moveCopy = `${moveLabel}: your program ends a day later.`;
  } else if (plan.lostRestDay && plan.lostRestBecomes) {
    moveCopy = `${moveLabel}: ${dayName(plan.lostRestDay, ymd)}'s rest becomes ${plan.lostRestBecomes}.`;
  } else {
    moveCopy = `${moveLabel}: the rest of your week shifts a day.`;
  }

  return new Promise<RestDayOutcome>(resolve => {
    Alert.alert(
      `Not doing '${name}'?`,
      `Make Rest Day: nothing else changes.\n${moveCopy}`,
      [
        {
          text: "Make Rest Day",
          onPress: () => { void commit(programId, p => skipDate(p, ymd)).then(() => resolve("skip")); },
        },
        {
          text: moveLabel,
          onPress: () => {
            void applyRestDay(programId, ymd, "moveToTomorrow").then(resolve);
          },
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Put `ymd` back to its planned workout. Undoes a skip or a move — and for a
 * move, the rest day it was absorbed into comes back too (see
 * `unskipDate`), so undoing leaves the week exactly as it was planned.
 */
export async function clearRestDay(programId: string, ymd: string): Promise<void> {
  return commit(programId, p => unskipDate(p, ymd));
}

/** Convenience for screens that need to render the current state. */
export { isDateSkipped, isDatePushed, isDatePulled };
