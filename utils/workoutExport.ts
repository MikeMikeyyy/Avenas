// utils/workoutExport.ts
//
// Every logged workout as a CSV file (Settings > Import & Export): one row per
// set, as Hevy and Strong export theirs, so it opens as a table in Numbers,
// Excel or Google Sheets, and reads back into Avenas (utils/workoutImport.ts).
// Oldest first. Weights in the person's unit, named in the header ("weight_kg"
// or "weight_lbs"). A hold's time goes under `seconds`, not `reps`. A workout
// with no sets still gets a row, so it isn't missing from the file.
//
// Pure, so scripts/verify-import.ts covers it.

import { toCsv } from "./csv";
import { toYMD } from "./dates";
import { formatWeightForDisplay } from "./units";
import type { CompletedWorkout, SavedProgram } from "../constants/programs";

export function exportColumns(isKg: boolean): string[] {
  return [
    "date", "workout", "program", "start_time", "end_time", "exercise", "set", "set_type",
    isKg ? "weight_kg" : "weight_lbs", "reps", "seconds", "done", "exercise_notes", "workout_notes",
  ];
}

/** "2026-10-20 18:02", local. */
function clock(d: Date): string {
  return `${toYMD(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The file's text. `programs` names each workout's program; a free workout's
 *  is blank. */
export function workoutsToCsv(
  history: readonly CompletedWorkout[],
  programs: readonly Pick<SavedProgram, "id" | "name">[],
  isKg: boolean,
): string {
  const programName = new Map(programs.map(p => [p.id, p.name]));
  const rows: (string | number)[][] = [exportColumns(isKg)];
  const ordered = [...history].sort((a, b) => a.date.localeCompare(b.date) || a.completedAt.localeCompare(b.completedAt));
  for (const w of ordered) {
    const end = new Date(w.completedAt);
    const readable = !Number.isNaN(end.getTime());
    const start = readable ? new Date(end.getTime() - Math.max(0, w.durationSeconds || 0) * 1000) : null;
    const head = [
      w.date,
      w.workoutName,
      (w.programId && programName.get(w.programId)) || "",
      start ? clock(start) : "",
      readable ? clock(end) : "",
    ];
    const notes = w.sessionNotes ?? "";
    let wrote = false;
    for (const ex of w.exercises) {
      ex.sets.forEach((s, i) => {
        rows.push([
          ...head,
          ex.name,
          i + 1,
          s.type === "warmup" ? "warmup" : "working",
          formatWeightForDisplay(s.weight ?? "", isKg),
          ex.isIsometric ? "" : s.reps,
          ex.isIsometric ? s.reps : "",
          s.done ? "yes" : "no",
          ex.notes ?? "",
          notes,
        ]);
        wrote = true;
      });
    }
    if (!wrote) rows.push([...head, "", "", "", "", "", "", "", "", notes]);
  }
  return toCsv(rows);
}

/** "avenas-workouts-2026-10-23.csv" */
export function exportFileName(now: Date = new Date()): string {
  return `avenas-workouts-${toYMD(now)}.csv`;
}
