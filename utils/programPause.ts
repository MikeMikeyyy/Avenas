// utils/programPause.ts
//
// Putting an ACTIVE program temporarily on hold, and taking it off hold again.
//
// Distinct from Make Inactive: that drops a program out of the active slot so
// another can take its place (and sets status "paused", which means "shelved").
// A hold keeps the program active and in its slot — it just stops scheduling
// workouts and freezes the week counter until resumed. The state is the single
// `pausedAt` field on SavedProgram.
//
// ── The resume arithmetic ────────────────────────────────────────────────────
// utils/workout.ts resolveDayIndex computes
//   dayIndex = (daysPassed + cycleOffset) mod cycleDays,  daysPassed = date - startDate
//
// so shifting startDate forward by the paused days N does TWO jobs at once:
//
//   1. Weeks stop counting across the hold (getCurrentWeek measures from
//      startDate), so the finish date moves back by N.
//   2. daysPassed lands back on its value at the moment of pausing — i.e. the
//      cycle resumes on the day you paused, with no offset change at all.
//
// "Continue with today's workout" is then the same shift plus `cycleOffset += N`
// to cancel (2) while keeping (1).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROGRAMS_KEY, WORKOUT_DATES_KEY, type SavedProgram } from "../constants/programs";
import { formatStoredDate, parseStoredDate, todayYMD, toYMD } from "./dates";
import { resolveDayIndex } from "./workout";

/** Days a program has been held, as of `asOfYMD`. 0 when not paused. */
export function pausedDayCount(program: SavedProgram, asOfYMD: string = todayYMD()): number {
  if (!program.pausedAt) return 0;
  return Math.max(0, daysBetween(program.pausedAt, asOfYMD));
}

/** Whole days from `fromYMD` to `toYMD_`, both "YYYY-MM-DD". */
export function daysBetween(fromYMD: string, toYMD_: string): number {
  const a = ymdToDate(fromYMD);
  const b = ymdToDate(toYMD_);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function ymdToDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Put `programId` on hold as of `whenYMD`. Returns the updated list. */
export function pauseProgram(
  programs: SavedProgram[],
  programId: string,
  whenYMD: string = todayYMD(),
): SavedProgram[] {
  return programs.map(p =>
    p.id === programId
      // currentWeek is snapshotted so getCurrentWeek has something to freeze on.
      ? { ...p, pausedAt: whenYMD, currentWeek: Math.max(p.currentWeek || 1, 1) }
      : p,
  );
}

/** How a resumed program should pick the cycle back up. */
export type ResumeMode =
  /** Today's workout is whatever the cycle would naturally be had you not paused. */
  | "today"
  /** Carry on from the day you were on when you paused. */
  | "whereILeftOff";

/**
 * Take `programId` off hold. Both modes shift startDate forward by the paused
 * days so the remaining weeks are preserved; "today" additionally bumps
 * cycleOffset to cancel the cycle shift that comes with it.
 */
export function resumeProgram(
  programs: SavedProgram[],
  programId: string,
  mode: ResumeMode,
  onYMD: string = todayYMD(),
): SavedProgram[] {
  return programs.map(p => {
    if (p.id !== programId || !p.pausedAt) return p;
    const held = Math.max(0, daysBetween(p.pausedAt, onYMD));
    const start = parseStoredDate(p.startDate);
    // Unparseable startDate: clear the hold rather than trapping the user in it,
    // and leave the dates alone for the resolvers' own null handling to catch.
    if (!start) return { ...p, pausedAt: undefined };

    const shifted = new Date(start);
    shifted.setDate(shifted.getDate() + held);

    const offset =
      mode === "today"
        ? (((p.cycleOffset ?? 0) + held) % p.cycleDays + p.cycleDays) % p.cycleDays
        : p.cycleOffset;

    return { ...p, pausedAt: undefined, startDate: formatStoredDate(shifted), cycleOffset: offset };
  });
}

/**
 * The two cycle days a resume could land on, for the "which day?" prompt.
 * `today` is the natural day had the pause not happened; `whereILeftOff` is the
 * day the program was on when it was paused. Equal values mean there's nothing
 * to ask about.
 */
export function resumeDayOptions(
  program: SavedProgram,
  onYMD: string = todayYMD(),
): { today: number | null; whereILeftOff: number | null } {
  if (!program.pausedAt) return { today: null, whereILeftOff: null };
  // Run the real resume both ways and read the day each lands on. It must be the
  // PAUSED program that goes in — resumeProgram no-ops on one without pausedAt,
  // which would make both options identical and the prompt never appear. The
  // results already have pausedAt cleared, so resolveDayIndex's hold guard is
  // satisfied. Nothing is persisted; these are hypotheticals.
  const [withToday] = resumeProgram([program], program.id, "today", onYMD);
  const [withLeftOff] = resumeProgram([program], program.id, "whereILeftOff", onYMD);
  return {
    today: resolveDayIndex(withToday, onYMD),
    whereILeftOff: resolveDayIndex(withLeftOff, onYMD),
  };
}

/** The name of a cycle day index, or null for Rest/empty. */
export function dayNameAt(program: SavedProgram, dayIndex: number | null): string | null {
  if (dayIndex === null) return null;
  const name = program.cyclePattern[dayIndex];
  return !name || name === "Rest" ? null : name;
}

/** Days with no workout logged, counting back from today. Falls back to the
 *  program's start when nothing has ever been logged. */
export function idleDays(program: SavedProgram, workoutDates: string[], today: string = todayYMD()): number {
  const latest = workoutDates.length > 0 ? workoutDates.slice().sort().at(-1)! : null;
  if (latest) return daysBetween(latest, today);
  const start = parseStoredDate(program.startDate);
  return start ? daysBetween(toYMD(start), today) : 0;
}

/** A week off with nothing logged puts the program on hold by itself. */
export const AUTO_PAUSE_AFTER_DAYS = 7;

/**
 * Pause the active program when a full week has gone by with no workouts.
 * Returns the program that was paused, or null when nothing changed.
 *
 * pausedAt is set to TODAY rather than the day the streak actually broke:
 * backdating would retroactively blank days the weekly strip has already shown
 * as scheduled, and this change should only ever apply going forward.
 *
 * Safe to call on every launch and foreground — it no-ops once paused.
 */
export async function autoPauseIfIdle(): Promise<SavedProgram | null> {
  try {
    const raw = await AsyncStorage.getItem(PROGRAMS_KEY);
    const programs: SavedProgram[] = raw ? JSON.parse(raw) : [];
    const active = programs.find(p => p.status === "active");
    if (!active || active.pausedAt) return null;

    const datesRaw = await AsyncStorage.getItem(WORKOUT_DATES_KEY);
    const dates: string[] = datesRaw ? JSON.parse(datesRaw) : [];
    if (idleDays(active, dates) < AUTO_PAUSE_AFTER_DAYS) return null;

    const updated = pauseProgram(programs, active.id);
    await AsyncStorage.setItem(PROGRAMS_KEY, JSON.stringify(updated));
    return updated.find(p => p.id === active.id) ?? null;
  } catch (err) {
    if (__DEV__) console.warn("[avenas] autoPauseIfIdle", err);
    return null;
  }
}
