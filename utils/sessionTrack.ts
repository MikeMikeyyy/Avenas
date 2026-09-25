// utils/sessionTrack.ts
//
// "3rd session" on a workout card, and which of that day's sessions were MISSED.
//
// The number is the SCHEDULED OCCURRENCE of that workout day, not a count of what
// was completed. Counting completions made a missed week vanish: miss two of four
// sessions one week, train the next, and those two days came back as the "2nd
// session" while the days you never missed were on their "3rd". The number stopped
// answering "where am I in this program" and the four days quietly fell out of
// step with each other.
//
// Counting occurrences instead means a missed week still costs you a number: the
// day you skipped in week 2 is on its 3rd session in week 3, same as every other
// day. An occurrence nobody trained is reported in `missed`, which is what draws
// the grey dot on the track, UNLESS something else was trained on its date (a
// custom workout, or another day picked with Change Workout Day). That one is
// `replaced` and draws orange: "you trained that day, just not this" and "you
// didn't train" are different things, and grey said the second for both. The
// session that did the replacing says so on its own card ("Instead of Push",
// `insteadOfById`), read off the same track so the two ends always agree.
//
// Pure and RN-free (verified by scripts/verify-session-track.ts).

import { addDaysYMD, parseStoredDate, toYMD } from "./dates";
import { cycleIndexForDate } from "./workout";
import { isDatePushed } from "./skippedDates";
import { workoutBelongsToProgram } from "./progressStats";
import { dayIdAt, indexOfDayId, normalizeDayName } from "./programDays";
import { programFinishDate, type CompletedWorkout, type SavedProgram } from "../constants/programs";

/** A program can't run forever; this bounds the walk if a finish date can't be
 *  derived (an unparseable startDate is already caught before we get here). */
const MAX_WALK_DAYS = 800;

/**
 * Every date this slot was SCHEDULED on, oldest first, up to `throughYMD`.
 *
 * Three subtleties, each a real bug if missed:
 *
 *   A PUSHED date ("Move to Tomorrow") is skipped. A push blanks its own date AND
 *   delays everything after it by a day, so `cycleIndexForDate` reports the slot
 *   on the pushed date and again the day it moved to. Counted at both, one
 *   session would show as two occurrences, the first of them missed.
 *
 *   A PLAIN skipped date ("Make Rest Day") is KEPT. That is exactly the day the
 *   user meant to train and didn't — the occurrence this whole file exists to
 *   count.
 *
 *   A HOLD schedules nothing. `cycleIndexForDate` deliberately ignores `pausedAt`
 *   (it is also the dayId backfill's tool), so walking across a hold would invent
 *   occurrences that never came round.
 */
export function occurrencesOfDay(program: SavedProgram, dayId: string, throughYMD: string): string[] {
  // The slot is resolved ONCE, and every date is compared against that index.
  // Checking the day's name per date instead would also have to agree with
  // whichever "is this a Rest" spelling the rest of the app uses; and a slot the
  // user has since edited into a Rest day would come back with zero occurrences
  // rather than saying plainly "there is nothing here to count".
  const slot = indexOfDayId(program, dayId);
  if (slot < 0) return [];
  const label = program.cyclePattern[slot];
  if (!label || normalizeDayName(label) === "rest") return [];

  const startYMD = startOf(program);
  if (!startYMD) return [];

  const finish = programFinishDate(program);
  const lastYMD = finish ? minYMD(throughYMD, toYMD(finish)) : throughYMD;
  if (lastYMD < startYMD) return [];

  const out: string[] = [];
  let ymd = startYMD;
  for (let i = 0; i < MAX_WALK_DAYS && ymd <= lastYMD; i++, ymd = addDaysYMD(ymd, 1)) {
    if (program.pausedAt && ymd >= program.pausedAt) break;
    if (isDatePushed(program, ymd)) continue;
    if (cycleIndexForDate(program, ymd) !== slot) continue;
    out.push(ymd);
  }
  return out;
}

export type SessionTrackInfo = {
  /** Workout id → which occurrence of its day it was (1-based). A session that
   *  falls outside every occurrence window is absent, and the caller keeps its
   *  old number. */
  numberById: Record<string, number>;
  /** Occurrence numbers already past with nothing logged against them, and
   *  nothing else trained on their date either. */
  missed: number[];
  /** Occurrences this day never got, but whose date had ANOTHER session logged:
   *  the day was trained, with something else in its place. Never also in
   *  `missed`. */
  replaced: number[];
  /** The scheduled dates of `replaced`, in the same order. */
  replacedDates: string[];
  /** How many occurrences have come round up to and including today. */
  occurrences: number;
};

