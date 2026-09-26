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
//                       and you're back on your usual days after that. A
//                       workout picked with Change Workout Day moves with it.
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

import { PROGRAMS_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout, type SavedProgram } from "../constants/programs";
import { MONTH_NAMES } from "./dates";
import { getEffectiveToday, getWorkoutForDate, normalizeDriftDates, resolveWorkoutForDate, type DayOverride } from "./workout";
import { isDatePulled, isDatePushed, isDateSkipped, pickAfterMove, pickAfterUndoMove, planDoItTomorrow, skipDate, unskipDate } from "./skippedDates";
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

/**
 * Drop a change-day override that names `ymd`.
 *
 * Marking a day off has to take the override with it, or the two screens
 * disagree: `resolveWorkoutForDate` honours a matching override BEFORE the skip
 * gate, so the Workout tab would keep offering the workout the strip has just
 * crossed out. Only an override for this exact date is touched — one for
 * another day is none of this call's business.
 */
async function clearOverrideFor(ymd: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_DAY_OVERRIDE_KEY);
    if (!raw) return;
    const override = JSON.parse(raw) as DayOverride;
    if (override?.date !== ymd) return;
    await AsyncStorage.removeItem(WORKOUT_DAY_OVERRIDE_KEY);
    // The reminders name the pick, and commit's resync may have read it before
    // it went. Resyncs run one after another, so this one reads the final state.
    resyncScheduledNotifications();
  } catch (e) {
    warn("clearOverride", e);
  }
}

async function readOverride(): Promise<DayOverride | null> {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_DAY_OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as DayOverride) : null;
  } catch (e) {
    warn("readOverride", e);
    return null;
  }
}

