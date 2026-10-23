// Pure conversions between the app's AsyncStorage types and Supabase row shapes.
// All the fiddly bits (date-format conversion, jsonb casting, null<->undefined)
// live here so they can be unit-tested (see scripts/verify-data-layer.ts) and so
// the network layer stays mechanical.
//
// Note on ids: `*ToRow` omits id — the database generates uuids, and every
// backup mints them afresh. A program's own id travels as `local_id` (migration
// 0044) and comes back as its id, so a program keeps one id for life; read a
// backup through snapshotFromRows, which also points each workout at its program
// by that id. A custom exercise's own id travels the same way (0048). Workouts
// and journal entries take the row's uuid.

import { parseStoredDate, formatStoredDate, toYMD } from "../utils/dates";
import type {
  CompletedExercise,
  CompletedWorkout,
  PlannedExercise,
  ProgramRun,
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
    // The program's own id, given back on a restore (snapshotFromRows).
    local_id: p.id,
    share_origin: p.shareOrigin ?? null,
    name: p.name,
    total_weeks: p.totalWeeks,
    current_week: p.currentWeek,
    status: p.status,
    start_date: storedToYMD(p.startDate),
    completed_date: storedToYMD(p.completedDate),
    cycle_offset: p.cycleOffset ?? null,
    // Already "YYYY-MM-DD" on both sides, unlike start_date/completed_date which
    // convert from the local stored format — no translation needed.
    paused_at: p.pausedAt ?? null,
    archived_at: p.archivedAt ?? null,
    training_days: p.trainingDays,
    cycle_days: p.cycleDays,
    cycle_pattern: p.cyclePattern,
    day_ids: p.dayIds ?? [],
    skipped_dates: p.skippedDates ?? [],
    pushed_dates: p.pushedDates ?? [],
    pulled_dates: p.pulledDates ?? [],
    holds: p.holds && p.holds.length > 0 ? p.holds : null,
    runs: p.runs && p.runs.length > 0 ? p.runs : null,
    workouts: p.workouts as Record<string, unknown>,
    extra_workouts: p.extraWorkouts ?? [],
  };
}

/** One program row as the app holds it. Its id is the program's own
 *  (local_id), or the row's on a row from before 0044. Read a whole backup
 *  through snapshotFromRows, which points the workouts at these ids. */
export function programFromRow(r: ProgramRow): SavedProgram {
  return {
    id: r.local_id || r.id,
    ...(r.share_origin ? { shareOrigin: r.share_origin } : {}),
    name: r.name,
    totalWeeks: r.total_weeks,
    currentWeek: r.current_week,
    status: r.status,
    startDate: ymdToStored(r.start_date),
    completedDate: r.completed_date ? ymdToStored(r.completed_date) : undefined,
    cycleOffset: r.cycle_offset ?? undefined,
    pausedAt: r.paused_at ?? undefined,
    // Absent on a row read from a server without 0037: not archived.
    archivedAt: r.archived_at ?? undefined,
    trainingDays: r.training_days,
    cycleDays: r.cycle_days,
    cyclePattern: r.cycle_pattern,
    // Empty array = a row written before the column existed; leave it undefined
    // so the client's positional fallback applies rather than a bogus [].
    dayIds: r.day_ids && r.day_ids.length > 0 ? r.day_ids : undefined,
    // Same empty-means-absent treatment: a pre-0025 row and a program with
    // nothing skipped are the same thing, and undefined keeps the stored
    // program free of an empty array nobody needs.
    skippedDates: r.skipped_dates && r.skipped_dates.length > 0 ? r.skipped_dates : undefined,
    pushedDates: r.pushed_dates && r.pushed_dates.length > 0 ? r.pushed_dates : undefined,
    pulledDates: r.pulled_dates && r.pulled_dates.length > 0 ? r.pulled_dates : undefined,
    // Absent on a row from a server without 0043: no holds recorded, which is
    // how every program read before it.
    holds: Array.isArray(r.holds) && r.holds.length > 0 ? r.holds : undefined,
    // Absent on a row from a server without 0047: no earlier runs recorded.
    ...(Array.isArray(r.runs) && r.runs.length > 0 ? { runs: r.runs as ProgramRun[] } : {}),
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
    // undefined (legacy, inferred by name) and "" (free) both leave program_id
    // null, so the difference has to travel on its own (migration 0033).
    program_unknown: w.programId === undefined,
    date: w.date,
    completed_at: w.completedAt,
    workout_name: w.workoutName,
    day_id: w.dayId ?? null,
    duration_seconds: w.durationSeconds,
    exercises: w.exercises as unknown[],
    session_notes: w.sessionNotes ?? null,
    plan: w.plan ?? null,
    program_name: w.programName ?? null,
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
    // null program_id: a legacy record stays legacy (undefined, so it's still
    // attributed by name) and anything else is a free workout (""). A row
    // written before migration 0033 has no flag and reads as free, as it always
    // did.
    programId: r.program_id ?? (r.program_unknown ? undefined : ""),
    dayId: r.day_id ?? undefined,
    // Absent on a row from before 0046 (and from a server without it).
    ...(Array.isArray(r.plan) ? { plan: r.plan as PlannedExercise[] } : {}),
    // Absent unless its program was deleted (0052).
    ...(r.program_name ? { programName: r.program_name } : {}),
  };
}

