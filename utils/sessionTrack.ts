// utils/sessionTrack.ts
//
// "3rd session" on a workout card, where its dot sits, and which of that day's
// sessions were MISSED.
//
// The number is the SCHEDULED OCCURRENCE of that workout day, not a count of what
// was completed, and the words and the dot are the same number. Counting
// completions made a missed week vanish: miss two of four sessions one week,
// train the next, and those two days came back as the "2nd session" while the
// days you never missed were on their "3rd". The number stopped answering "where
// am I in this program" and the four days quietly fell out of step with each
// other. From 2.8.0 to 2.11.1 the words still counted the sessions done while
// the dot showed the occurrence, so a card read "5th session" on its 6th dot and
// the days of one week read 5th and 6th side by side (user decision, 2026-10-22:
// one number, as Program Compare's, the miss shown by the grey dot beside it).
//
// Counting occurrences means a missed week still costs you a number: the day you
// skipped in week 2 is on its 3rd session in week 3, same as every other day.
// Which occurrence a session filled is read off the slot the program had on its
// date (placeSessions), so a day done early, Tuesday's on the Monday, is this
// week's rather than a second of last week's. An occurrence nobody trained is
// reported in `missed`, which is what draws the grey dot on the track, UNLESS
// something else was trained on its date (a custom workout, or another day
// picked with Change Workout Day). That one is
// `replaced` and draws orange: "you trained that day, just not this" and "you
// didn't train" are different things, and grey said the second for both. The
// session that did the replacing says so on its own card ("Instead of Push",
// `insteadOfById`), read off the same track so the two ends always agree.
//
// Every card draws the track as it stands TODAY, its own session marked: every
// occurrence logged in green wherever it falls, misses grey, the rest still to
// come. An older card used to light only the dots up to its own, so a later
// session read as an empty ring beside a later miss in grey: a week trained
// looked like neither (user report, 2026-10-16).
//
// A program counts only while it runs. On hold, the walk stops at the hold; made
// inactive or finished, at the day it stopped (`runEndYMD`), so the weeks since
// aren't missed and every card stays where it was. Run again, each run keeps its
// own track and its own count.
//
// Pure and RN-free (verified by scripts/verify-session-track.ts).

import { addDaysYMD, parseStoredDate, toYMD } from "./dates";
import { cycleIndexForDate } from "./workout";
import { heldOn, runStartYMD } from "./programHolds";
import { programAsRun } from "./programRuns";
import { isDatePushed } from "./skippedDates";
import { workoutBelongsToProgram } from "./progressStats";
import { customDayKey, dayIdAt, indexOfDayId, normalizeDayName } from "./programDays";
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
 *   occurrences that never came round. The hold the program is on ends the walk;
 *   one it came back from (SavedProgram.holds) is stepped over, and the walk
 *   begins on the day the run began (runStartYMD). Resuming moved startDate on
 *   by the days held: walked from there, the run's first days were left out,
 *   and the held days replayed the days before the hold as occurrences nobody
 *   could have trained.
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

  // Null when startDate can't be read: no schedule to count, never a
  // fallback date.
  const startYMD = runStartYMD(program);
  if (!startYMD) return [];

  const finish = programFinishDate(program);
  const lastYMD = finish ? minYMD(throughYMD, toYMD(finish)) : throughYMD;
  if (lastYMD < startYMD) return [];

  const out: string[] = [];
  let ymd = startYMD;
  for (let i = 0; i < MAX_WALK_DAYS && ymd <= lastYMD; i++, ymd = addDaysYMD(ymd, 1)) {
    if (program.pausedAt && ymd >= program.pausedAt) break;
    if (isDatePushed(program, ymd) || heldOn(program, ymd)) continue;
    if (cycleIndexForDate(program, ymd) !== slot) continue;
    out.push(ymd);
  }
  return out;
}

/**
 * A day's occurrences to place its sessions against (placeSessions): every one
 * come round by `throughYMD`, then the next one after it, which a session done
 * early can already have filled (Tuesday's workout done on Monday, with Tuesday
 * still to come). `cameRound` is how many of `dates` have come round.
 */
export function placingOccurrences(
  program: SavedProgram,
  dayId: string,
  throughYMD: string,
): { dates: string[]; cameRound: number } {
  // Two cycles on is past the next one, with a day or two moved on top.
  const walked = occurrencesOfDay(program, dayId, addDaysYMD(throughYMD, 2 * program.cycleDays));
  let cameRound = 0;
  while (cameRound < walked.length && walked[cameRound] <= throughYMD) cameRound++;
  return { dates: walked.slice(0, cameRound + 1), cameRound };
}

