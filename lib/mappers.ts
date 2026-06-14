// Pure conversions between the app's AsyncStorage types and Supabase row shapes.
// All the fiddly bits (date-format conversion, jsonb casting, null<->undefined)
// live here so they can be unit-tested (see scripts/verify-data-layer.ts) and so
// the network layer stays mechanical.
//
// Note on ids: `*ToRow` omits id — the database generates uuids and we read them
// back on insert. `*FromRow` uses the row's uuid as the app object's id, so once
// data lives in Supabase the uuid is the single id everywhere.

import { parseStoredDate, formatStoredDate, toYMD } from "../utils/dates";
import type {
  CompletedExercise,
  CompletedWorkout,
  SavedProgram,
  WorkoutMap,
} from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";
import type {
  CustomExerciseInsert,
  CustomExerciseRow,
  JournalInsert,
  JournalRow,
  ProgramInsert,
  ProgramRow,
  WorkoutInsert,
  WorkoutRow,
} from "./database.types";

// "DD Mon YYYY" -> "YYYY-MM-DD" (null when empty/unparseable; never a Jan-0 date).
function storedToYMD(s: string | null | undefined): string | null {
  const d = parseStoredDate(s);
  return d ? toYMD(d) : null;
}

// "YYYY-MM-DD" -> "DD Mon YYYY" ("" when null/malformed).
function ymdToStored(ymd: string | null): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  return formatStoredDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

// ── programs ────────────────────────────────────────────────────────────────
export function programToRow(p: SavedProgram, userId: string): ProgramInsert {
  return {
    user_id: userId,
    name: p.name,
    total_weeks: p.totalWeeks,
    current_week: p.currentWeek,
    status: p.status,
    start_date: storedToYMD(p.startDate),
    completed_date: storedToYMD(p.completedDate),
    cycle_offset: p.cycleOffset ?? null,
    training_days: p.trainingDays,
    cycle_days: p.cycleDays,
    cycle_pattern: p.cyclePattern,
    workouts: p.workouts as Record<string, unknown>,
    extra_workouts: p.extraWorkouts ?? [],
  };
}

export function programFromRow(r: ProgramRow): SavedProgram {
  return {
    id: r.id,
    name: r.name,
    totalWeeks: r.total_weeks,
    currentWeek: r.current_week,
    status: r.status,
    startDate: ymdToStored(r.start_date),
    completedDate: r.completed_date ? ymdToStored(r.completed_date) : undefined,
    cycleOffset: r.cycle_offset ?? undefined,
    trainingDays: r.training_days,
    cycleDays: r.cycle_days,
    cyclePattern: r.cycle_pattern,
    workouts: r.workouts as unknown as WorkoutMap,
    extraWorkouts: r.extra_workouts,
  };
}

// ── workouts (completed sessions) ─────────────────────────────────────────────
// `programUuid` is resolved by the caller: the program's Supabase uuid, or null
// for a free workout (local programId "" or undefined).
export function workoutToRow(w: CompletedWorkout, userId: string, programUuid: string | null): WorkoutInsert {
  return {
    user_id: userId,
    program_id: programUuid,
    date: w.date,
    completed_at: w.completedAt,
    workout_name: w.workoutName,
    duration_seconds: w.durationSeconds,
    exercises: w.exercises as unknown[],
    session_notes: w.sessionNotes ?? null,
  };
}

export function workoutFromRow(r: WorkoutRow): CompletedWorkout {
  return {
    id: r.id,
    date: r.date,
    completedAt: r.completed_at,
    workoutName: r.workout_name,
    durationSeconds: r.duration_seconds,
    exercises: r.exercises as unknown as CompletedExercise[],
    sessionNotes: r.session_notes ?? undefined,
    programId: r.program_id ?? "",  // null (free / legacy) -> "" free-workout marker
  };
}

// ── journal ───────────────────────────────────────────────────────────────────
export function journalToRow(j: JournalEntry, userId: string): JournalInsert {
  return { user_id: userId, title: j.title, body: j.body, created_at: j.createdAt };
}

export function journalFromRow(r: JournalRow): JournalEntry {
  return { id: r.id, title: r.title, body: r.body, createdAt: r.created_at };
}

// ── custom exercises (no local id — keyed by name in AsyncStorage) ─────────────
export function customToRow(c: CustomExercise, userId: string): CustomExerciseInsert {
  return {
    user_id: userId,
    name: c.name,
    muscles: c.muscles,
    image_uri: c.imageUri ?? null,
    video_uri: c.videoUri ?? null,
    description: c.description ?? null,
    steps: c.steps && c.steps.length > 0 ? c.steps : null,
    muted: c.muted ?? false,
  };
}

export function customFromRow(r: CustomExerciseRow): CustomExercise {
  return {
    name: r.name,
    muscles: r.muscles as CustomExercise["muscles"],
    imageUri: r.image_uri ?? undefined,
    videoUri: r.video_uri ?? undefined,
    description: r.description ?? undefined,
    steps: r.steps && r.steps.length > 0 ? r.steps : undefined,
    muted: r.muted ? true : undefined,
  };
}
