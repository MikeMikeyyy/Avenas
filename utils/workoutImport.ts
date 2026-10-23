// utils/workoutImport.ts
//
// Another app's workout history, read from its CSV export, as Avenas sessions
// (Settings > Import & Export, user request 2026-10-23). Hevy and Strong export
// one row per set; so does Avenas (utils/workoutExport.ts), whose file reads
// back the same way. Which file it is comes from its header row.
//
//   Hevy    title, start_time, end_time, description, exercise_title,
//           superset_id, exercise_notes, set_index, set_type, weight_kg or
//           weight_lbs, reps, distance_km or distance_miles, duration_seconds,
//           rpe. Times "22 Dec 2025, 08:00", month names in the app's language:
//           English is read, and a file in another language says to switch.
//   Strong  Date, Workout Name, Duration, Exercise Name, Set Order, Weight,
//           Reps, Distance, Seconds, Notes, Workout Notes, RPE: dates
//           "2020-12-30 18:51:52", durations "1h 5m", weights in whatever unit
//           the app was set to (the file doesn't say, so the review asks). Its
//           newer export: semicolons, "Workout #", "Duration (sec)", "Weight
//           (kg)", "Distance (meters)". A Set Order of W is a warm-up, a number
//           or D or F (drop, failure) a working set, anything else (a rest
//           timer) no set at all.
//   Avenas  the columns workoutExport writes.
//
// What comes over, as a session logged in the Journal has it: the workout's
// name, day, start, finish and notes; each exercise in order with its notes;
// each set as a warm-up or working set with its weight (stored in kg) and reps.
// An exercise done for time with no reps (a plank) comes in as a hold, its
// seconds as its reps. A distance goes into the exercise's notes, since a set
// has no place for one. RPE, supersets and the drop and failure labels don't
// come over. Every imported session is a free workout: no program.
//
// A day that already has a workout in Avenas is left out whole (user
// decision, 2026-10-23), which also makes importing a file twice add nothing.
//
// Pure, so scripts/verify-import.ts covers it.

import { parseCsv } from "./csv";
import { MONTH_FULL, MONTH_NAMES, toYMD } from "./dates";
import { parseWeightToKg, trimNumber, type WeightUnit } from "./units";
import type { CompletedExercise, CompletedSet, CompletedWorkout } from "../constants/programs";

export type ImportSource = "hevy" | "strong" | "avenas";

export const SOURCE_NAMES: Record<ImportSource, string> = { hevy: "Hevy", strong: "Strong", avenas: "Avenas" };

/** One set as the file has it, numbers in the file's own units. */
export type ImportedSet = {
  warmup: boolean;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
  done: boolean;
};

export type ImportedExercise = { name: string; notes: string; sets: ImportedSet[] };

export type ImportedWorkout = {
  title: string;
  /** "YYYY-MM-DD": the day it was done on, as the Journal shows it. */
  date: string;
  start: Date;
  end: Date;
  notes: string;
  exercises: ImportedExercise[];
};

export type ParsedImport = {
  source: ImportSource;
  /** The unit the file's weights are in, or null when it doesn't say (Strong's
   *  older export): the review asks. */
  weightUnit: WeightUnit | null;
  /** How the file's distances are labelled in a note ("km", "mi", "m"), or ""
   *  when it doesn't say. */
  distanceUnit: string;
  /** In the file's order, each with at least one set. */
  workouts: ImportedWorkout[];
  /** Rows that weren't sets: no date that could be read, no exercise, a rest
   *  timer, or nothing in them. */
  skippedRows: number;
  /** Workouts dated after today, left out. */
  futureWorkouts: number;
};

export type ReadResult = { ok: true; data: ParsedImport } | { ok: false; error: string };

export const NOT_AN_EXPORT =
  "This doesn't look like a workout export from Hevy or Strong. In Hevy, go to Settings, Export & Import Data, Export Data. In Strong, go to Settings, Export Data. Then choose the CSV file it makes.";
export const DATES_UNREADABLE =
  "Avenas couldn't read the dates in this file. If Hevy or Strong is set to a language other than English, switch it to English, export again and choose the new file.";
export const NOTHING_TO_IMPORT = "There are no workouts with sets in this file.";

// ─── Reading a time ──────────────────────────────────────────────────────────

const MONTH_INDEX = new Map<string, number>();
MONTH_NAMES.forEach((m, i) => MONTH_INDEX.set(m.toLowerCase(), i));
MONTH_FULL.forEach((m, i) => MONTH_INDEX.set(m.toLowerCase(), i));
MONTH_INDEX.set("sept", 8);