/**
 * A backup read back as the app holds it: each program under its own id and
 * each workout pointing at its program by that id (a workout row points at the
 * program ROW, whose uuid every backup mints afresh). Used by everything that
 * reads one: the owner's restore (lib/cloud.ts) and a trainer's read of a client
 * (lib/clientTraining.ts).
 *
 * Before 0044 the row uuids were the ids, so a restore renamed every program:
 * its next send went out under a new id, the client's phone took it for another
 * program, and the client ended up with two copies and their sessions on the
 * first (user report, 2026-10-13).
 */
export function snapshotFromRows(
  programRows: ProgramRow[],
  workoutRows: WorkoutRow[],
): { programs: SavedProgram[]; workouts: CompletedWorkout[] } {
  const idOfRow = new Map<string, string>();
  const taken = new Set<string>();
  const programs = programRows.map(r => {
    const p = programFromRow(r);
    // Two rows with one id isn't something the app writes; the second keeps
    // its row's id rather than be mistaken for the first.
    const id = taken.has(p.id) ? r.id : p.id;
    taken.add(id);
    idOfRow.set(r.id, id);
    return id === p.id ? p : { ...p, id };
  });
  return {
    programs,
    workouts: workoutRows.map(r => {
      const w = workoutFromRow(r);
      const programId = r.program_id ? idOfRow.get(r.program_id) : undefined;
      return programId ? { ...w, programId } : w;
    }),
  };
}

// ── replace_user_data RPC payload (atomic full-snapshot push) ─────────────────
// Mirrors workoutToRow but swaps program_id (a uuid we don't have client-side)
// for program_index — the owning program's position in the programs array. The
// server (migration 0004) resolves that index to the program's freshly-minted
// uuid. null = free / legacy workout (no program).
export type WorkoutReplaceRow = Omit<WorkoutInsert, "program_id"> & { program_index: number | null };

export type ReplaceUserDataPayload = {
  p_programs: ProgramInsert[];
  p_workouts: WorkoutReplaceRow[];
  p_journal: JournalInsert[];
  p_custom: CustomExerciseInsert[];
};

/**
 * Build the jsonb payload for the replace_user_data RPC from the local snapshot.
 * Pure (no network) so it can be unit-tested. user_id fields are carried for
 * faithfulness but the server ignores them and writes auth.uid() instead.
 */
export function toReplaceUserDataPayload(
  programs: SavedProgram[],
  history: CompletedWorkout[],
  journal: JournalEntry[],
  custom: CustomExercise[],
  userId: string,
): ReplaceUserDataPayload {
  const indexById = new Map<string, number>();
  programs.forEach((p, i) => indexById.set(p.id, i));
  return {
    p_programs: programs.map((p) => programToRow(p, userId)),
    p_workouts: history.map((w) => {
      const { program_id: _ignored, ...rest } = workoutToRow(w, userId, null);
      const program_index = w.programId && indexById.has(w.programId) ? indexById.get(w.programId)! : null;
      return { ...rest, program_index };
    }),
    p_journal: journal.map((j) => journalToRow(j, userId)),
    p_custom: custom.map((c) => customToRow(c, userId)),
  };
}

// ── journal ───────────────────────────────────────────────────────────────────
export function journalToRow(j: JournalEntry, userId: string): JournalInsert {
  return { user_id: userId, title: j.title, body: j.body, created_at: j.createdAt };
}

export function journalFromRow(r: JournalRow): JournalEntry {
  return { id: r.id, title: r.title, body: r.body, createdAt: r.created_at };
}

// ── custom exercises ──────────────────────────────────────────────────────────
// Its own id travels as `local_id` (migration 0048), like a program's: one made
// before ids has none and is known by its name. A deleted one travels too,
// marked, since the sessions logged with it are still read with it.
export function customToRow(c: CustomExercise, userId: string): CustomExerciseInsert {
  return {
    user_id: userId,
    local_id: c.id ?? null,
    name: c.name,
    muscles: c.muscles,
    image_uri: c.imageUri ?? null,
    video_uri: c.videoUri ?? null,
    description: c.description ?? null,
    steps: c.steps && c.steps.length > 0 ? c.steps : null,
    muted: c.muted ?? false,
    deleted_at: c.deletedAt ?? null,
  };
}

export function customFromRow(r: CustomExerciseRow): CustomExercise {
  return {
    ...(r.local_id ? { id: r.local_id } : {}),
    name: r.name,
    muscles: r.muscles as CustomExercise["muscles"],
    imageUri: r.image_uri ?? undefined,
    videoUri: r.video_uri ?? undefined,
    description: r.description ?? undefined,
    steps: r.steps && r.steps.length > 0 ? r.steps : undefined,
    muted: r.muted ? true : undefined,
    ...(r.deleted_at ? { deletedAt: r.deleted_at.slice(0, 10) } : {}),
  };
}
