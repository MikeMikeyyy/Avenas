// utils/skippedDates.ts
//
// Days the user doesn't train on a planned workout, and what happens next.
//
// ── What the user sees: two choices ──────────────────────────────────────────
//
//   MAKE REST DAY    — you miss this workout. The rest of your week is
//                      untouched, and the program finishes when it always would.
//
//   MOVE TO TOMORROW — the workout moves to the next day and the ones after it
//                      follow, until your next rest day absorbs the shift. From
//                      there you're back on your usual days, and the program
//                      still finishes on time. The cost is that one rest day.
//
// That's the whole user-facing model, and it replaced a version with three
// choices (skip / shift everything permanently / shift and spend a named rest
// day) plus tapping a rest day to spend it. All of those were mechanically
// correct, and nobody could tell them apart — the rest day the button NAMED
// wasn't even the one that visibly changed. Two choices that both keep your
// usual training days is what people actually want when they miss a session.
//
// ── How it's stored ──────────────────────────────────────────────────────────
//
//   skippedDates — the date schedules nothing.
//   pushedDates  — subset of skipped: the cycle also waits a day here (+1 drift).
//   pulledDates  — a rest day spent to catch back up (−1 drift).
//
// "Move to Tomorrow" is a PUSH on the missed date paired with a PULL on the next
// rest day, so the net drift returns to zero there. Undoing the push removes its
// pull too — see `unskipDate`. Only when the cycle has no rest day to spend is
// it a bare push, and then (and only then) the program finishes a day later.
//
// Anchoring to DATES rather than nudging `cycleOffset` is load-bearing: an
// offset is a phase shift over the whole timeline, so pushing Tuesday also
// re-labelled Monday and a completed workout vanished from the week. Dates keep
// the past fixed and make undo exact. The net shift at any date is `cycleDrift`
// (utils/cycleDrift.ts), which explains why a push counts strictly-before and a
// pull counts inclusive.
//
// For an absence longer than a day or two, pausing is still the right tool — it
// shifts `startDate` wholesale (utils/programPause.ts). And "Set Workout Date"
// is a clean reset that drops every move (`clearShifts`).
//
// RN-free and pure so it can be unit-tested under plain node/tsx
// (see scripts/verify-skipped-dates.ts).

import type { SavedProgram } from "../constants/programs";
import { getWorkoutForDate, normalizeDriftDates, resolveDayIndex, type DayOverride } from "./workout";

type SkipFields = Pick<SavedProgram, "skippedDates" | "pushedDates" | "pulledDates">;

/** Is `ymd` marked as not-training (either kind)? */
export function isDateSkipped(program: SkipFields, ymd: string): boolean {
  return !!program.skippedDates?.includes(ymd);
}

/** Is `ymd` a workout that was moved to the next day, rather than dropped? */
export function isDatePushed(program: SkipFields, ymd: string): boolean {
  return !!program.pushedDates?.includes(ymd);
}

/** Is `ymd` the rest day a move was absorbed into? Bookkeeping, not something
 *  the user manages directly — it belongs to the push before it. */
export function isDatePulled(program: SkipFields, ymd: string): boolean {
  return !!program.pulledDates?.includes(ymd);
}

const withSorted = (list: string[]): string[] => [...list].sort();

/** `program` with `ymd` marked as not-training, leaving the cycle alone. */
export function skipDate(program: SavedProgram, ymd: string): SavedProgram {
  if (isDateSkipped(program, ymd)) return program;
  return { ...program, skippedDates: withSorted([...(program.skippedDates ?? []), ymd]) };
}

/**
 * `program` with `ymd` marked as not-training AND the cycle delayed a day from
 * there, so that date's workout moves to the next day and the rest follow.
 * A pushed date is always also skipped.
 *
 * On its own this makes the program a day longer. The user-facing action pairs
 * it with a pull — see `planDoItTomorrow`.
 */
export function pushDate(program: SavedProgram, ymd: string): SavedProgram {
  const skipped = skipDate(program, ymd);
  if (isDatePushed(skipped, ymd)) return skipped;
  return { ...skipped, pushedDates: withSorted([...(skipped.pushedDates ?? []), ymd]) };
}