/** A local time from its parts, or null when they aren't a real one. */
function localTime(y: number, mo: number, d: number, h: number, mi: number, s: number, ampm?: string): Date | null {
  let hour = h;
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || hour > 23 || mi > 59 || s > 59 || y < 1900) return null;
  const at = new Date(y, mo, d, hour, mi, s);
  return at.getDate() === d && at.getMonth() === mo ? at : null;
}

/**
 * A time as the exports write one, as the phone's local time:
 * "2020-12-30 18:51:52" (Strong, Avenas), "22 Dec 2025, 08:00" (Hevy), "Dec 22,
 * 2025, 8:00 PM", or a date alone. Null when it's none of those.
 */
export function parseExportTime(text: string): Date | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?)?\s*(z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    // With a zone it names one instant; the clock reading there is this phone's.
    if (m[8]) {
      const at = new Date(s.replace(" ", "T"));
      return Number.isNaN(at.getTime()) ? null : at;
    }
    return localTime(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]);
  }
  m = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i.exec(s);
  if (m) {
    const mo = MONTH_INDEX.get(m[2].toLowerCase());
    return mo === undefined ? null : localTime(+m[3], mo, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]);
  }
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i.exec(s);
  if (m) {
    const mo = MONTH_INDEX.get(m[1].toLowerCase());
    return mo === undefined ? null : localTime(+m[3], mo, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7]);
  }
  return null;
}

