// utils/trainingTotals.ts
//
// The Journal's Your Training card (components/journal/JournalTrainingCard.tsx;
// user pick, 2026-11-19, option E of the Journal Training Card canvas, with
// option A's hours, PRs and programs finished added): someone's whole history
// at a glance, where the rest of the app shows a week (Home), a month (the
// calendar), a fortnight (Recent Activity) or a lift (Progress). The user's own
// Journal and a trainer's view of a client's draw it from the same history, so
// the two can't disagree.
//
//   - Workouts: every session logged, the count the milestone cards use
//     (utils/achievements.ts: a day with two sessions is two). "since" the
//     first one's training day.
//   - Time: every session's length added up.
//   - PRs: the trophies AND the medals the sessions wear (user decision, the
//     same day: "we added improving the reps as a pr right? if so add that in
//     too"): countTrophies + countMedals, one pass each, so the number is
//     always the marks on the sessions themselves.
//   - Programs finished: every run that ended Completed, Mark Complete
//     included (user decision, the same day: "anything marked as finished").
//     A program run twice and finished twice is two.
//   - The weekly bars: the last STRIP_WEEKS Monday weeks (Home's weeks,
//     weekStartFor), ending with the week of the training day the app is on
//     (getEffectiveToday: before 3am is still yesterday). Weeks before the
//     first workout are nothing, not weeks off.
//   - Then and now: a session from at least 3 months ago, and the lift in it
//     that has come on most since, against the last time it was done.
//
// Pure and RN-free (scripts/verify-training-totals.ts runs it under tsx).

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import { addDaysYMD, fromYMD, MONTH_FULL, MONTH_NAMES } from "./dates";
import { buildWeekSchedule, weekStartFor } from "./weekSchedule";
import { resolveWorkoutForDate, type DayOverride } from "./workout";
import { countTrophies, formatWeight } from "./achievements";
import { countMedals } from "./repPrs";
import { exerciseIdentity } from "./exerciseNames";
import { isAssistedIdentity, liftBeats } from "./assisted";
import { SAME_KG, trimNumber } from "./units";

/** How many weeks the bars go back, this week included. */
export const STRIP_WEEKS = 26;
/** Then and now's "then" is at least this many months back... */
export const THEN_MONTHS = 3;
/** ...and the newest this many sessions from that far back are tried, newest
 *  first, so one with nothing that's come on since doesn't hide the line. */
export const THEN_TRIES = 8;
/** The first workout stands in for "then" (with less history than that, or as
 *  the last one tried) once it's at least this many days old. */
export const FIRST_AFTER_DAYS = 14;
/** "Now" is the last time the lift was done, within this many days. */
export const NOW_WITHIN_DAYS = 42;

/** One week of the bars. */
export type StripWeek = {
  /** Its Monday, "YYYY-MM-DD". */
  start: string;
  /** Sessions logged in it, or null before the first workout (nothing drawn
   *  there: there was nothing yet to miss). */
  workouts: number | null;
};

/** A lift's best set in one session: the heaviest (the least help, for an
 *  assisted one), then the most reps. */
export type TopSet = { kg: number; reps: number };

export type ThenAndNow = {
  /** The "then" session: what the line opens. */
  workoutId: string;
  /** Its training day. */
  date: string;
  /** It's the first workout logged. */
  first: boolean;
  /** The lift, by its name the last time it was done. */
  exerciseName: string;
  then: TopSet;
  now: TopSet;
};

export type TrainingTotals = {
  workouts: number;
  /** The first workout's training day, or null for none. */
  firstDate: string | null;
  /** Every session's length added up. */
  seconds: number;
  /** Trophies plus medals. */
  prs: number;
  programsFinished: number;
  /** STRIP_WEEKS of them, oldest first, ending this week. */
  weeks: StripWeek[];
  /** Of the weeks counted, how many have a workout. */
  weeksTrained: number;
  /** The weeks the sentence counts: every week since the first workout in the
   *  bars, this week only once it has a workout (a week under way isn't one
   *  missed). */
  weeksCounted: number;
  /** The first workout is inside the bars: the sentence says "since you
   *  started", not "the last 26 weeks". */
  sinceStart: boolean;
  memory: ThenAndNow | null;
};