/**
 * `program` with the rest day on `ymd` SPENT, so everything from that date
 * onward moves a day earlier. The other half of "do it tomorrow".
 *
 * Only meaningful on a date the cycle rests on; `normalizeDriftDates`
 * (utils/workout.ts) re-targets it on every write if a later edit slides a
 * workout onto it.
 */
export function pullDate(program: SavedProgram, ymd: string): SavedProgram {
  if (isDatePulled(program, ymd)) return program;
  return { ...program, pulledDates: withSorted([...(program.pulledDates ?? []), ymd]) };
}

/**
 * `program` with `ymd` restored to its planned workout.
 *
 * Undoing a MOVE also removes the pull it was absorbed into — the first pull
 * after it. The two were created as one action, so they come off as one: take
 * just the push away and the orphaned pull would drag the rest of the program a
 * day EARLIER, which is a worse state than either the move or no move.
 *
 * Pulls are therefore never removed by date. They're owned by the push before
 * them, and "Set Workout Date" is the only other thing that clears them.
 *
 * Returns the SAME object when there was nothing to undo, so callers can use
 * identity to skip a write.
 */
export function unskipDate(program: SavedProgram, ymd: string): SavedProgram {
  const wasPushed = isDatePushed(program, ymd);
  if (!isDateSkipped(program, ymd) && !wasPushed) return program;

  const skipped = (program.skippedDates ?? []).filter(d => d !== ymd);
  const pushed = (program.pushedDates ?? []).filter(d => d !== ymd);
  let pulled = program.pulledDates ?? [];
  if (wasPushed) {
    // Both lists are "YYYY-MM-DD", so a string compare is a date compare.
    const partner = [...pulled].sort().find(d => d > ymd);
    if (partner !== undefined) pulled = pulled.filter(d => d !== partner);
  }
  return {
    ...program,
    skippedDates: skipped.length > 0 ? skipped : undefined,
    pushedDates: pushed.length > 0 ? pushed : undefined,
    pulledDates: pulled.length > 0 ? pulled : undefined,
  };
}

/** Toggle `ymd` between scheduled and not-training (as a plain skip). */
export function toggleSkippedDate(program: SavedProgram, ymd: string): SavedProgram {
  return isDateSkipped(program, ymd) ? unskipDate(program, ymd) : skipDate(program, ymd);
}

/**
 * `program` with every MOVE dropped, for "Set Workout Date".
 *
 * Setting "today is Push" is the user saying "this is where I am" — so the
 * moves that got them here have to go, or they keep counting. Left in place, the
 * schedule looked perfectly back on plan while the finish date stayed however
 * many days late, with nothing on screen to explain the difference.
 *
 * What survives: a move dated BEFORE today becomes a plain skip, because you
 * genuinely didn't train that day and the calendar should still say rest rather
 * than "missed". A move dated today or later is removed outright — a reset must
 * not leave a future planned day empty. Plain skips are untouched: they never
 * shifted anything.
 */
export function clearShifts(program: SavedProgram, todayYMD: string): SavedProgram {
  const futureMoves = new Set((program.pushedDates ?? []).filter(d => d >= todayYMD));
  const skipped = (program.skippedDates ?? []).filter(d => !futureMoves.has(d));
  return {
    ...program,
    skippedDates: skipped.length > 0 ? skipped : undefined,
    pushedDates: undefined,
    pulledDates: undefined,
  };
}