/** Strong's "1h 5m", "45m", "3h", "30s", or "1:05:00", in seconds; 0 when none. */
export function parseDurationText(text: string): number {
  const s = text.trim().toLowerCase();
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) return clock[3] !== undefined ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2];
  const part = (unit: string) => {
    const m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`).exec(s);
    return m ? parseFloat(m[1]) : 0;
  };
  const total = part("h") * 3600 + part("m(?!s)") * 60 + part("s");
  if (total > 0) return Math.round(total);
  const plain = parseFloat(s);
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain) : 0;
}

/** A number in a cell: "82.5", "82,5" (a comma for a decimal point), or null
 *  when it's blank or not a number. */
function num(text: string | undefined): number | null {
  if (text === undefined) return null;
  const s = text.trim().replace(/^(-?\d+),(\d+)$/, "$1.$2");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ─── Reading the file ────────────────────────────────────────────────────────

type Columns = (...names: string[]) => (row: string[]) => string | undefined;

/** A column by any of its header names (case and spacing aside), as a reader
 *  of that cell in a row; a reader that always gives undefined when the file
 *  has none of them. */
function columnsOf(header: string[]): Columns {
  const at = new Map<string, number>();
  header.forEach((h, i) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, " ");
    if (!at.has(k)) at.set(k, i);
  });
  return (...names) => {
    const i = names.map(n => at.get(n)).find(x => x !== undefined);
    return i === undefined ? () => undefined : row => row[i];
  };
}

type Row = {
  workoutKey: string;
  title: string;
  /** The day as the file gives it, when it does (an Avenas file); else the
   *  start's own day. */
  date?: string;
  start: Date | null;
  end: Date | null;
  /** Seconds from the start, when the file gives a length rather than an end. */
  duration: number | null;
  workoutNotes: string;
  exercise: string;
  /** Rows with the same group belong to one exercise however they're spread
   *  out (a Hevy superset). Empty: the exercise is the run of rows in a row. */
  group: string;
  /** The set's number within the exercise, when the file numbers them. */
  order: number | null;
  exerciseNotes: string;
  set: ImportedSet | null;
};

function hevyRows(header: string[], body: string[][]): { rows: Row[]; weightUnit: WeightUnit; distanceUnit: string } {
  const col = columnsOf(header);
  const title = col("title"), start = col("start_time"), end = col("end_time"), description = col("description");
  const exercise = col("exercise_title"), superset = col("superset_id"), notes = col("exercise_notes");
  const index = col("set_index"), type = col("set_type"), reps = col("reps"), seconds = col("duration_seconds");
  const kg = header.some(h => h.trim().toLowerCase() === "weight_kg");
  const weight = col("weight_kg", "weight_lbs", "weight_lb");
  const km = header.some(h => h.trim().toLowerCase() === "distance_km");
  const distance = col("distance_km", "distance_miles", "distance_mi");
  const rows = body.map((r): Row => ({
    workoutKey: `${title(r) ?? ""}\u0000${start(r) ?? ""}\u0000${end(r) ?? ""}`,
    title: title(r) ?? "",
    start: parseExportTime(start(r) ?? ""),
    end: parseExportTime(end(r) ?? ""),
    duration: null,
    workoutNotes: description(r) ?? "",
    exercise: (exercise(r) ?? "").trim(),
    group: (superset(r) ?? "").trim(),
    order: num(index(r)),
    exerciseNotes: notes(r) ?? "",
    set: {
      warmup: (type(r) ?? "").trim().toLowerCase() === "warmup",
      weight: num(weight(r)),
      reps: num(reps(r)),
      seconds: num(seconds(r)),
      distance: num(distance(r)),
      done: true,
    },
  }));
  return { rows, weightUnit: kg ? "kg" : "lb", distanceUnit: km ? "km" : "mi" };
}

function strongRows(header: string[], body: string[][]): { rows: Row[]; weightUnit: WeightUnit | null; distanceUnit: string } {
  const col = columnsOf(header);
  const lower = header.map(h => h.trim().toLowerCase().replace(/\s+/g, " "));
  const number = col("workout #"), date = col("date"), name = col("workout name");
  const durationSec = col("duration (sec)", "duration (seconds)"), durationText = col("duration", "workout duration");
  const exercise = col("exercise name"), order = col("set order"), reps = col("reps"), seconds = col("seconds");
  const notes = col("notes"), workoutNotes = col("workout notes");
  const weight = col("weight (kg)", "weight (lbs)", "weight (lb)", "weight");
  const rowUnit = col("weight unit");
  const distance = col("distance (meters)", "distance (m)", "distance (km)", "distance (miles)", "distance");
  const headerUnit: WeightUnit | null =
    lower.includes("weight (kg)") ? "kg" : lower.includes("weight (lbs)") || lower.includes("weight (lb)") ? "lb" : null;
  // A unit on every row (some versions): each weight goes to kg here.
  const perRow = lower.includes("weight unit");
  const distanceUnit =
    lower.some(h => h === "distance (meters)" || h === "distance (m)") ? "m"
    : lower.includes("distance (km)") ? "km"
    : lower.includes("distance (miles)") ? "mi"
    : "";
  const rows = body.map((r): Row => {
    const setOrder = (order(r) ?? "").trim();
    const isSet = /^\d+$/.test(setOrder) || /^[wdf]$/i.test(setOrder);
    let w = num(weight(r));
    if (perRow && w !== null && /^lb/i.test((rowUnit(r) ?? "").trim())) w = Number(parseWeightToKg(String(w), false));
    const start = parseExportTime(date(r) ?? "");
    const secs = num(durationSec(r));
    return {
      workoutKey: (number(r) ?? "").trim() ? `#${number(r)!.trim()}` : `${date(r) ?? ""}\u0000${name(r) ?? ""}`,
      title: name(r) ?? "",
      start,
      end: null,
      duration: secs !== null ? secs : parseDurationText(durationText(r) ?? ""),
      workoutNotes: workoutNotes(r) ?? "",
      exercise: (exercise(r) ?? "").trim(),
      group: "",
      order: /^\d+$/.test(setOrder) ? Number(setOrder) : null,
      exerciseNotes: notes(r) ?? "",
      set: isSet
        ? {
            warmup: /^w$/i.test(setOrder),
            weight: w,
            reps: num(reps(r)),
            seconds: num(seconds(r)),
            distance: num(distance(r)),
            done: true,
          }
        : null,
    };
  });
  return { rows, weightUnit: perRow ? "kg" : headerUnit, distanceUnit };
}