/**
 * Which occurrence of its day each session filled, as an index into
 * `occurrences` (placingOccurrences). A session the schedule can't place is
 * absent, and the caller counts it instead.
 *
 * A session fills its day's occurrence in the same cycle, which is read off the
 * slot the program had on the session's date (cycleIndexForDate, moves and
 * holds included):
 *
 *   On its day's own date, it's that occurrence.
 *
 *   Later in the cycle than its day (logged late), it's the latest occurrence
 *   before it: a session done a day or two late fills its own week rather than
 *   stealing the next, which is what happens every time a workout slides.
 *
 *   Earlier in the cycle than its day (Change Workout Day picking a later day
 *   of the week, or a day done anyway on the date Move to Tomorrow emptied),
 *   it's the NEXT occurrence, the one it was done ahead of, come round yet or
 *   not. Placed by its date alone, Lower done on Monday sat in last week's
 *   place: a second "2nd session", with this week's Lower drawn orange.
 *
 * Each session is placed by its own date and nothing else, so deleting one
 * never moves another (user request, 2026-10-16), and two in one cycle share a
 * number (a redo, or the day trained twice, isn't a new occurrence). The price
 * of reading the cycle: a day made up after the cycle has rolled over, Friday's
 * done the Monday after, counts as the new week's done early, and last week's
 * stays missed.
 *
 * Left out: anything dated before the run began, and anything after its day in
 * a cycle the day hadn't come round in yet (a first week that started past it).
 */
export function placeSessions(
  program: SavedProgram,
  dayId: string,
  occurrences: readonly string[],
  sessions: readonly Pick<CompletedWorkout, "id" | "date">[],
): Record<string, number> {
  const placed: Record<string, number> = {};
  const slot = indexOfDayId(program, dayId);
  const startYMD = runStartYMD(program);
  if (slot < 0 || !startYMD) return placed;
  for (const w of sessions) {
    // The latest occurrence on or before its date.
    let before = -1;
    while (before + 1 < occurrences.length && occurrences[before + 1] <= w.date) before++;
    if (before >= 0 && occurrences[before] === w.date) {
      placed[w.id] = before;
      continue;
    }
    // Its date's slot up to the day's own (equal on a date the day was moved
    // off): the day was still to come in this cycle.
    const at = w.date >= startYMD ? cycleIndexForDate(program, w.date) : null;
    if (at !== null && at <= slot && before + 1 < occurrences.length) placed[w.id] = before + 1;
    else if (before >= 0) placed[w.id] = before;
  }
  return placed;
}

export type SessionTrackInfo = {
  /** Workout id → which occurrence of its day it was (1-based), placeSessions.
   *  A session the schedule can't place is absent, and the caller counts it
   *  instead. */
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
  /** Occurrences with a session logged in them, all of them: a card draws the
   *  sessions after its own as well as the ones before. The next one still to
   *  come is among them once a session done early has filled it. */
  done: number[];
  /** How many occurrences have come round up to and including today. */
  occurrences: number;
  /** Their dates, then the next one's (placingOccurrences). */
  dates: string[];
};

/**
 * Match this day's sessions to its scheduled occurrences (placeSessions).
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
 *
 * `endYMD` is the run's last day once it has stopped (`runEndYMD`): nothing
 * after it came round, so nothing after it is missed.
 */
export function buildSessionTrack({ program, dayId, history, todayYMD, trainedDates, endYMD }: {
  program: SavedProgram;
  dayId: string;
  history: CompletedWorkout[];
  todayYMD: string;
  trainedDates?: ReadonlySet<string>;
  endYMD?: string | null;
}): SessionTrackInfo {
  const { dates, cameRound } = placingOccurrences(program, dayId, endYMD && endYMD < todayYMD ? endYMD : todayYMD);
  const numberById: Record<string, number> = {};
  const filled = new Set<number>();
  for (const [id, i] of Object.entries(placeSessions(program, dayId, dates, history))) {
    numberById[id] = i + 1;
    filled.add(i);
  }

  const missed: number[] = [];
  const replaced: number[] = [];
  const replacedDates: string[] = [];
  for (let i = 0; i < cameRound; i++) {
    if (filled.has(i)) continue;
    const occYMD = dates[i];
    if (trainedDates?.has(occYMD)) {
      replaced.push(i + 1);
      replacedDates.push(occYMD);
    } else if (occYMD < todayYMD) {
      // Today's occurrence isn't missed until the day is over.
      missed.push(i + 1);
    }
  }
  const done = [...filled].sort((a, b) => a - b).map(i => i + 1);

  return { numberById, missed, replaced, replacedDates, done, occurrences: cameRound, dates };
}