/** `ymd` plus `days`, as "YYYY-MM-DD", or null when unparseable. */
function addDays(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** The next date from `fromYMD` (inclusive), within one cycle, that the
 *  schedule rests on and that isn't already marked. Null when there is none. */
export function nextRestDate(program: SavedProgram, fromYMD: string): string | null {
  for (let i = 0; i <= program.cycleDays; i++) {
    const ymd = addDays(fromYMD, i);
    if (!ymd) return null;
    if (program.pausedAt && ymd >= program.pausedAt) return null;
    if (isDateSkipped(program, ymd) || isDatePulled(program, ymd)) continue;
    const idx = resolveDayIndex(program, ymd);
    if (idx === null) continue;
    const name = program.cyclePattern[idx];
    if (!name || name === "Rest") return ymd;
  }
  return null;
}

/** What "Move to Tomorrow" would do to a program, worked out before committing so
 *  the prompt can describe it in terms of days the user will actually see. */
export type MovePlan =
  | {
      kind: "absorbed";
      program: SavedProgram;
      /** The PLANNED rest day that now holds a workout — the one visibly lost.
       *  Not the internal pull date, which is often a rest day that stays a rest
       *  day; naming that was what made the old prompt unreadable. Null only if
       *  the shift doesn't visibly consume a rest (unusual, but possible). */
      lostRestDay: string | null;
      /** The workout that lands on `lostRestDay`. */
      lostRestBecomes: string | null;
      /** First planned training day that's back on its usual workout. */
      backOnPlan: string | null;
    }
  | {
      /** No rest day within a cycle to absorb it: a bare push, so the program
       *  genuinely finishes a day later. */
      kind: "extended";
      program: SavedProgram;
    };

/**
 * Plan "Move to Tomorrow" for the workout on `ymd`: push it, then spend the next
 * rest day so the shift ends there.
 *
 * The rest day to spend is found against the schedule AS IT WILL BE once the
 * push lands, so it's a genuine rest day and not one the push is about to move
 * a workout onto.
 */
export function planDoItTomorrow(program: SavedProgram, ymd: string): MovePlan {
  const pushed = pushDate(program, ymd);
  const from = addDays(ymd, 1);
  const pull = from ? nextRestDate(pushed, from) : null;
  if (!pull) return { kind: "extended", program: normalizeDriftDates(pushed) };

  const moved = normalizeDriftDates(pullDate(pushed, pull));

  // Walk forward from the day after the move to the pull, comparing what the
  // user PLANNED against what they'll now see.
  let lostRestDay: string | null = null;
  let lostRestBecomes: string | null = null;
  for (let d = from; d !== null && d <= pull; d = addDays(d, 1)) {
    const planned = getWorkoutForDate(program, d);
    const now = getWorkoutForDate(moved, d);
    if (planned === null && now !== null && !isDateSkipped(program, d)) {
      lostRestDay = d;
      lostRestBecomes = now.name;
      break;
    }
  }

  // Drift is back to zero from the pull onward, so the first planned workout
  // from there matches the plan again.
  let backOnPlan: string | null = null;
  for (let i = 0, d: string | null = pull; i <= program.cycleDays && d !== null; i++, d = addDays(d, 1)) {
    if (getWorkoutForDate(program, d) !== null) { backOnPlan = d; break; }
  }

  return { kind: "absorbed", program: moved, lostRestDay, lostRestBecomes, backOnPlan };
}

/**
 * The change-day pick on `ymd` once "Move to Tomorrow" has moved that date: the
 * same pick, dated the next day. Null means there's nothing to carry and the
 * pick should simply go.
 *
 * The move puts `ymd`'s slot on the next day. With Push picked on a Legs day,
 * dropping the pick moved LEGS, so the prompt asked "Not doing 'Push'?" and then
 * moved the workout the user had already swapped away. Carried, the next day
 * holds that slot with the pick on it, exactly as `ymd` did.
 *
 * Only a pick made with Change Workout Day moves (it has a `dayId`). A custom
 * workout's name would open tomorrow as an empty custom day. A pick on a day
 * the plan rests can't move either: the rest slot lands on the next day, the
 * rest day after it absorbs the move, and a pick there would replace the next
 * day's own workout (the prompt doesn't offer the move for that case).
 */
export function pickAfterMove(program: SavedProgram, override: DayOverride | null, ymd: string): DayOverride | null {
  if (!override || override.date !== ymd || !override.dayId || override.workoutName === "Rest") return null;
  if (getWorkoutForDate(program, ymd) === null) return null;
  const next = addDays(ymd, 1);
  return next ? { ...override, date: next } : null;
}

/**
 * The change-day pick to restore when a move on `ymd` is undone: a pick the
 * move carried to the next day comes back to `ymd`. Null leaves the stored pick
 * alone.
 *
 * Without this the pick stayed on the next day after an undo and replaced that
 * day's own workout. A pick dated the day after `ymd` can only have been carried
 * there: the Workout tab writes picks for the day it's on, and a move is only
 * undone on a date that hasn't gone by, so the next day hasn't arrived yet.
 */
export function pickAfterUndoMove(override: DayOverride | null, ymd: string): DayOverride | null {
  if (!override || !override.dayId || override.date !== addDays(ymd, 1)) return null;
  return { ...override, date: ymd };
}