function avenasRows(header: string[], body: string[][]): { rows: Row[]; weightUnit: WeightUnit; distanceUnit: string } {
  const col = columnsOf(header);
  const date = col("date"), workout = col("workout"), start = col("start_time"), end = col("end_time");
  const exercise = col("exercise"), set = col("set"), type = col("set_type"), reps = col("reps"), seconds = col("seconds");
  const done = col("done"), notes = col("exercise_notes"), workoutNotes = col("workout_notes");
  const kg = header.some(h => h.trim().toLowerCase() === "weight_kg");
  const weight = col("weight_kg", "weight_lbs");
  const rows = body.map((r): Row => ({
    workoutKey: `${date(r) ?? ""}\u0000${start(r) ?? ""}\u0000${end(r) ?? ""}\u0000${workout(r) ?? ""}`,
    title: workout(r) ?? "",
    date: /^\d{4}-\d{2}-\d{2}$/.test((date(r) ?? "").trim()) ? date(r)!.trim() : undefined,
    start: parseExportTime(start(r) ?? "") ?? parseExportTime(date(r) ?? ""),
    end: parseExportTime(end(r) ?? ""),
    duration: null,
    workoutNotes: workoutNotes(r) ?? "",
    exercise: (exercise(r) ?? "").trim(),
    group: "",
    order: num(set(r)),
    exerciseNotes: notes(r) ?? "",
    set: {
      warmup: (type(r) ?? "").trim().toLowerCase() === "warmup",
      weight: num(weight(r)),
      reps: num(reps(r)),
      seconds: num(seconds(r)),
      distance: null,
      done: (done(r) ?? "").trim().toLowerCase() !== "no",
    },
  }));
  return { rows, weightUnit: kg ? "kg" : "lb", distanceUnit: "" };
}

/** Which app made a file, from its header row. */
function sourceOf(header: string[]): ImportSource | null {
  const has = (name: string) => header.some(h => h.trim().toLowerCase().replace(/\s+/g, " ") === name);
  if (has("exercise_title") && has("start_time")) return "hevy";
  if (has("exercise name") && has("set order") && has("date")) return "strong";
  if (has("exercise") && has("set_type") && has("workout") && has("date")) return "avenas";
  return null;
}

const positive = (n: number | null): n is number => n !== null && n > 0;
const hasAnything = (s: ImportedSet) =>
  positive(s.weight) || positive(s.reps) || positive(s.seconds) || positive(s.distance);

/** A workout as its rows come in: each exercise's superset and the notes
 *  its rows have had (both parallel to `exercises`), and the last row's
 *  exercise. */
type Building = ImportedWorkout & {
  groups: string[];
  notes_: string[][];
  last?: { name: string; group: string; order: number | null };
};

/**
 * The workouts in an export's text, or why there are none. `now` is when "after
 * today" is reckoned from.
 */
export function readWorkoutCsv(text: string, now: Date = new Date()): ReadResult {
  const table = parseCsv(text);
  const header = table[0];
  const source = header ? sourceOf(header) : null;
  if (!header || !source) return { ok: false, error: NOT_AN_EXPORT };
  const body = table.slice(1);
  const read = source === "hevy" ? hevyRows(header, body) : source === "strong" ? strongRows(header, body) : avenasRows(header, body);

  const today = toYMD(now);
  const workouts = new Map<string, Building>();
  let skippedRows = 0;
  let dated = 0;
  for (const row of read.rows) {
    if (!row.start) { skippedRows++; continue; }
    dated++;
    if (!row.exercise || !row.set || !hasAnything(row.set)) { skippedRows++; continue; }
    let w = workouts.get(row.workoutKey);
    if (!w) {
      const end = row.end ?? new Date(row.start.getTime() + (row.duration ?? 0) * 1000);
      w = {
        title: row.title.trim(),
        date: row.date ?? toYMD(row.start),
        start: row.start,
        end: end.getTime() >= row.start.getTime() ? end : row.start,
        notes: row.workoutNotes.trim(),
        exercises: [],
        groups: [],
        notes_: [],
      };
      workouts.set(row.workoutKey, w);
    }
    if (!w.notes && row.workoutNotes.trim()) w.notes = row.workoutNotes.trim();
    // A superset's exercise is one exercise wherever its rows are; otherwise an
    // exercise is the run of rows naming it, and a set numbered no higher than
    // the one before starts it again (the same exercise done twice).
    const { last, groups } = w;
    let at = -1;
    if (row.group) {
      at = w.exercises.findIndex((e, i) => groups[i] === row.group && e.name === row.exercise);
    } else if (last && last.name === row.exercise && !last.group
      && !(row.order !== null && last.order !== null && row.order <= last.order)) {
      at = w.exercises.length - 1;
    }
    if (at < 0) {
      at = w.exercises.push({ name: row.exercise, notes: "", sets: [] }) - 1;
      groups.push(row.group);
      w.notes_.push([]);
    }
    // Hevy repeats an exercise's note on each of its rows; Strong's are each
    // set's own. Each different one once.
    const note = row.exerciseNotes.trim();
    if (note && !w.notes_[at].includes(note)) w.notes_[at].push(note);
    w.exercises[at].sets.push(row.set);
    w.last = { name: row.exercise, group: row.group, order: row.order };
  }

  if (read.rows.length > 0 && dated === 0) return { ok: false, error: DATES_UNREADABLE };
  let futureWorkouts = 0;
  const kept: ImportedWorkout[] = [];
  for (const w of workouts.values()) {
    if (w.date > today) { futureWorkouts++; continue; }
    const exercises = w.exercises.map((e, i) => ({ ...e, notes: w.notes_[i].join("\n") }));
    kept.push({ title: w.title, date: w.date, start: w.start, end: w.end, notes: w.notes, exercises });
  }
  if (kept.length === 0) return { ok: false, error: NOTHING_TO_IMPORT };
  return {
    ok: true,
    data: { source, weightUnit: read.weightUnit, distanceUnit: read.distanceUnit, workouts: kept, skippedRows, futureWorkouts },
  };
}