export type TrackDot = "done" | "current" | "replaced" | "missed" | "future";

/**
 * What each dot on a card's track is: the card's own session `current`, then
 * missed, replaced and logged ones as `buildSessionTracks` read them, wherever
 * they fall, and the rest `future` (not come round yet, or after a program
 * stopped). Without `done` (nothing to say which), every dot before the card's
 * own reads as done. Never fewer dots than the session shown: a pushed day can
 * give a program one more occurrence than it planned.
 */
export function trackDots({ current, total, missed, replaced, done }: {
  current: number;
  total: number;
  missed?: readonly number[];
  replaced?: readonly number[];
  done?: readonly number[];
}): TrackDot[] {
  const missedSet = new Set(missed ?? []);
  const replacedSet = new Set(replaced ?? []);
  const doneSet = done ? new Set(done) : null;
  return Array.from({ length: Math.max(total, current) }, (_, i): TrackDot => {
    const n = i + 1;
    if (replacedSet.has(n)) return "replaced";
    if (missedSet.has(n)) return "missed";
    if (n === current) return "current";
    if (doneSet) return doneSet.has(n) ? "done" : "future";
    return n < current ? "done" : "future";
  });
}

/** One run of a program day's track, as its cards read it: which of the
 *  program's runs (from 0, of `runs`). */
export type DayTrack = SessionTrackInfo & { run: number; runs: number };

/** What a screen needs per workout card. */
export type SessionTracks = {
  /** Which session of its day it was: what the card says ("3rd session") and
   *  where its dot sits, one number. The scheduled occurrence it filled, so
   *  miss week 2 and week 3's is the 3rd session, on the 3rd dot, with the 2nd
   *  greyed beside it. A session the schedule can't place counts the sessions
   *  of its day done instead. */
  numberById: Record<string, number>;
  missedById: Record<string, number[]>;
  /** Occurrences trained with something else on their date (orange dots). */
  replacedById: Record<string, number[]>;
  /** Occurrences logged (green dots), after the card's own as well as before.
   *  For a session the schedule can't place, the counts of the others like
   *  it, which is where their dots sit. */
  doneById: Record<string, number[]>;
  /** How many sessions of its day its run schedules in all: the track's
   *  length. 0 for an extra, which hides the track. */
  totalById: Record<string, number>;
  /** Workout id → the scheduled day it stood in for, by the day's current
   *  label: the other end of an orange dot ("Instead of Push" on its card). */
  insteadOfById: Record<string, string>;
  /** Workout id → the track the schedule placed it on, shared by every
   *  session of that day in that run; absent for one it couldn't place. What
   *  the exercise chart numbers its places by (utils/exerciseDaySlots.ts), so
   *  its numbers are the cards'. */
  trackById: Record<string, DayTrack>;
  /** Workout id → which of its program's runs it's in (from 0, of `runs`),
   *  for every session a program owns, placed or not: a session the schedule
   *  can't place is counted within its run, like the rest. */
  runOfById: Record<string, { run: number; runs: number }>;
};

/** One run of a program as the tracks read it: the program as that run left
 *  it (programAsRun), or as it is for the run it's on, and the day it began. */
type TrackRun = { program: SavedProgram; startYMD: string };

/** A program's runs, oldest first: each it was started again after
 *  (SavedProgram.runs), then the one it's on. Each reads its own timeline, so
 *  making a program active again starts a new track and leaves the cards of the
 *  run before where they were. */
function trackRuns(program: SavedProgram): TrackRun[] {
  const out: TrackRun[] = [];
  for (const run of program.runs ?? []) {
    const asRun = programAsRun(program, run);
    const startYMD = runStartYMD(asRun);
    if (startYMD) out.push({ program: asRun, startYMD });
  }
  const startYMD = runStartYMD(program);
  if (startYMD) out.push({ program, startYMD });
  return out;
}

