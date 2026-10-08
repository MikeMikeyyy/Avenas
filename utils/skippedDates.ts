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
// free rest day, so the net drift returns to zero there. Undoing the push gives
// its rest day back too — see `unskipDate`. Only when no rest day can absorb it
// (the cycle has none, or a hold starts first) is it a bare push, and then (and
// only then) the program finishes a day later. Moves can overlap (move today,
// then tomorrow; or move the day an earlier move was absorbed into): each still
// gets its own rest day, and undoing any one puts the week back as it was.
// A move is never offered onto a day already made a rest day (utils/restDay.ts):
// that day blanks whatever lands on it, so the moved workout would vanish.
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

import { programFinishDate, type SavedProgram } from "../constants/programs";
import { toYMD } from "./dates";
import { cycleIndexForDate, getWorkoutForDate, normalizeDriftDates, type DayOverride } from "./workout";
import { heldOn } from "./programHolds";

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
 * Undoing a MOVE also gives back the rest day it was absorbed into. The two
 * were created as one action, so they come off as one: take just the push away
 * and the orphaned pull would drag the rest of the program a day EARLIER, which
 * is a worse state than either the move or no move.
 *
 * Which pull was its isn't stored, and "the first pull after it" (what this
 * used to take) is wrong whenever moves overlap: move Thursday, then Friday,
 * and the first pull after Friday is THURSDAY's (often re-targeted by the
 * second move), so undoing Friday took Thursday's catch-up and left the week
 * shifted, sometimes a day late. So the rest days from `ymd` on are worked out
 * again for the moves still standing, exactly as those moves found them: each,
 * oldest first, takes the next free rest day after it (reabsorbFrom). That's
 * the state the week was in before the undone move, rest days and all, because
 * it's the state the moves are always left in: anything that re-dates the
 * timeline under them pairs them up the same way again (repairMoves,
 * marksAfterHold, marksAfterEdit). Before those did, a re-dating could leave a
 * rest day later than this places it, and putting a move straight back pulled
 * that rest day forward, changing the days in between. Pulls before `ymd`
 * stay: those days are settled, and a move is only ever undone on a day that
 * hasn't gone by (Home and the Journal lock past ones).
 *
 * Pulls are never removed by date. They're owned by the moves, and "Set
 * Workout Date" is the only other thing that clears them.
 *
 * Returns the SAME object when there was nothing to undo, so callers can use
 * identity to skip a write.
 */
export function unskipDate(program: SavedProgram, ymd: string): SavedProgram {
  const wasPushed = isDatePushed(program, ymd);
  if (!isDateSkipped(program, ymd) && !wasPushed) return program;

  const skipped = (program.skippedDates ?? []).filter(d => d !== ymd);
  const pushed = (program.pushedDates ?? []).filter(d => d !== ymd);
  const restored: SavedProgram = {
    ...program,
    skippedDates: skipped.length > 0 ? skipped : undefined,
    pushedDates: pushed.length > 0 ? pushed : undefined,
  };
  return wasPushed ? reabsorbFrom(restored, ymd) : restored;
}

/**
 * The rest days that absorb the moves still owed at `fromYMD`, found again as
 * the moves found them: each, oldest first, takes the next free rest day after
 * it (nextRestDate, against the week with the ones before it already taken).
 * Pulls before `fromYMD` stay where they are and pay off the oldest moves; the
 * moves left over, and every move from `fromYMD` on, are owed one.
 *
 * A rest day that already holds a pull and has since been marked off keeps it
 * (normalizeDriftDates' rule: skipping the day a move was absorbed into mustn't
 * un-absorb it), so it's still a candidate here.
 *
 * And as planDoItTomorrow decides it, a rest day after the program's last day
 * absorbs nothing: that move ends the program a day later instead. Without
 * this, a re-sweep near the end put a rest day past the finish, which then
 * moved the finish back and forth.
 */