// ─── What the review shows ───────────────────────────────────────────────────

/** Each exercise the file names, with how many sets it has, most sets first. */
export function exercisesIn(parsed: ParsedImport): { name: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const w of parsed.workouts) for (const e of w.exercises) counts.set(e.name, (counts.get(e.name) ?? 0) + e.sets.length);
  return [...counts].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}

// ─── Into Avenas sessions ────────────────────────────────────────────────────

/** What an exercise from the file becomes: an Avenas exercise, or null to keep
 *  its own name. */
export type ExerciseChoice = { name: string; customId?: string } | null;

export type ImportPlan = {
  /** The sessions to add, newest first. */
  workouts: CompletedWorkout[];
  /** Workouts left out because their day already has one in Avenas. */
  skippedDays: number;
  sets: number;
};

/** A distance for a note: "5 km", "2.4 mi", "400 m". */
function distanceText(n: number, unit: string): string {
  return unit ? `${trimNumber(n, 2)} ${unit}` : trimNumber(n, 2);
}

/**
 * The file's workouts as sessions to save. `weightUnit` is the file's (or what
 * the person said it is); `choices` what each exercise name becomes;
 * `history` what's already logged, whose days are left out; `now` makes the
 * ids.
 */
export function planImport(
  parsed: ParsedImport,
  opts: {
    weightUnit: WeightUnit;
    choices: Record<string, ExerciseChoice>;
    history: readonly Pick<CompletedWorkout, "date">[];
    now?: number;
  },
): ImportPlan {
  const taken = new Set(opts.history.map(w => w.date));
  const isKg = opts.weightUnit === "kg";
  const stamp = opts.now ?? Date.now();
  const workouts: CompletedWorkout[] = [];
  let skippedDays = 0;
  let sets = 0;
  parsed.workouts.forEach((w, i) => {
    if (taken.has(w.date)) { skippedDays++; return; }
    const exercises: CompletedExercise[] = [];
    for (const e of w.exercises) {
      const kept = e.sets.filter(hasAnything);
      if (kept.length === 0) continue;
      // Done for time, with no reps: a hold, its seconds counted as reps.
      const timed = !kept.some(s => positive(s.reps)) && kept.some(s => positive(s.seconds));
      const out: CompletedSet[] = kept.map(s => ({
        type: s.warmup ? "warmup" : "working",
        weight: positive(s.weight) ? parseWeightToKg(String(s.weight), isKg) : "",
        reps: timed
          ? (positive(s.seconds) ? trimNumber(s.seconds, 0) : "")
          : (positive(s.reps) ? trimNumber(s.reps, 1) : ""),
        done: s.done,
      }));
      const distances = kept.flatMap(s => (positive(s.distance) ? [distanceText(s.distance, parsed.distanceUnit)] : []));
      const notes = [e.notes, distances.length ? `Distance: ${distances.join(", ")}` : ""].filter(Boolean).join("\n");
      const choice = opts.choices[e.name] ?? null;
      exercises.push({
        name: choice?.name ?? e.name,
        ...(choice?.customId ? { customId: choice.customId } : {}),
        sets: out,
        notes,
        ...(timed ? { isIsometric: true as const } : {}),
      });
      sets += out.length;
    }
    if (exercises.length === 0) return;
    workouts.push({
      id: `workout_${stamp}_${i}`,
      date: w.date,
      completedAt: w.end.toISOString(),
      workoutName: w.title || "Workout",
      programId: "",
      durationSeconds: Math.max(0, Math.round((w.end.getTime() - w.start.getTime()) / 1000)),
      exercises,
      ...(w.notes ? { sessionNotes: w.notes } : {}),
    });
  });
  workouts.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return { workouts, skippedDays, sets };
}