/** Which of `runs` (oldest first) a session dated `ymd` is in: the last to
 *  have begun by then. One from before them all is counted with the first and
 *  sits on no track (it's before every occurrence). -1 with no runs. */
function runIndexFor(runs: readonly TrackRun[], ymd: string): number {
  if (runs.length === 0) return -1;
  let at = 0;
  runs.forEach((r, i) => { if (r.startYMD <= ymd) at = i; });
  return at;
}

/** The last day a run asks for a session on, once it has stopped; null while
 *  it runs (to today, or the day before the hold it's on). Finished: the day it
 *  was finished. Made inactive: no record of the day was kept, so its last
 *  session stands in, as on the program page (utils/programHistory.ts). Read on
 *  to today instead, every week since it stopped came out missed (user request,
 *  2026-10-16: a program paused or made inactive stops counting and stays where
 *  it was). */
function runEndYMD(run: TrackRun, sessions: readonly CompletedWorkout[]): string | null {
  const p = run.program;
  if (p.status === "active") return null;
  if (p.status === "completed") {
    const finished = parseStoredDate(p.completedDate);
    if (finished) return toYMD(finished);
  }
  let last: string | null = null;
  for (const w of sessions) if (w.date >= run.startYMD && (last === null || w.date > last)) last = w.date;
  return last ?? addDaysYMD(run.startYMD, -1);
}

/** How many sessions of `w`'s day `program` schedules in all. A dayId names
 *  one slot, so once a cycle; the name count is the fallback for a session
 *  with none, and it reads 0 once the day has been renamed (or for an extra,
 *  which hides the track). */
function scheduledSessions(program: SavedProgram, w: CompletedWorkout): number {
  const perCycle = w.dayId && indexOfDayId(program, w.dayId) >= 0
    ? 1
    : program.cyclePattern.filter(n => n === w.workoutName).length;
  return perCycle * Math.ceil(program.totalWeeks * 7 / program.cycleDays);
}

