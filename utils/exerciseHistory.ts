// utils/exerciseHistory.ts
//
// The sessions the Exercise History page (app/exercise-history.tsx) lists for
// one exercise: every session inside the chosen time range that did it, from
// the programs, days and Custom workouts picked in its filter (opened from the
// Progress chart, the chart's day), newest first, with the sets that were
// done, which of them were new PRs, its top set against the session before it,
// and what was written on it. Also what the filter offers, and how a tap in it
// changes what's picked. Pure, so scripts/verify-training-months.ts can check
// the page against the chart it's opened from and against what was lifted.

import type { CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import { CUSTOM_WORKOUTS_NAME, workoutBelongsToProgram } from "./progressStats";
import { exerciseIdentity } from "./exerciseNames";
import { bestBeforeEach, isPrSet } from "./achievements";
import { customDayKey, displayWorkoutName, indexOfDayId } from "./programDays";

/** One thing the page can be filtered to. None picked is everything. */
export type HistoryPick =
  /** Every session of a program, on any of its days. */
  | { kind: "program"; programId: string }
  /** One day of a program, as the Progress chart scopes it: by its slot id
   *  where a session recorded one, else by its name. Every program's days are
   *  d0, d1… (normalizeDayIds), so the program counts too: a slot id alone
   *  matched every program's first day (Push Pull Legs' Push listed Upper
   *  Lower's Upper sessions). A session with no program id (from before them)
   *  still goes by its day. */
  | { kind: "day"; programId?: string; dayId?: string; dayName?: string }
  /** Sessions of no program (Custom workouts): free workouts, imported ones,
   *  and any whose program is gone. With `day`, one day of them as the
   *  Progress chart has it (its customDayKey), named `dayName`. */
  | { kind: "free"; day?: string; dayName?: string };

/** A program in the filter, with its days when it did the exercise on more
 *  than one (one day is the whole program, so it has none to list). */
export type HistoryProgramOption = {
  programId: string;
  name: string;
  /** The program running now: listed first, with the accent dot. */
  active: boolean;
  days: { key: string; name: string; pick: Extract<HistoryPick, { kind: "day" }> }[];
};

export type HistoryOptions = {
  programs: HistoryProgramOption[];
  /** Any session of it with no program to list under. */
  free: boolean;
};

/** A pill in the filter: everything, a program, one of its days, or the free
 *  workouts. */
export type HistoryFilterItem =
  | { kind: "all" }
  | { kind: "program"; programId: string }
  | { kind: "day"; programId: string; key: string }
  | { kind: "free" };

/** A session's top set against the one before it on the page. */
export type TopSetChange =
  /** A different weight: the difference in kg, up positive. */
  | { kind: "weight"; kg: number }
  /** The same weight, a different number of reps (a hold's seconds). */
  | { kind: "reps"; reps: number }
  | { kind: "same" };

export type ExerciseHistoryRow = {
  workoutId: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO
  workoutName: string;   // the day's workout label, e.g. "Push"
  programName: string;   // the program's name, or "Free workout"
  /** The exercise's done sets in this session, warmups included: every time
   *  it was done in the session, in the order done. */
  sets: CompletedSet[];
  /** Per set in `sets`: a new PR when it was lifted, the trophy its Journal
   *  page shows (utils/achievements.ts isPrSet). */
  prs: boolean[];
  /** The top set's place in `sets`: the heaviest working set with its reps
   *  in, the most reps at that weight (the chart's Strength dot). -1 when
   *  there's none (only warmups done). */
  top: number;
  /** The top set against the session before it on this page (in any time
   *  range, so the oldest one listed still has its own). Null for the first
   *  session, or when either has no top set, or one was a hold and the other
   *  wasn't (seconds aren't reps). */
  change: TopSetChange | null;
  /** A timed hold: its sets' reps are seconds. */
  isHold: boolean;
  /** What was written on the exercise that session, "" for nothing. */
  notes: string;
};

// Lowercase-trim match for day names. Exercise names go through exerciseKey,
// so sessions logged under a since-renamed name still list.
function key(s: string): string {
  return s.trim().toLowerCase();
}

/** A number typed on a set, or 0 for anything not above zero. */
function positive(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Two weights this close are the same weight: one typed in pounds is stored in
// kilos a hair off whole, and across a switch of unit 220.5 lbs is 0.017 kg off
// 100 kg. Anything closer would read "▲ 0 lbs" (pounds show to a tenth).
export const SAME_KG = 0.025;

function topSetOf(sets: CompletedSet[]): number {
  let at = -1;
  let kg = 0;
  let reps = 0;
  sets.forEach((s, i) => {
    const r = positive(s.reps);
    if (s.type !== "working" || r === 0) return;
    const w = positive(s.weight);
    // As the chart picks its Strength dot (collectExerciseHistory).
    if (at === -1 || w > kg || (w === kg && r > reps)) {
      at = i;
      kg = w;
      reps = r;
    }
  });
  return at;
}

function compareTops(now: CompletedSet, before: CompletedSet): TopSetChange {
  const kg = positive(now.weight) - positive(before.weight);
  if (Math.abs(kg) >= SAME_KG) return { kind: "weight", kg };
  const reps = positive(now.reps) - positive(before.reps);
  return reps !== 0 ? { kind: "reps", reps } : { kind: "same" };
}

/** The program a session is listed under: by its stamped id (none for a free
 *  workout, "", or one whose program is gone), else, from before ids, the
 *  program with a day of its name that was running then. The rule the
 *  Progress page and the workout cards go by (workoutBelongsToProgram), so a
 *  session is under Custom workouts on all three or on none. */
function ownerOf(w: CompletedWorkout, programs: SavedProgram[]): SavedProgram | undefined {
  return programs.find(p => workoutBelongsToProgram(w, p));
}

/** Whether a session is on a day pick, exactly as the Progress chart scopes a
 *  day (workoutMatchesDay): its program (a session from before program ids
 *  passes), then its slot id where it recorded one (so a renamed day keeps its
 *  history, and two same-named days don't pool), else its name. */
function onDay(w: CompletedWorkout, pick: Extract<HistoryPick, { kind: "day" }>): boolean {
  if (pick.programId && w.programId !== undefined && w.programId !== pick.programId) return false;
  const wantDayId = typeof pick.dayId === "string" && pick.dayId.trim() ? pick.dayId : null;
  const wantDay = typeof pick.dayName === "string" && pick.dayName.trim() ? key(pick.dayName) : null;
  if (wantDayId !== null && w.dayId) return w.dayId === wantDayId;
  return wantDay === null || key(w.workoutName) === wantDay;
}

function picked(w: CompletedWorkout, picks: readonly HistoryPick[], programs: SavedProgram[]): boolean {
  if (picks.length === 0) return true;
  return picks.some(p => {
    if (p.kind === "day") return onDay(w, p);
    const owner = ownerOf(w, programs);
    if (p.kind === "free") return owner === undefined && (!p.day || customDayKey(w) === p.day);
    return owner?.id === p.programId;
  });
}

export function exerciseHistoryRows(
  history: CompletedWorkout[],
  programs: SavedProgram[],
  { exerciseName, customId, picks = [], days, today = new Date() }: {
    exerciseName: string;
    /** Which custom exercise of that name (utils/exerciseNames.ts
     *  exerciseIdentity): another later given its name lists nothing here. */
    customId?: string;
    /** What the filter has picked; none is every session. */
    picks?: readonly HistoryPick[];
    /** The time range: sessions older than `today` less this many days drop. */
    days: number;
    today?: Date;
  },
): ExerciseHistoryRow[] {
  const want = exerciseIdentity({ name: exerciseName, customId });
  // Date cutoff for the active range — sessions older than this are dropped.
  const cutoff = new Date(today);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();

  // A PR is against every session of the exercise before it, on any day.
  const bestBefore = bestBeforeEach(history, want);

  // Every session picked, whatever its date: the oldest one in the range
  // still compares with the session before it.
  const all: { row: ExerciseHistoryRow; dayMs: number }[] = [];
  for (const w of history) {
    if (!picked(w, picks, programs)) continue;
    const [yy, mm, dd] = w.date.split("-").map(Number);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) continue;
    // Every time it was done in the session (a day can have it twice), as the
    // chart counts it.
    const mine = w.exercises.filter(e => exerciseIdentity(e) === want);
    // Include warmup + working — drop only un-done sets. Warmups render
    // quieter so the user can still tell them apart.
    const doneSets = mine.flatMap(e => e.sets.filter(s => s.done));
    if (doneSets.length === 0) continue;
    const best = bestBefore.get(w.id);
    const owningProgram = ownerOf(w, programs);
    const notes = [...new Set(mine.map(e => (typeof e.notes === "string" ? e.notes.trim() : "")).filter(Boolean))];
    all.push({
      dayMs: new Date(yy, mm - 1, dd).getTime(),
      row: {
        workoutId: w.id,
        date: w.date,
        completedAt: w.completedAt,
        workoutName: w.workoutName,
        // In no program: the deleted program it was logged under when that's
        // known (CompletedWorkout.programName).
        programName: owningProgram?.name ?? w.programName ?? (w.programId ? "Deleted program" : "Custom workout"),
        sets: doneSets,
        prs: doneSets.map(s => isPrSet({ type: s.type, done: s.done, reps: s.reps, weightKg: positive(s.weight) }, best)),
        top: topSetOf(doneSets),
        change: null,
        isHold: mine.some(e => e.isIsometric === true),
        notes: notes.join("\n"),
      },
    });
  }
  // Newest first.
  all.sort((a, b) => b.row.completedAt.localeCompare(a.row.completedAt));
  all.forEach(({ row }, i) => {
    const before = all[i + 1]?.row;
    if (!before || row.top < 0 || before.top < 0 || row.isHold !== before.isHold) return;
    row.change = compareTops(row.sets[row.top], before.sets[before.top]);
  });
  return all.filter(x => x.dayMs >= cutoffMs).map(x => x.row);
}

type DayPick = Extract<HistoryPick, { kind: "day" }>;

/** A day's identity in the filter: its slot id, else its name. */
function dayKeyOf(p: DayPick): string {
  return p.dayId ? `id:${p.dayId}` : `name:${key(p.dayName ?? "")}`;
}

/**
 * What the filter offers for one exercise: every program with a session of it
 * (in any range, so changing the range never takes one away), the one running
 * now first, then the most recently done; each with its days when it was done
 * on more than one; and whether any session of it has no program.
 */
export function exerciseHistoryOptions(
  history: CompletedWorkout[],
  programs: SavedProgram[],
  exercise: { name: string; customId?: string },
): HistoryOptions {
  const want = exerciseIdentity(exercise);
  type Day = { key: string; name: string; index: number; seenAt: string; pick: DayPick };
  const byProgram = new Map<string, { program: SavedProgram; last: string; days: Map<string, Day> }>();
  let free = false;
  for (const w of history) {
    if (!w.exercises.some(e => exerciseIdentity(e) === want && e.sets.some(s => s.done))) continue;
    const owner = ownerOf(w, programs);
    if (!owner) {
      free = true;
      continue;
    }
    const entry = byProgram.get(owner.id) ?? { program: owner, last: "", days: new Map<string, Day>() };
    byProgram.set(owner.id, entry);
    if (w.completedAt > entry.last) entry.last = w.completedAt;
    // By its slot, named as the program names it now; a slot gone from the
    // cycle, or a session with none, by the name it was logged under (the
    // newest one's).
    const index = w.dayId ? indexOfDayId(owner, w.dayId) : -1;
    const dayKey = w.dayId ? `id:${w.dayId}` : `name:${key(w.workoutName)}`;
    const seen = entry.days.get(dayKey);
    if (!seen || (index < 0 && w.completedAt > seen.seenAt)) {
      const name = index >= 0 ? owner.cyclePattern[index] : w.workoutName;
      entry.days.set(dayKey, {
        key: dayKey, name, index, seenAt: w.completedAt,
        pick: { kind: "day", programId: owner.id, ...(w.dayId ? { dayId: w.dayId } : {}), dayName: name },
      });
    }
  }
  const options: HistoryProgramOption[] = [...byProgram.values()]
    .sort((a, b) => Number(b.program.status === "active") - Number(a.program.status === "active") || b.last.localeCompare(a.last))
    .map(({ program, days }) => {
      // A session with no slot but the name of a slot is on that slot (a day
      // picked by its slot takes sessions without one by name).
      const slotNames = new Set([...days.values()].filter(d => d.key.startsWith("id:")).map(d => key(d.name)));
      const listed = [...days.values()]
        .filter(d => d.key.startsWith("id:") || !slotNames.has(key(d.name)))
        .sort((a, b) => (a.index < 0 ? Infinity : a.index) - (b.index < 0 ? Infinity : b.index) || a.name.localeCompare(b.name));
      // A cycle can name two days alike: each says which day of the cycle.
      const twice = (n: string) => listed.filter(d => key(d.name) === key(n)).length > 1;
      return {
        programId: program.id,
        name: program.name,
        active: program.status === "active",
        days: listed.length < 2 ? [] : listed.map(d => ({
          key: d.key,
          name: twice(d.name) && d.index >= 0 ? `${displayWorkoutName(d.name)}, day ${d.index + 1}` : displayWorkoutName(d.name),
          pick: d.pick,
        })),
      };
    });
  return { programs: options, free };
}

/**
 * Whether a pill in the filter shows picked. A program does when it's picked
 * whole, or every day it lists is, or (listing none) its one day is; a day
 * does when it is, or its program is whole; everything does when nothing is.
 */
export function isPicked(picks: readonly HistoryPick[], item: HistoryFilterItem, options: HistoryOptions): boolean {
  const whole = (programId: string) => picks.some(p => p.kind === "program" && p.programId === programId);
  const dayPicks = (programId: string) => picks.filter((p): p is DayPick => p.kind === "day" && p.programId === programId);
  switch (item.kind) {
    case "all":
      return picks.length === 0;
    case "free":
      return picks.some(p => p.kind === "free");
    case "program": {
      if (whole(item.programId)) return true;
      const listed = options.programs.find(o => o.programId === item.programId)?.days ?? [];
      const on = dayPicks(item.programId);
      return listed.length === 0 ? on.length > 0 : listed.every(d => on.some(p => dayKeyOf(p) === d.key));
    }
    case "day":
      return whole(item.programId) || dayPicks(item.programId).some(p => dayKeyOf(p) === item.key);
  }
}

/**
 * What's picked after a tap on a pill (as many as wanted). Everything clears
 * the rest. A program toggles whole, its days with it. A day toggles alone:
 * every day of a program is the program, and one taken off a whole program
 * leaves its others. The free workouts toggle.
 */
export function togglePick(picks: readonly HistoryPick[], item: HistoryFilterItem, options: HistoryOptions): HistoryPick[] {
  if (item.kind === "all") return [];
  if (item.kind === "free") {
    return isPicked(picks, item, options) ? picks.filter(p => p.kind !== "free") : [...picks, { kind: "free" }];
  }
  const others = picks.filter(p => p.kind === "free" || p.programId !== item.programId);
  const program: HistoryPick = { kind: "program", programId: item.programId };
  if (item.kind === "program") return isPicked(picks, item, options) ? others : [...others, program];
  const listed = options.programs.find(o => o.programId === item.programId)?.days ?? [];
  const on = (dayKey: string) => isPicked(picks, { kind: "day", programId: item.programId, key: dayKey }, options);
  const next = listed.filter(d => (d.key === item.key ? !on(d.key) : on(d.key)));
  return next.length === listed.length ? [...others, program] : [...others, ...next.map(d => d.pick)];
}

/** A pick by name: its program's, "Upper Lower · Upper A" for one day of a
 *  program that lists its days, or "Custom workouts" ("Custom workouts ·
 *  Push" for one of their days). */
export function pickLabel(pick: HistoryPick, options: HistoryOptions, programs: SavedProgram[]): string {
  if (pick.kind === "free") {
    return pick.day && pick.dayName ? `${CUSTOM_WORKOUTS_NAME} · ${displayWorkoutName(pick.dayName)}` : CUSTOM_WORKOUTS_NAME;
  }
  const listed = pick.programId ? options.programs.find(o => o.programId === pick.programId) : undefined;
  const programName = listed?.name ?? programs.find(p => p.id === pick.programId)?.name;
  if (pick.kind === "program") return programName ?? "Program";
  const day = listed?.days.find(d => d.key === dayKeyOf(pick));
  if (programName && listed && listed.days.length === 0) return programName;
  const dayName = day?.name ?? displayWorkoutName(pick.dayName ?? "");
  return programName ? `${programName} · ${dayName}` : dayName;
}

/** The filter's button: everything, the one pick, or the first and how many
 *  more. */
export function filterLabel(picks: readonly HistoryPick[], options: HistoryOptions, programs: SavedProgram[]): string {
  if (picks.length === 0) return "All programs";
  const first = pickLabel(picks[0], options, programs);
  return picks.length === 1 ? first : `${first} + ${picks.length - 1} more`;
}

/**
 * What the page starts on, from what opened it: the Progress chart's day (a
 * program's, by its program, slot and name; or one of Custom workouts, by its
 * key), a program, or, from anywhere else, everything.
 */
export function picksFromHistoryParams(p: { dayName?: string; dayId?: string; programId?: string; customDay?: string }): HistoryPick[] {
  if (p.customDay?.trim()) return [{ kind: "free", day: p.customDay, ...(p.dayName ? { dayName: p.dayName } : {}) }];
  if (p.dayName?.trim() || p.dayId?.trim()) {
    return [{ kind: "day", ...(p.programId ? { programId: p.programId } : {}), ...(p.dayId ? { dayId: p.dayId } : {}), ...(p.dayName ? { dayName: p.dayName } : {}) }];
  }
  return p.programId ? [{ kind: "program", programId: p.programId }] : [];
}