function reabsorbFrom(program: SavedProgram, fromYMD: string): SavedProgram {
  const pushes = [...(program.pushedDates ?? [])].sort();
  const kept = (program.pulledDates ?? []).filter(d => d < fromYMD).sort();
  const settledBefore = new Set((program.pulledDates ?? []).filter(d => d >= fromYMD && isDateSkipped(program, d)));
  const before = pushes.filter(d => d < fromYMD);
  const owed = [...before.slice(Math.min(before.length, kept.length)), ...pushes.filter(d => d >= fromYMD)];

  let current: SavedProgram = { ...program, pulledDates: kept.length > 0 ? kept : undefined };
  owed.forEach((push, i) => {
    const after = addDays(push, 1);
    if (!after) return;
    // The last day as the program stood before this move, with the moves owed
    // after it not yet made: they're replayed oldest first.
    const toCome = new Set(owed.slice(i));
    const end = programFinishDate({ ...current, pushedDates: (current.pushedDates ?? []).filter(d => !toCome.has(d)) });
    const rest = freeRestDate(current, after < fromYMD ? fromYMD : after, settledBefore);
    if (rest && (!end || rest <= toYMD(end))) current = pullDate(current, rest);
  });
  return current;
}

/**
 * `program`'s moves paired again with rest days, on a timeline that has just
 * been re-dated under them (a session logged before the start moved it back).
 * Every day now sits on a different slot, so the rest day each move was
 * absorbed into can be a workout now (normalizeDriftDates would re-target it)
 * or, still a rest day, no longer the first one after the move. Left there, the
 * week read fine, but putting a later move straight back paired that move up
 * afresh and the days between the two rest days changed. Each move takes the
 * next free rest day after it, oldest first, as on a fresh run of the moves.
 */
export function repairMoves(program: SavedProgram): SavedProgram {
  const first = [...(program.pushedDates ?? [])].sort()[0];
  return first ? normalizeDriftDates(reabsorbFrom(program, first)) : normalizeDriftDates(program);
}

/**
 * A program as the builder saves an edit of it (app/new-program.tsx), given
 * how it was before.
 *
 * Every save of a program runs normalizeDriftDates (CLAUDE.md), and the
 * builder's didn't: change which days rest and a rest day a move was absorbed
 * into could become a workout, which the pull there then took out of the plan.
 * When the rest days or the program's length changed, the timeline under the
 * moves changed too, so they're paired with rest days again (repairMoves), as
 * after a back-dated start. An edit that changes neither (exercises, names, a
 * day moved between training slots) leaves them be.
 */
export function marksAfterEdit(before: SavedProgram, edited: SavedProgram): SavedProgram {
  const rests = (p: SavedProgram) => p.cyclePattern.map(n => !n || n === "Rest").join();
  const redated = before.cycleDays !== edited.cycleDays || before.totalWeeks !== edited.totalWeeks || rests(before) !== rests(edited);
  return redated ? repairMoves(edited) : normalizeDriftDates(edited);
}

/**
 * `program`'s marks once a hold from `pausedAt` ends on `resumeYMD`. The caller
 * (utils/programPause.ts resumeProgram) has already cleared the hold and
 * shifted startDate (and, picking up today, the offset) onto the new timeline.
 *
 * Days marked off inside the hold are meaningless (nothing was scheduled on
 * them), and so is a move dated there: the hold already did the waiting it
 * asked for, so the workout it moved is the one the program picks up with.
 * Kept, it extended the program for a day it never programmed.
 *
 * A move and the rest day that absorbs it can sit either side of the pause,
 * though, and they only mean anything as a pair. Dropped one at a time, a move
 * made before the pause whose rest day fell in the hold ran the program a day
 * late, and a rest day after the hold whose move was in it ran it a day early:
 * resuming landed a day off where it left off, even a week back. So the rest
 * days from the pause on are worked out again (reabsorbFrom). A pull ON the
 * pause day still counts, as the program had already caught up there when it
 * stopped. Every move still standing takes the next free rest day after the
 * resume day, where the rest day it was waiting for comes round again. So the
 * resume day is on the cycle and week the pause day was, and the program still
 * finishes on time.
 */