/** A number typed or stored on a set, or 0 for anything not above zero. */
function positive(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether `a` is a better set than `b`: a better weight by more than
 *  SAME_KG (heavier, or for an assisted lift less help), else more reps. */
function beats(a: TopSet, b: TopSet, assisted: boolean): boolean {
  if (Math.abs(a.kg - b.kg) >= SAME_KG) return liftBeats(a.kg, b.kg, assisted);
  return a.reps > b.reps;
}

/** A lift's best set in `w`, over every card it's on: working sets ticked,
 *  with reps and a weight in. A hold's "reps" are seconds and a bodyweight set
 *  has no weight to compare, so neither has one. */
function topSetOf(w: CompletedWorkout, identity: string, assisted: boolean): TopSet | null {
  let top: TopSet | null = null;
  for (const ex of w.exercises) {
    if (!ex.name || ex.isIsometric || exerciseIdentity(ex) !== identity) continue;
    for (const s of ex.sets) {
      if (s.type !== "working" || !s.done) continue;
      const set = { kg: positive(s.weight), reps: positive(s.reps) };
      if (set.kg === 0 || set.reps === 0) continue;
      if (!top || beats(set, top, assisted)) top = set;
    }
  }
  return top;
}

/** `ymd` `months` calendar months earlier, the day held to the month's end
 *  (31 May less 3 months is 28 or 29 February). */
export function monthsBeforeYMD(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** Whole calendar months from `a` to `b` (both "YYYY-MM-DD"). */
function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (by * 12 + bm) - (ay * 12 + am) - (bd < ad ? 1 : 0);
}

/**
 * Then and now: the newest session at least THEN_MONTHS back (up to THEN_TRIES
 * of them, newest first, then the first workout once it's FIRST_AFTER_DAYS
 * old), and in the first of those with one, the lift that has come on most
 * since: its best set then against its best the last time it was done, within
 * NOW_WITHIN_DAYS. Come on means a better weight (heavier, or less help on an
 * assisted lift: liftBeats) or the same weight for more reps; most means the
 * biggest change of weight for its size, then the most reps gained, then the
 * first in the session. Holds and bodyweight lifts don't count. Null when
 * nothing has come on: the line never shows a lift going backwards.
 */
export function thenAndNow(history: readonly CompletedWorkout[], today: string): ThenAndNow | null {
  const newestFirst = history
    .filter(w => fromYMD(w.date) !== null)
    .sort((a, b) => (a.date !== b.date
      ? (a.date < b.date ? 1 : -1)
      : (Date.parse(b.completedAt) || 0) - (Date.parse(a.completedAt) || 0)));
  if (newestFirst.length === 0) return null;
  const firstWorkout = newestFirst[newestFirst.length - 1];
  const cutoff = monthsBeforeYMD(today, THEN_MONTHS);
  const recentFrom = addDaysYMD(today, -NOW_WITHIN_DAYS);

  const tries = newestFirst.filter(w => w.date <= cutoff).slice(0, THEN_TRIES);
  if (!tries.includes(firstWorkout) && firstWorkout.date <= addDaysYMD(today, -FIRST_AFTER_DAYS)) tries.push(firstWorkout);

  for (const then of tries) {
    const thenAt = newestFirst.indexOf(then);
    let pick: { identity: string; then: TopSet; now: TopSet; name: string; weight: number; reps: number } | null = null;
    const seen = new Set<string>();
    for (const ex of then.exercises) {
      const identity = ex.name ? exerciseIdentity(ex) : "";
      if (!identity || ex.isIsometric || seen.has(identity)) continue;
      seen.add(identity);
      const assisted = isAssistedIdentity(identity);
      const thenTop = topSetOf(then, identity, assisted);
      if (!thenTop) continue;
      // The last time it was done: the newest session after `then`, recent.
      let nowTop: TopSet | null = null;
      let name = ex.name;
      for (let i = 0; i < thenAt; i++) {
        const w = newestFirst[i];
        if (w.date < recentFrom) break;
        const top = topSetOf(w, identity, assisted);
        if (!top) continue;
        nowTop = top;
        name = w.exercises.find(e => e.name && exerciseIdentity(e) === identity)?.name ?? name;
        break;
      }
      if (!nowTop || !beats(nowTop, thenTop, assisted)) continue;
      const weight = Math.abs(nowTop.kg - thenTop.kg) >= SAME_KG ? Math.abs(nowTop.kg - thenTop.kg) / thenTop.kg : 0;
      const reps = nowTop.reps - thenTop.reps;
      if (!pick || weight > pick.weight || (weight === pick.weight && reps > pick.reps)) {
        pick = { identity, then: thenTop, now: nowTop, name, weight, reps };
      }
    }
    if (pick) {
      return {
        workoutId: then.id, date: then.date, first: then === firstWorkout,
        exerciseName: pick.name, then: pick.then, now: pick.now,
      };
    }
  }
  return null;
}

/** Every run of every program that ended Completed: each one's earlier runs
 *  (SavedProgram.runs) and the program as it stands. */
export function programsFinished(programs: readonly SavedProgram[]): number {
  return programs.reduce(
    (n, p) => n + (p.runs ?? []).filter(r => r.status === "completed").length + (p.status === "completed" ? 1 : 0),
    0,
  );
}

/** The card's numbers, for one person's history and programs. `today` is the
 *  training day the app is on (getEffectiveToday). */
export function trainingTotals({ history, programs, today }: {
  history: readonly CompletedWorkout[];
  programs: readonly SavedProgram[];
  today: string;
}): TrainingTotals {
  let firstDate: string | null = null;
  let seconds = 0;
  const perWeek = new Map<string, number>();
  const thisWeek = weekStartFor(today);
  const lastDay = addDaysYMD(thisWeek, 6);
  for (const w of history) {
    if (Number.isFinite(w.durationSeconds) && w.durationSeconds > 0) seconds += w.durationSeconds;
    if (fromYMD(w.date) === null) continue;
    if (firstDate === null || w.date < firstDate) firstDate = w.date;
    if (w.date > lastDay) continue;
    const week = weekStartFor(w.date);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }

  const firstWeek = firstDate ? weekStartFor(firstDate) : null;
  const weeks: StripWeek[] = [];
  for (let i = STRIP_WEEKS - 1; i >= 0; i--) {
    const start = addDaysYMD(thisWeek, -7 * i);
    weeks.push({ start, workouts: firstWeek !== null && start >= firstWeek ? perWeek.get(start) ?? 0 : null });
  }
  const counted = weeks.filter((w, i) => w.workouts !== null && (i < weeks.length - 1 || w.workouts > 0));

  return {
    workouts: history.length,
    firstDate,
    seconds,
    prs: countTrophies(history) + countMedals(history),
    programsFinished: programsFinished(programs),
    weeks,
    weeksTrained: counted.filter(w => (w.workouts ?? 0) > 0).length,
    weeksCounted: counted.length,
    sinceStart: firstWeek !== null && firstWeek > weeks[0].start,
    memory: thenAndNow(history, today),
  };
}

/**
 * Workouts the week of `today` holds: Home's ring's count (its plannedCount),
 * worked out exactly as Home works it out, so the pale part of this week's bar
 * and Home's ring can't disagree. Null with no program active. `override` is
 * the stored change-day pick (WORKOUT_DAY_OVERRIDE_KEY); a trainer's view of a
 * client's has none to pass.
 */
export function plannedThisWeek({ program, history, programs, today, override }: {
  program: SavedProgram | null;
  history: CompletedWorkout[];
  programs: SavedProgram[];
  today: string;
  override: DayOverride | null;
}): number | null {
  if (!program) return null;
  const resolved = resolveWorkoutForDate(program, override, today, programs);
  return buildWeekSchedule({
    program, history, weekStartYMD: weekStartFor(today), effectiveToday: today,
    resolvedTodayName: resolved?.name ?? null, override, allPrograms: programs,
  }).plannedCount;
}

// ─── What the card says ──────────────────────────────────────────────────────

/** 1,204 for 1204. */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "since 12 January", with its year when that isn't this one. */
export function sinceText(firstDate: string, today: string): string {
  const [y, m, d] = firstDate.split("-").map(Number);
  return `since ${d} ${MONTH_FULL[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ""}`;
}

/** The line under the bars, the part in green apart. */
export function stripSentence(t: Pick<TrainingTotals, "weeksTrained" | "weeksCounted" | "sinceStart">): { lead: string; strong: string; tail: string } {
  if (t.sinceStart && t.weeksCounted <= 1) return { lead: "Your ", strong: "first week", tail: " of training." };
  if (t.sinceStart) {
    return t.weeksTrained === t.weeksCounted
      ? { lead: "You've trained ", strong: "every week", tail: " since you started." }
      : { lead: "You trained ", strong: `${t.weeksTrained} of the ${t.weeksCounted} weeks`, tail: " since you started." };
  }
  return t.weeksTrained === t.weeksCounted
    ? { lead: "You trained ", strong: `every one of the last ${t.weeksCounted} weeks`, tail: "." }
    : { lead: "You trained ", strong: `${t.weeksTrained} of the last ${t.weeksCounted} weeks`, tail: "." };
}

/** One of the quiet facts under the sentence. */
export type TrainingFact = { key: "time" | "prs" | "programs"; num: string; word: string };

/** Time, PRs and programs finished, each only once it has something to count
 *  (never "0 programs finished"), its word singular at one. Time is whole
 *  hours, or minutes under the first hour. */
export function trainingFacts(t: Pick<TrainingTotals, "seconds" | "prs" | "programsFinished">): TrainingFact[] {
  const out: TrainingFact[] = [];
  const hours = Math.floor(t.seconds / 3600);
  const minutes = Math.floor(t.seconds / 60);
  if (hours > 0) out.push({ key: "time", num: groupDigits(hours), word: hours === 1 ? "hour" : "hours" });
  else if (minutes > 0) out.push({ key: "time", num: groupDigits(minutes), word: minutes === 1 ? "minute" : "minutes" });
  if (t.prs > 0) out.push({ key: "prs", num: groupDigits(t.prs), word: t.prs === 1 ? "PR" : "PRs" });
  if (t.programsFinished > 0) {
    out.push({ key: "programs", num: groupDigits(t.programsFinished), word: t.programsFinished === 1 ? "program finished" : "programs finished" });
  }
  return out;
}

/** The month under the first week that starts in it (the first week of the
 *  bars has none: it's partway through its month). Over the weeks before the
 *  first workout too, so the months sit where they always do. */
export function stripMonths(weeks: readonly StripWeek[]): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].start.slice(0, 7) !== weeks[i - 1].start.slice(0, 7)) {
      out.push({ col: i, label: MONTH_NAMES[Number(weeks[i].start.slice(5, 7)) - 1] });
    }
  }
  return out;
}

/** "3 months ago  ·  19 Aug" over then and now, or "Your first workout  ·
 *  26 Oct"; a date not this year with its year. */
export function memoryWhen(m: Pick<ThenAndNow, "date" | "first">, today: string): string {
  const [y, mo, d] = m.date.split("-").map(Number);
  const day = `${d} ${MONTH_NAMES[mo - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ""}`;
  if (m.first) return `Your first workout  ·  ${day}`;
  const months = monthsBetween(m.date, today);
  const ago = months >= 12
    ? (months < 24 ? "1 year ago" : `${Math.floor(months / 12)} years ago`)
    : `${months} months ago`;
  return `${ago}  ·  ${day}`;
}

/** "72.5 kg × 6", in the unit on screen. */
export function topSetText(s: TopSet, isKg: boolean): string {
  return `${formatWeight(s.kg, isKg)} × ${trimNumber(s.reps, 1)}`;
}
