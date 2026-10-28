// utils/exerciseDaySlots.ts
//
// The places on the Progress page's exercise chart, one exercise on one program
// day (components/progress/ExerciseChartPlot.tsx): one for every time the day
// came round in each run of its program, a session of the exercise or a time it
// was missed, each numbered as the day's workout cards number that session.
// The numbers and the runs are read straight off the cards' own tracks
// (utils/sessionTrack.ts buildSessionTracks: the week a session came round in,
// a missed week counted; user decision, 2026-10-22), never worked out again
// here, so the chart's 5 is the card that says "5th session" whatever the
// history holds. Until then the chart counted the sessions done, 1 to n with no
// gaps, and a missed week left it a number behind the cards.
//
// A miss is read as Program Compare reads one (utils/programCompare.ts
// missedDates), on this day's track: the day came round and nothing was done,
// it was trained without the exercise while the exercise was planned, or the
// exercise was swapped out, unless the program did it anyway that day in
// another session. Today's isn't missed yet. Each run counts from 1, as its
// cards do. A session the schedule can't place (a custom workout added to the
// program has no slot) is counted within its run, as its card is.
//
// Under "All programs" the chart is every session of the exercise from any
// program or day instead (exerciseDateSlots), labelled by date.
//
// Pure, so the verify scripts and the training simulation run it.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { ExerciseDataPoint } from "../constants/progress";
import { exerciseIdentity, type ExerciseRef } from "./exerciseNames";
import { sessionProgramName } from "./exerciseHistory";
import { plannedIn, type LiftSlot } from "./programCompare";
import { displayWorkoutName } from "./programDays";
import type { DayTrack, SessionTracks } from "./sessionTrack";

/** One place on the chart: a session of the exercise or a miss (LiftSlot),
 *  with its session number and its run. */
export type ChartSlot = LiftSlot & {
  /** The session number its card reads, from 1 in each run. Under All
   *  programs (exerciseDateSlots), its place among the exercise's sessions. */
  number: number;
  /** Which run it's in, from 1, when the program has had more than one; null
   *  otherwise. */
  run: number | null;
  /** Under All programs: the workout and program the session was ("Push ·
   *  Push Pull Legs"), which its pop-up says. */
  from?: string;
};

const dateOf = (s: LiftSlot): string => s.point?.date ?? s.missed ?? "";

/**
 * The chart's places, oldest first: each run of the day's track in session
 * order, the sessions the schedule couldn't place counted among them by date.
 * `points` are the chart's sessions (this exercise on this day, oldest first),
 * `programPoints` the exercise in every session of the program, which says
 * whether a day it came round on had it done anyway in another session, and
 * `tracks` what the workout cards read (buildSessionTracks over the same
 * history, the same day).
 */
export function exerciseDaySlots({ exercise, points, programPoints, history, tracks, todayYMD }: {
  exercise: string | ExerciseRef;
  points: readonly ExerciseDataPoint[];
  programPoints: readonly ExerciseDataPoint[];
  history: readonly CompletedWorkout[];
  tracks: SessionTracks;
  todayYMD: string;
}): ChartSlot[] {
  const key = exerciseIdentity(typeof exercise === "string" ? { name: exercise } : exercise);
  const byId = new Map(history.map(w => [w.id, w]));
  const doneOn = new Set(programPoints.map(p => p.date));

  // A group per run of the track, and per run, what it couldn't place.
  const groups = new Map<DayTrack | string, ExerciseDataPoint[]>();
  for (const p of points) {
    const key = tracks.trackById[p.workoutId] ?? `unplaced:${tracks.runOfById[p.workoutId]?.run ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  // The run's name, from 1, once the program has had more than one.
  const runLabel = (of: { run: number; runs: number } | undefined): number | null =>
    of && of.runs > 1 ? of.run + 1 : null;

  const blocks: ChartSlot[][] = [];
  for (const [track, mine] of groups) {
    if (typeof track === "string") {
      // Counted within their run, as their cards are.
      blocks.push(mine.map((point, i) => ({
        point,
        number: tracks.numberById[point.workoutId] ?? i + 1,
        run: runLabel(tracks.runOfById[point.workoutId]),
      })));
      continue;
    }
    const run = runLabel(track);
    const slots: ChartSlot[] = mine.map(point => ({ point, number: track.numberById[point.workoutId], run }));
    const charted = new Set(mine.map(p => p.workoutId));
    // Which of the day's sessions filled each time it came round.
    const filledBy = new Map<number, CompletedWorkout[]>();
    for (const [id, n] of Object.entries(track.numberById)) {
      const w = byId.get(id);
      if (!w) continue;
      const list = filledBy.get(n);
      if (list) list.push(w);
      else filledBy.set(n, [w]);
    }
    for (let i = 0; i < track.occurrences; i++) {
      const date = track.dates[i];
      if (date >= todayYMD) continue;
      const there = filledBy.get(i + 1) ?? [];
      if (there.some(w => charted.has(w.id))) continue;
      if (there.length > 0 && !there.some(w => plannedIn(w, key))) continue;
      if (doneOn.has(date)) continue;
      slots.push({ missed: date, number: i + 1, run });
    }
    blocks.push(slots.sort((a, b) => a.number - b.number || dateOf(a).localeCompare(dateOf(b))));
  }
  // Oldest run first.
  blocks.sort((a, b) => dateOf(a[0]).localeCompare(dateOf(b[0])));
  return blocks.flat();
}

/**
 * The chart's places under "All programs" (user request, 2026-10-26): every
 * session of the exercise from any program, day or custom workout, oldest
 * first, one place each however long since the last, so a month off leaves no
 * gap. The chart labels them by date (utils/exerciseChartLayout.ts
 * dateAxisLabels): a session number only means something on one day's
 * schedule, and with no one schedule nothing is missed either. Each says the
 * workout and program it was, as its Exercise History row does.
 */
export function exerciseDateSlots(
  points: readonly ExerciseDataPoint[],
  history: readonly CompletedWorkout[],
  programs: readonly SavedProgram[],
): ChartSlot[] {
  const byId = new Map(history.map(w => [w.id, w]));
  return points.map((point, i) => {
    const w = byId.get(point.workoutId);
    const from = w ? `${displayWorkoutName(w.workoutName)} · ${sessionProgramName(w, programs)}` : undefined;
    return { point, number: i + 1, run: null, ...(from ? { from } : {}) };
  });
}