/**
 * Match this day's sessions to its scheduled occurrences.
 *
 * Each occurrence owns the window from its own date up to (not including) the
 * next one, so a session logged a day or two late still fills the occurrence it
 * belongs to rather than stealing the next one — which is what happens every time
 * a workout slides by a day. Sessions are taken oldest first, one per occurrence;
 * a second session in the same window keeps the same number (two sessions of one
 * day in one cycle is a genuine duplicate, not a new occurrence).
 *
 * `history` must already be narrowed to this slot — the caller knows whether that
 * is by dayId or, for legacy records, by name (workoutMatchesDay).
 *
 * `trainedDates` is every date with ANY session logged, this slot's or not. An
 * unfilled occurrence whose own date is in it was replaced rather than missed.
 * Only the scheduled date itself counts: a custom workout two days later, in the
 * same window, didn't stand in for this day. Omitted, nothing reads as replaced.
 *
 * Today's occurrence can be replaced but never missed. Nothing logged yet is
 * just "not yet"; something else logged IS the day's session, since the Workout
 * tab treats the day as done once anything is logged on it. Should this day be
 * logged after all, the occurrence fills and the orange goes on the next read.
 */
export function buildSessionTrack({ program, dayId, history, todayYMD, trainedDates }: {
  program: SavedProgram;
  dayId: string;
  history: CompletedWorkout[];
  todayYMD: string;
  trainedDates?: ReadonlySet<string>;
}): SessionTrackInfo {
  const occurrences = occurrencesOfDay(program, dayId, todayYMD);
  const numberById: Record<string, number> = {};
  if (occurrences.length === 0) return { numberById, missed: [], replaced: [], replacedDates: [], occurrences: 0 };

  const sessions = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const missed: number[] = [];
  const replaced: number[] = [];
  const replacedDates: string[] = [];
  let next = 0; // index into `sessions`

  occurrences.forEach((occYMD, i) => {
    const endYMD = occurrences[i + 1] ?? null; // exclusive; null = open-ended
    // Anything older than this occurrence belongs to an earlier one that was
    // already filled (or to no occurrence at all) — don't let it fill this.
    while (next < sessions.length && sessions[next].date < occYMD) next++;
    let filled = false;
    while (next < sessions.length && (endYMD === null || sessions[next].date < endYMD)) {
      numberById[sessions[next].id] = i + 1;
      filled = true;
      next++;
    }
    if (filled) return;
    if (trainedDates?.has(occYMD)) {
      replaced.push(i + 1);
      replacedDates.push(occYMD);
    } else if (occYMD < todayYMD) {
      // Today's occurrence isn't missed until the day is over.
      missed.push(i + 1);
    }
  });

  return { numberById, missed, replaced, replacedDates, occurrences: occurrences.length };
}

/**
 * What a screen needs per workout card. Two different numbers on purpose:
 *
 *   numberById    how many times you have now DONE this day — what the card
 *                 says in words ("2nd session"). A week you missed isn't a
 *                 session you did, so it doesn't count here.
 *   positionById  which scheduled occurrence it was — where the dot sits on the
 *                 track. Miss week 2 and week 3's session is still the 3rd dot,
 *                 with the 2nd greyed out beside it.
 *
 * Together they read as "my 2nd session, and I'm in week 3 of the program".
 */
export type SessionTracks = {
  numberById: Record<string, number>;
  positionById: Record<string, number>;
  missedById: Record<string, number[]>;
  /** Occurrences trained with something else on their date (orange dots). */
  replacedById: Record<string, number[]>;
  /** Workout id → the scheduled day it stood in for, by the day's current
   *  label: the other end of an orange dot ("Instead of Push" on its card). */
  insteadOfById: Record<string, string>;
};

/**
 * Every workout's session number and missed occurrences, for a whole history.
 *
 * Grouped by (program, day): a `dayId` only means anything inside its program —
 * two pre-`dayIds` programs both have a positional `d0` — and a session is
 * attributed with `workoutBelongsToProgram`, the same rule the Progress page and
 * the Journal apply, so a legacy record with no `programId` still lands on the
 * program whose window it falls in. Active program wins a tie.
 *
 * Sessions the schedule can't place fall back to their rank among that day's
 * completed sessions, which is what both screens did for everything before this.
 * They get no missed dots: an unknown schedule can't say anything was missed.
 *
 * Shared because Home and the Journal render the same card and each used to
 * derive this for itself.
 */