/**
 * Every workout's session number and missed occurrences, for a whole history.
 *
 * Grouped by (program, run, day): a `dayId` only means anything inside its
 * program — two pre-`dayIds` programs both have a positional `d0` — and a
 * session is attributed with `workoutBelongsToProgram`, the same rule the
 * Progress page and the Journal apply, so a legacy record with no `programId`
 * still lands on the program whose window it falls in. Active program wins a
 * tie. A program run again counts each run apart, on that run's own timeline.
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
  const missedById: Record<string, number[]> = {};
  const replacedById: Record<string, number[]> = {};
  const doneById: Record<string, number[]> = {};
  const totalById: Record<string, number> = {};

  // Every date anything was trained on, whichever program (if any) owns it: a
  // free custom workout on a Push day stood in for Push just as much as one
  // added to the program did.
  const trainedDates = new Set(history.map(w => w.date));

  const activeFirst = [...programs].sort((a, b) =>
    a.status === "active" ? -1 : b.status === "active" ? 1 : 0
  );
  const ownerById = new Map<string, SavedProgram | null>();
  for (const w of history) ownerById.set(w.id, activeFirst.find(p => workoutBelongsToProgram(w, p)) ?? null);

  // Each program's runs, and the run each of its sessions is in.
  const runsByProgram = new Map<string, TrackRun[]>();
  const runsOf = (p: SavedProgram): TrackRun[] => {
    let runs = runsByProgram.get(p.id);
    if (!runs) {
      runs = trackRuns(p);
      runsByProgram.set(p.id, runs);
    }
    return runs;
  };
  const runById = new Map<string, number>();
  const runSessions = new Map<string, CompletedWorkout[]>();
  for (const w of history) {
    const owner = ownerById.get(w.id);
    if (!owner) continue;
    const i = runIndexFor(runsOf(owner), w.date);
    runById.set(w.id, i);
    const key = `${owner.id}#${i}`;
    const list = runSessions.get(key);
    if (list) list.push(w);
    else runSessions.set(key, [w]);
    totalById[w.id] = scheduledSessions(i >= 0 ? runsOf(owner)[i].program : owner, w);
  }

  // How many times this day has been DONE, the number for a session the
  // schedule can't place. Scoped to the owning program and its run as well as
  // the day: a day id is only unique inside its program (two pre-dayIds
  // programs both have a positional "d0"), two programs shouldn't share a
  // counter, and a program run again starts counting again. A session in no
  // program counts on its day of Custom workouts (customDayKey), which is what
  // the Progress chart of that day numbers by.
  const byDay: Record<string, CompletedWorkout[]> = {};
  for (const w of history) {
    const day = w.dayId ? `id:${w.dayId}` : `name:${normalizeDayName(w.workoutName)}`;
    const owner = ownerById.get(w.id);
    const key = owner ? `${owner.id}#${runById.get(w.id)}:${day}` : `custom:${customDayKey(w)}`;
    (byDay[key] ??= []).push(w);
  }
  const countById: Record<string, number> = {};
  for (const group of Object.values(byDay)) {
    group.sort((a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0));
    group.forEach((w, i) => { countById[w.id] = i + 1; });
  }

  // Where each one sits on its day's schedule, and which occurrences nobody
  // trained.
  const byTrack = new Map<string, { program: SavedProgram; run: number; dayId: string; sessions: CompletedWorkout[] }>();
  for (const w of history) {
    const program = ownerById.get(w.id);
    const run = runById.get(w.id) ?? -1;
    if (!program || run < 0 || !w.dayId) continue;
    const key = `${program.id}#${run}:${w.dayId}`;
    const entry = byTrack.get(key) ?? { program, run, dayId: w.dayId, sessions: [] };
    entry.sessions.push(w);
    byTrack.set(key, entry);
  }
  // One track per (program, run, day), built once: the dots below and the
  // "Instead of" line after them both read it, so a card and the orange dot it
  // explains can't disagree. A day nobody has logged yet still gets one (empty
  // history).
  const trackCache = new Map<string, SessionTrackInfo>();
  const trackFor = (program: SavedProgram, run: number, dayId: string): SessionTrackInfo => {
    const key = `${program.id}#${run}:${dayId}`;
    let track = trackCache.get(key);
    if (!track) {
      const r = runsOf(program)[run];
      track = buildSessionTrack({
        program: r.program,
        dayId,
        history: byTrack.get(key)?.sessions ?? [],
        todayYMD,
        trainedDates,
        endYMD: runEndYMD(r, runSessions.get(`${program.id}#${run}`) ?? []),
      });
      trackCache.set(key, track);
    }
    return track;
  };

  const trackById: Record<string, DayTrack> = {};
  for (const { program, run, dayId, sessions } of byTrack.values()) {
    const track = trackFor(program, run, dayId);
    const dayTrack: DayTrack = { ...track, run, runs: runsOf(program).length };
    for (const w of sessions) {
      const occurrence = track.numberById[w.id];
      if (occurrence === undefined) continue;
      numberById[w.id] = occurrence;
      missedById[w.id] = track.missed;
      replacedById[w.id] = track.replaced;
      doneById[w.id] = track.done;
      trackById[w.id] = dayTrack;
    }
  }

  // No schedule to place it against (a free workout, no slot, a start date moved
  // by a hold resumed before holds were kept): it's numbered by the count, its
  // dot beside the others like it, and nothing is greyed — an unknown schedule
  // can't claim anything was missed.
  for (const group of Object.values(byDay)) {
    const unplaced = group.filter(w => numberById[w.id] === undefined);
    const counts = unplaced.map(w => countById[w.id]);
    for (const w of unplaced) {
      numberById[w.id] = countById[w.id];
      doneById[w.id] = counts;
    }
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
    const runs = runsOf(program);
    const run = runIndexFor(runs, w.date);
    // Before every run, nothing was scheduled.
    if (run < 0 || runs[run].startYMD > w.date) continue;
    const p = runs[run].program;
    const slot = cycleIndexForDate(p, w.date);
    if (slot === null) continue;
    const label = p.cyclePattern[slot];
    if (!label || normalizeDayName(label) === "rest") continue;
    // A pushed or held date isn't an occurrence, so it can't be in here.
    if (trackFor(program, run, dayIdAt(p, slot)).replacedDates.includes(w.date)) {
      insteadOfById[w.id] = label;
    }
  }

  const runOfById: Record<string, { run: number; runs: number }> = {};
  for (const [id, run] of runById) {
    const owner = ownerById.get(id);
    if (owner && run >= 0) runOfById[id] = { run, runs: runsOf(owner).length };
  }

  return { numberById, missedById, replacedById, doneById, totalById, insteadOfById, trackById, runOfById };
}

function minYMD(a: string, b: string): string {
  return a < b ? a : b;
}