async function writeOverride(override: DayOverride): Promise<void> {
  try {
    await AsyncStorage.setItem(WORKOUT_DAY_OVERRIDE_KEY, JSON.stringify(override));
    resyncScheduledNotifications(); // as in clearOverrideFor
  } catch (e) {
    warn("writeOverride", e);
  }
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

/**
 * "Make Rest Day" on `ymd`, from whichever path chose it: the date is marked
 * off and any change-day pick on it goes too.
 *
 * Every path goes through here. The prompt's buttons used to write the skip
 * alone, so a workout picked with Change Workout Day survived it: Home's row
 * kept the pick's name with an X beside it, and the Workout tab kept offering it.
 *
 * A date whose plan holds no workout of its own (Full Body picked on a rest
 * day) gets no skip mark: dropping the pick already makes it the rest day it
 * was planned as, and a mark would put an X on that rest day whose undo brings
 * nothing back.
 */
async function makeRestDay(programId: string, ymd: string): Promise<"skip"> {
  await commit(programId, p => (getWorkoutForDate(p, ymd) ? skipDate(p, ymd) : p));
  await clearOverrideFor(ymd);
  return "skip";
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
 *  tomorrow" on a Friday tapped from Tuesday would name the wrong day.
 *
 *  `today` is the EFFECTIVE day, so at 1am — when the app is still on
 *  yesterday — the button says Tomorrow for the day the user is actually on. */
function nextDayPhrase(ymd: string, today: string): string {
  if (ymd === today) return "Tomorrow";
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
  if (mode === "skip") return makeRestDay(programId, ymd);
  if (mode === "moveToTomorrow") {
    // A change-day pick moves with its day (see pickAfterMove); anything else on
    // this date goes, as it does for a rest day.
    const override = await readOverride();
    let kind: "moved" | "extended" = "moved";
    let carried = null as DayOverride | null;
    await commit(programId, p => {
      carried = pickAfterMove(p, override, ymd);
      const plan = planDoItTomorrow(p, ymd);
      kind = plan.kind === "absorbed" ? "moved" : "extended";
      return plan.program;
    });
    if (carried) await writeOverride(carried);
    else await clearOverrideFor(ymd);
    return kind;
  }

  const raw = await AsyncStorage.getItem(PROGRAMS_KEY).catch(() => null);
  const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
  const program = programs.find(p => p.id === programId);
  if (!program) return null;

  // What the USER sees on that date, not what the cycle plans for it. Home's
  // strip shows the effective day through resolveWorkoutForDate, so a day
  // swapped in with Change Workout Day reads as that workout — and asking the
  // raw cycle here answered "Rest", which sent today straight down the silent
  // "nothing scheduled" path below: no prompt, an instant X, and the Workout tab
  // still offering the workout. Every other day worked, because only the
  // effective day can carry an override.
  const override = await readOverride();
  const scheduled = resolveWorkoutForDate(program, override, ymd, programs);
  // Nothing scheduled: nothing to ask about.
  if (!scheduled) return makeRestDay(programId, ymd);

  const name = scheduled.name;

  // A day already gone by: you were ill or couldn't make it, and all that's left
  // to say is so. Moving it isn't offered, because "the next day" is in the past
  // too and a move there would re-label days you've already lived through. A
  // plain skip is safe after the fact: it empties this one date and never
  // shifts the cycle, so nothing else on the strip or in history moves.
  //
  // Measured against the EFFECTIVE day, the same "today" Home's strip highlights
  // and the Workout tab is on. Against the calendar day, a 1am tap on the row
  // the app still calls today would have been treated as history.
  const historyRaw = await AsyncStorage.getItem(WORKOUT_HISTORY_KEY).catch(() => null);
  const history: CompletedWorkout[] = historyRaw ? JSON.parse(historyRaw) : [];
  const today = getEffectiveToday(program, Array.isArray(history) ? history : []);

  // A workout picked with Change Workout Day on a day the plan rests can't move
  // either: the pick belongs to this date alone, so "Move to Tomorrow" would
  // clear it and push a rest day, and nothing would reach tomorrow.
  const pickedOnRestDay = getWorkoutForDate(program, ymd) === null;

  if (ymd < today || pickedOnRestDay) {
    return new Promise<RestDayOutcome>(resolve => {
      Alert.alert(
        ymd < today ? `Missed '${name}'?` : `Not doing '${name}'?`,
        "Make Rest Day: nothing else changes.",
        [
          {
            text: "Make Rest Day",
            onPress: () => { void makeRestDay(programId, ymd).then(resolve); },
          },
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
  }

  const next = nextDayPhrase(ymd, today);
  const plan = planDoItTomorrow(program, ymd);

  // One short line per button, naming it exactly as the button does, and saying
  // only the one thing that differs: what happens to the rest of the week. A
  // native alert grows with its message, so every word here makes it taller.
  const moveLabel = `Move to ${next}`;
  let moveCopy: string;
  if (plan.kind === "extended") {
    moveCopy = `${moveLabel}: your program ends a day later.`;
  } else {
    // The plan reads the cycle alone, so when the rest day lost is the very
    // next one it names the slot's own workout. A pick moves there with the
    // slot (pickAfterMove), so that day really becomes the workout picked.
    const carriedTo = pickAfterMove(program, override, ymd)?.date;
    const becomes = plan.lostRestDay !== null && plan.lostRestDay === carriedTo ? name : plan.lostRestBecomes;
    moveCopy = plan.lostRestDay && becomes
      ? `${moveLabel}: ${dayName(plan.lostRestDay, ymd)}'s rest becomes ${becomes}.`
      : `${moveLabel}: the rest of your week shifts a day.`;
  }

  return new Promise<RestDayOutcome>(resolve => {
    Alert.alert(
      `Not doing '${name}'?`,
      `Make Rest Day: nothing else changes.\n${moveCopy}`,
      [
        {
          text: "Make Rest Day",
          onPress: () => { void makeRestDay(programId, ymd).then(resolve); },
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
export async function clearRestDay(
  programId: string,
  ymd: string,
  /** False when the caller is putting a NEW pick on `ymd`: the one a move
   *  carried to the next day must not come back over it. */
  restorePick = true,
): Promise<void> {
  let wasMoved = false as boolean;
  await commit(programId, p => {
    wasMoved = isDatePushed(p, ymd);
    return unskipDate(p, ymd);
  });
  // A pick the move carried to the next day comes back with its day.
  if (!wasMoved || !restorePick) return;
  const restored = pickAfterUndoMove(await readOverride(), ymd);
  if (restored) await writeOverride(restored);
}

/** Convenience for screens that need to render the current state. */
export { isDateSkipped, isDatePushed, isDatePulled };