export function buildSessionTracks(
  history: CompletedWorkout[],
  programs: SavedProgram[],
  todayYMD: string,
): SessionTracks {
  const numberById: Record<string, number> = {};
  const positionById: Record<string, number> = {};
  const missedById: Record<string, number[]> = {};
  const replacedById: Record<string, number[]> = {};

  // Every date anything was trained on, whichever program (if any) owns it: a
  // free custom workout on a Push day stood in for Push just as much as one
  // added to the program did.
  const trainedDates = new Set(history.map(w => w.date));

  const activeFirst = [...programs].sort((a, b) =>
    a.status === "active" ? -1 : b.status === "active" ? 1 : 0
  );
  const ownerById = new Map<string, SavedProgram | null>();
  for (const w of history) ownerById.set(w.id, activeFirst.find(p => workoutBelongsToProgram(w, p)) ?? null);

  // How many times this day has been DONE. Scoped to the owning program as well
  // as the day: a day id is only unique inside its program (two pre-dayIds
  // programs both have a positional "d0"), and two programs shouldn't share a
  // counter.
  const byDay: Record<string, CompletedWorkout[]> = {};
  for (const w of history) {
    const day = w.dayId ? `id:${w.dayId}` : `name:${normalizeDayName(w.workoutName)}`;
    const key = `${ownerById.get(w.id)?.id ?? ""}:${day}`;
    (byDay[key] ??= []).push(w);
  }
  for (const group of Object.values(byDay)) {
    group.sort((a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0));
    group.forEach((w, i) => { numberById[w.id] = i + 1; });
  }

  // Where each one sits on its day's schedule, and which occurrences nobody
  // trained.
  const byTrack = new Map<string, { program: SavedProgram; dayId: string; sessions: CompletedWorkout[] }>();
  for (const w of history) {
    const program = ownerById.get(w.id);
    if (!program || !w.dayId) continue;
    const key = `${program.id}:${w.dayId}`;
    const entry = byTrack.get(key) ?? { program, dayId: w.dayId, sessions: [] };
    entry.sessions.push(w);
    byTrack.set(key, entry);
  }
  // One track per (program, day), built once: the dots below and the "Instead
  // of" line after them both read it, so a card and the orange dot it explains
  // can't disagree. A day nobody has logged yet still gets one (empty history).
  const trackCache = new Map<string, SessionTrackInfo>();
  const trackFor = (program: SavedProgram, dayId: string): SessionTrackInfo => {
    const key = `${program.id}:${dayId}`;
    let track = trackCache.get(key);
    if (!track) {
      track = buildSessionTrack({ program, dayId, history: byTrack.get(key)?.sessions ?? [], todayYMD, trainedDates });
      trackCache.set(key, track);
    }
    return track;
  };

  for (const { program, dayId, sessions } of byTrack.values()) {
    const track = trackFor(program, dayId);
    for (const w of sessions) {
      const occurrence = track.numberById[w.id];
      if (occurrence === undefined) continue;
      positionById[w.id] = occurrence;
      missedById[w.id] = track.missed;
      replacedById[w.id] = track.replaced;
    }
  }

  // No schedule to place it against (a free workout, no slot, a start date moved
  // by a resumed hold): the dot sits where the count says, and nothing is
  // greyed — an unknown schedule can't claim anything was missed.
  for (const w of history) {
    if (positionById[w.id] === undefined) positionById[w.id] = numberById[w.id];
  }

  // What each session stood in for: the day its program scheduled on that
  // date, when that occurrence came out REPLACED. A session no program owns (a
  // custom workout not added) is read against the active program, whose day
  // it displaced all the same. A session OF that day fills the occurrence, so
  // it never reads as standing in for itself.
  const insteadOfById: Record<string, string> = {};
  const active = activeFirst.find(p => p.status === "active") ?? null;
  for (const w of history) {
    const program = ownerById.get(w.id) ?? active;
    if (!program) continue;
    const slot = cycleIndexForDate(program, w.date);
    if (slot === null) continue;
    const label = program.cyclePattern[slot];
    if (!label || normalizeDayName(label) === "rest") continue;
    // A pushed or held date isn't an occurrence, so it can't be in here.
    if (trackFor(program, dayIdAt(program, slot)).replacedDates.includes(w.date)) {
      insteadOfById[w.id] = label;
    }
  }

  return { numberById, positionById, missedById, replacedById, insteadOfById };
}

/** The program's start as "YYYY-MM-DD", or null when it can't be parsed — which
 *  callers must treat as "no schedule to count", never as a fallback date. */
function startOf(program: SavedProgram): string | null {
  const d = parseStoredDate(program.startDate);
  return d ? toYMD(d) : null;
}

function minYMD(a: string, b: string): string {
  return a < b ? a : b;
}
