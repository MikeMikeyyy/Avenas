// utils/exerciseHistory.ts
//
// The sessions the Exercise History page (app/exercise-history.tsx) lists for
// one exercise: every session inside the chosen time range that did it, on the
// workout day the Progress chart opened it from, newest first, with the sets
// that were done. Pure, so scripts/verify-training-months.ts can check the page
// against the chart it's opened from.

import type { CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import { programIncludes } from "./progressStats";

export type ExerciseHistoryRow = {
  workoutId: string;
  date: string;          // YYYY-MM-DD
  completedAt: string;   // ISO
  workoutName: string;   // the day's workout label, e.g. "Push"
  programName: string;   // the program's name, or "Free workout"
  sets: CompletedSet[];  // the exercise's done sets in this session, warmups included
};

// Lowercase-trim match used across the codebase for exercise names.
function key(s: string): string {
  return s.trim().toLowerCase();
}

export function exerciseHistoryRows(
  history: CompletedWorkout[],
  programs: SavedProgram[],
  { exerciseName, dayName, dayId, programId, days, today = new Date() }: {
    exerciseName: string;
    /** The workout day the chart was scoped to, by name. */
    dayName?: string;
    /** ...and by slot id, when it has one. */
    dayId?: string;
    /** ...and its program. Every program's days are d0, d1… (normalizeDayIds),
     *  so a slot id alone matched every program's first day: Push Pull Legs'
     *  Push listed Upper Lower's Upper sessions. */
    programId?: string;
    /** The time range: sessions older than `today` less this many days drop. */
    days: number;
    today?: Date;
  },
): ExerciseHistoryRow[] {
  const want = key(exerciseName);
  const wantDay = typeof dayName === "string" && dayName.trim() ? key(dayName) : null;
  // The slot id when we have it. Sessions that recorded one are matched on it
  // (so a renamed day keeps its history, and two same-named days don't pool);
  // sessions without one still fall back to the day name.
  const wantDayId = typeof dayId === "string" && dayId.trim() ? dayId : null;
  // Date cutoff for the active range — sessions older than this are dropped.
  const cutoff = new Date(today);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();

  const wantProgramId = typeof programId === "string" && programId ? programId : null;

  const rows: ExerciseHistoryRow[] = [];
  for (const w of history) {
    // The day's own program only, as the chart reads it (workoutMatchesDay): a
    // free workout ("") belongs to none, and a legacy record (no programId)
    // still goes by its day.
    if (wantProgramId !== null && w.programId !== undefined && w.programId !== wantProgramId) continue;
    if (wantDayId !== null && w.dayId) {
      if (w.dayId !== wantDayId) continue;
    } else if (wantDay !== null && key(w.workoutName) !== wantDay) continue;
    // Filter by date window first (cheaper than walking exercises).
    const [yy, mm, dd] = w.date.split("-").map(Number);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) continue;
    if (new Date(yy, mm - 1, dd).getTime() < cutoffMs) continue;
    // Find the matching exercise inside this workout (case-insensitive trim).
    const ex = w.exercises.find(e => key(e.name) === want);
    if (!ex) continue;
    // Include warmup + working — drop only un-done sets. Warmups render
    // with a neutral chip so the user can still tell them apart.
    const doneSets = ex.sets.filter(s => s.done);
    if (doneSets.length === 0) continue;
    // Resolve the owning program: by stamped id for new records (""/no match
    // → "Free workout"), else the legacy day-name match for old records.
    const owningProgram = w.programId !== undefined
      ? programs.find(p => p.id === w.programId)
      : programs.find(p => programIncludes(p, w.workoutName));
    rows.push({
      workoutId: w.id,
      date: w.date,
      completedAt: w.completedAt,
      workoutName: w.workoutName,
      programName: owningProgram?.name ?? "Free workout",
      sets: doneSets,
    });
  }
  // Newest first.
  rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return rows;
}