export function marksAfterHold(program: SavedProgram, pausedAt: string, resumeYMD: string): SavedProgram {
  // Resumed the day it was paused: nothing was held, so nothing moves.
  if (resumeYMD <= pausedAt) return normalizeDriftDates(program);
  const inHold = (d: string) => d >= pausedAt && d < resumeYMD;
  const keep = (list: string[] | undefined, drop: (d: string) => boolean) => {
    const kept = (list ?? []).filter(d => !drop(d));
    return kept.length > 0 ? kept : undefined;
  };
  const dayAfter = addDays(resumeYMD, 1);
  const settled: SavedProgram = {
    ...program,
    skippedDates: keep(program.skippedDates, inHold),
    pushedDates: keep(program.pushedDates, inHold),
    pulledDates: keep(program.pulledDates, d => d > pausedAt),
  };
  return normalizeDriftDates(dayAfter ? reabsorbFrom(settled, dayAfter) : settled);
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

/** The next date from `fromYMD` (inclusive) that the schedule rests on and
 *  that isn't already marked. Null when there is none: no rest in the cycle,
 *  or a hold starts first. */
export function nextRestDate(program: SavedProgram, fromYMD: string): string | null {
  return freeRestDate(program, fromYMD, new Set());
}

/**
 * nextRestDate, with `allowed`: marked-off days that may still be taken because
 * they already hold a pull (see reabsorbFrom).
 *
 * A cycle with a rest day has one in every cycle, but other moves' pulls can
 * be holding the nearest ones, so the search looks a cycle further for each.
 * Limited to one cycle, a move with its rest day taken by another's came out
 * "extended" (the program a day late) with a free rest day just beyond.
 *
 * Counted in days the cycle moves on, not calendar days: a moved day and a day
 * in a hold the program came back from hold the cycle still, so passing them
 * uses none of the search. Counted as calendar days, two moves and a hold
 * between a move and its rest day used up a 3-day cycle's search, and the move
 * was left with no rest day at all.
 */
function freeRestDate(program: SavedProgram, fromYMD: string, allowed: ReadonlySet<string>): string | null {
  let left = program.cycleDays * (1 + (program.pulledDates?.length ?? 0)) + 1;
  for (let ymd: string | null = fromYMD; left > 0; ymd = addDays(ymd, 1)) {
    if (!ymd) return null;
    if (program.pausedAt && ymd >= program.pausedAt) return null;
    // A hold it came back from scheduled nothing: no rest there to spend
    // (normalizeDriftDates won't leave a pull on one either).
    if (heldOn(program, ymd) || isDatePushed(program, ymd)) continue;
    left--;
    if (isDatePulled(program, ymd)) continue;
    if (isDateSkipped(program, ymd) && !allowed.has(ymd)) continue;
    // The cycle's own slot: a day marked off still rests or trains underneath.
    const idx = cycleIndexForDate(program, ymd);
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
  // A rest day after the program's last day absorbs nothing: the last workout
  // still lands a day later, so near the end a move ENDS the program a day
  // later, and the prompt says so rather than promising the rest of the week.
  const end = programFinishDate(program);
  const found = from ? nextRestDate(pushed, from) : null;
  const pull = found && (!end || found <= toYMD(end)) ? found : null;
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
 * The day a move on `ymd` puts that day's workout on: the next day, or, when
 * the next day's own workout has moved on as well, the first day after it
 * that hasn't (both shift, and the move lands past it). Null only for an
 * unparseable date.
 */
export function moveLandsOn(program: SkipFields, ymd: string): string | null {
  let day = addDays(ymd, 1);
  while (day !== null && isDatePushed(program, day)) day = addDays(day, 1);
  return day;
}

/**
 * The change-day pick on `ymd` once "Move to Tomorrow" has moved that date: the
 * same pick, dated the day the move lands on (moveLandsOn). Null means there's
 * nothing to carry and the pick should simply go.
 *
 * The move puts `ymd`'s slot on that day. With Push picked on a Legs day,
 * dropping the pick moved LEGS, so the prompt asked "Not doing 'Push'?" and then
 * moved the workout the user had already swapped away. Carried, the day holds
 * that slot with the pick on it, exactly as `ymd` did. Carried to the next day
 * when THAT day's workout had moved on too, the pick sat on a day that shows
 * nothing and the day after showed Legs again.
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
  const lands = moveLandsOn(program, ymd);
  return lands ? { ...override, date: lands } : null;
}

/**
 * The change-day pick to restore when a move on `ymd` is undone: a pick on the
 * day the move landed on comes back to `ymd`, as the slot under it does. Null
 * leaves the stored pick alone.
 *
 * Without this the pick stayed put after an undo and replaced that day's own
 * workout. A pick dated after `ymd` can only have been carried there: the
 * Workout tab writes picks for the day it's on, and a move is only undone on a
 * date that hasn't gone by, so that day hasn't arrived yet. It needn't be this
 * move that carried it: with the next day moved on too, an earlier pick rides
 * both moves to the same day, and undoing either brings the slot, and the pick
 * on it, back to the day that move was on.
 */
export function pickAfterUndoMove(program: SkipFields, override: DayOverride | null, ymd: string): DayOverride | null {
  if (!override || !override.dayId || override.date !== moveLandsOn(program, ymd)) return null;
  return { ...override, date: ymd };
}
