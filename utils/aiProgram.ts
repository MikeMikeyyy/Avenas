// utils/aiProgram.ts
//
// A program the AI built (supabase/functions/ai, feature "program", the JSON
// of PROGRAM_SCHEMA) made into a draft for the builder (app/new-program.tsx
// reads NEW_PROGRAM_DRAFT_KEY when it opens to create), so the person checks
// it, changes anything and saves it themselves: nothing the AI makes is saved
// unseen. Pure, so scripts/verify-ai.ts runs it.
//
// The model is held to the shape by structured outputs, but not to the
// numbers or the names: every number is brought into the builder's own range
// here, and every exercise must be one the picker knows (matchExerciseName,
// as an import's are); one that isn't is left out and named, never invented.

import { MAX_CUSTOM, MUSCLE_GROUPS, type CustomExercise, type SelectableMuscle } from "../constants/exercises";
import type { Exercise, ProgramSet, WorkoutMap } from "../constants/programs";
import type { GeneratedProgram } from "../supabase/functions/ai/request";
import { liveCustoms } from "./customExercises";
import { matchExerciseName } from "./exerciseMatch";
import { exerciseKey } from "./exerciseNames";
import { musclesForExercise } from "./muscleGroups";
import { normalizeDayIds, workoutKey } from "./programDays";

/** The builder's draft of a new program (app/new-program.tsx ProgramDraft). */
export type BuilderDraft = {
  step: 1;
  name: string;
  totalWeeks: number;
  cycleDays: number;
  cyclePattern: string[];
  dayIds: string[];
  isTrainingDay: boolean[];
  workouts: WorkoutMap;
};

/** The builder's own limits (app/new-program.tsx). */
const CYCLE_MIN = 2;
const CYCLE_MAX = 14;
const WEEKS_MAX = 52;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.round(n), lo), hi);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s*—\s*/g, ", ").trim() : "");

/** The built program, if `raw` is one (the model's JSON); null if not. */
export function parseGeneratedProgram(raw: string): GeneratedProgram | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<GeneratedProgram>;
  if (!Array.isArray(p.days) || p.days.length === 0) return null;
  return p as GeneratedProgram;
}

/** One set row's reps: "8" a target, "8-12" (or "8 to 12") a range. */
function repsOf(reps: string): Pick<ProgramSet, "repMode" | "reps" | "repsMin" | "repsMax"> {
  const range = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/i.exec(reps.trim());
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return lo === hi ? { repMode: "target", reps: String(lo) } : { repMode: "range", repsMin: String(lo), repsMax: String(hi) };
  }
  const single = /\d+/.exec(reps);
  return single ? { repMode: "target", reps: single[0] } : { repMode: "target" };
}

/** A new custom exercise to make, as Create Exercise would (no photo). */
export type NewExercise = { name: string; muscles: SelectableMuscle[]; steps: string[]; assisted: boolean };

/** Longest a new exercise's name is kept, its most steps, and each step. */
const NAME_MAX = 60;
const STEPS_MAX = 8;
const STEP_MAX = 300;

const MUSCLES = new Set<string>(MUSCLE_GROUPS.filter(m => m !== "All"));
const isMuscle = (m: unknown): m is SelectableMuscle => typeof m === "string" && MUSCLES.has(m);

/**
 * The new custom exercises the program asks for that should be made (user
 * ask, 2026-11-13: an exercise not in the list is offered as a custom one,
 * and made once the person says so): only those its days use, never one the
 * person already has (a catalogue exercise or a live custom one of that name,
 * however it's written: that one is used), at least one muscle each, and no
 * more than the free custom exercise slots. Those past the slots are named in
 * `noRoom`.
 */
export function newExercisesIn(program: GeneratedProgram, customs: CustomExercise[] = []): { create: NewExercise[]; noRoom: string[] } {
  const used = new Set(program.days.flatMap(d => (Array.isArray(d?.exercises) ? d.exercises.map(e => exerciseKey(text(e?.name))) : [])));
  let free = Math.max(0, MAX_CUSTOM - liveCustoms(customs).length);
  const seen = new Set<string>();
  const create: NewExercise[] = [];
  const noRoom: string[] = [];
  for (const def of Array.isArray(program.new_exercises) ? program.new_exercises : []) {
    const name = text(def?.name).slice(0, NAME_MAX);
    const key = exerciseKey(name);
    if (!name || seen.has(key) || !used.has(key)) continue;
    seen.add(key);
    if (matchExerciseName(name, customs).kind === "matched") continue;
    const muscles = [...new Set((Array.isArray(def.muscles) ? def.muscles : []).filter(isMuscle))];
    if (!muscles.length) continue;
    if (free === 0) { noRoom.push(name); continue; }
    free -= 1;
    const steps = (Array.isArray(def.steps) ? def.steps : []).map(text).filter(Boolean).slice(0, STEPS_MAX).map(s => s.slice(0, STEP_MAX));
    create.push({ name, muscles, steps, assisted: def.assisted === true });
  }
  return { create, noRoom };
}

// ─── The safety net (user ask, 2026-11-14) ───────────────────────────────────
// A built program had 2 warm-ups and 4 working sets on most of 7 exercises:
// near 2 hours. The prompt now coaches it properly (supabase/functions/ai/
// prompts.ts PROGRAM_SYSTEM); this holds whatever comes back to it anyway.

/** Most working sets an exercise is given (5 x 5 on a strength lift). */
const WORKING_MAX = 5;
/** Warm-ups: up to 2 on the day's first exercise, 1 on the first exercise of
 *  another muscle group, none after (the muscles are warm). Research finds
 *  more doesn't help: one or two, the last near the working weight. */
const FIRST_WARMUPS = 2;
/** How long a session takes, as the prompt counts it: a general warm-up, each
 *  warm-up set with its rest, each working set's lifting and its rest. */
const GENERAL_WARMUP_MIN = 5;
const WARMUP_SET_MIN = 1.5;
const WORK_SECONDS = 45;
/** A day may run this much over the session length before it's trimmed. */
const OVER = 1.1;
/** Fewest working sets trimming leaves an exercise. */
const TRIM_FLOOR = 2;

/** About how many minutes a day of exercises takes (see above). */
export function sessionMinutes(exercises: readonly Exercise[]): number {
  let minutes = GENERAL_WARMUP_MIN;
  for (const e of exercises) {
    for (const s of e.sets) minutes += s.type === "warmup" ? WARMUP_SET_MIN : (WORK_SECONDS + (e.restSeconds ?? 90)) / 60;
  }
  return minutes;
}

const workingCount = (e: Exercise) => e.sets.filter(s => s.type === "working").length;

/** `sets` with no more than `max` warm-ups (the first ones kept). */
function capWarmups(sets: ProgramSet[], max: number): ProgramSet[] {
  let kept = 0;
  return sets.filter(s => s.type !== "warmup" || kept++ < max);
}

/** One working set fewer (its last). */
function dropWorkingSet(sets: ProgramSet[]): ProgramSet[] {
  const at = sets.map(s => s.type).lastIndexOf("working");
  return at < 0 ? sets : [...sets.slice(0, at), ...sets.slice(at + 1)];
}

/** A day trimmed to fit the session length: how many sets came off, and
 *  which exercises. */
export type Trim = { day: string; sets: number; exercises: string[] };

/**
 * The draft the builder opens with; the exercises left out (the picker
 * doesn't know them, or they're `notCreated`: new ones the person said no to
 * or that had no room, never swapped for something else); the ones taken as
 * the nearest the picker has (`swapped`, the model having written the name a
 * little off); each workout day's minutes, any day trimmed to fit the session
 * length the person gave (`trimmed`: working sets off the last exercises
 * first, never below TRIM_FLOOR, then the last exercise, never the first);
 * and the "how to run it" lines. Null when nothing usable came back (no day
 * with an exercise the picker knows).
 */
export function draftFromGenerated(
  program: GeneratedProgram,
  customs: CustomExercise[] = [],
  options: { notCreated?: readonly string[]; now?: number } = {},
): {
  draft: BuilderDraft;
  dropped: string[];
  swapped: { said: string; used: string }[];
  minutes: { day: string; minutes: number }[];
  sessionLimit: number | null;
  trimmed: Trim[];
  howToRun: string[];
} | null {
  const now = options.now ?? Date.now();
  const notCreated = new Set((options.notCreated ?? []).map(n => exerciseKey(n)));
  const swapped: { said: string; used: string }[] = [];
  const days = program.days.slice(0, CYCLE_MAX);
  // A cycle of one (every day the same workout) is two in the builder.
  while (days.length < CYCLE_MIN) days.push({ name: "Rest", rest: true, exercises: [] });
  const limit = num(program.session_minutes, 0);
  const sessionLimit = limit >= 20 && limit <= 180 ? Math.round(limit) : null;

  const dropped: string[] = [];
  const workouts: WorkoutMap = {};
  const cyclePattern: string[] = [];
  const isTrainingDay: boolean[] = [];
  const minutes: { day: string; minutes: number }[] = [];
  const trimmed: Trim[] = [];
  let usable = 0;

  days.forEach((day, i) => {
    const rest = day?.rest === true || !Array.isArray(day?.exercises) || day.exercises.length === 0;
    const label = rest ? "" : text(day.name) || "Workout";
    cyclePattern.push(label);
    isTrainingDay.push(!rest);
    if (rest) return;

    const exercises: Exercise[] = [];
    day.exercises.forEach((ex, j) => {
      const said = text(ex?.name);
      const match = said && !notCreated.has(exerciseKey(said)) ? matchExerciseName(said, customs) : { kind: "none" as const };
      if (match.kind === "none") {
        if (said && !dropped.includes(said)) dropped.push(said);
        return;
      }
      if (match.kind === "check" && !swapped.some(s => s.said === said)) swapped.push({ said, used: match.name });
      const hold = ex.hold === true;
      const set = repsOf(text(ex.reps));
      const sets: ProgramSet[] = [
        ...Array.from({ length: clamp(num(ex.warmup_sets, 0), 0, FIRST_WARMUPS) }, (): ProgramSet => ({ type: "warmup" })),
        ...Array.from({ length: clamp(num(ex.sets, 3), 1, WORKING_MAX) }, (): ProgramSet => ({ type: "working", ...set })),
      ];
      const note = text(ex.note).slice(0, 120);
      exercises.push({
        id: `ai-${now.toString(36)}-${i}-${j}`,
        name: match.name,
        ...(match.customId ? { customId: match.customId } : {}),
        sets,
        ...(hold ? { isIsometric: true } : {}),
        restSeconds: clamp(num(ex.rest_seconds, 90), 15, 600),
        ...(note ? { programNotes: note } : {}),
      });
    });

    // Warm-ups only where they help: the day's first exercise, then the first
    // of each other muscle group (by the exercise's own muscles).
    const warmed = new Set<string>();
    let kept: Exercise[] = exercises.map((e, k) => {
      const group = musclesForExercise(e, customs)[0];
      const allowed = k === 0 ? FIRST_WARMUPS : group && !warmed.has(group) ? 1 : 0;
      if (group) warmed.add(group);
      return { ...e, sets: capWarmups(e.sets, allowed) };
    });

    // Within the session length (with OVER to spare): a working set off the
    // last exercise that has more than TRIM_FLOOR, again and again, then the
    // last exercise itself, never the first.
    if (sessionLimit) {
      let sets = 0;
      const cut: string[] = [];
      while (sessionMinutes(kept) > sessionLimit * OVER) {
        const k = kept.map(e => workingCount(e) > TRIM_FLOOR).lastIndexOf(true);
        if (k >= 0) {
          kept = kept.map((e, at) => (at === k ? { ...e, sets: dropWorkingSet(e.sets) } : e));
          sets += 1;
        } else if (kept.length > 1) {
          cut.push(kept[kept.length - 1].name);
          kept = kept.slice(0, -1);
        } else {
          break;
        }
      }
      if (sets || cut.length) trimmed.push({ day: label, sets, exercises: cut });
    }

    usable += kept.length;
    workouts[workoutKey(i, label)] = kept;
    if (kept.length) minutes.push({ day: label, minutes: Math.round(sessionMinutes(kept)) });
  });

  if (usable === 0) return null;
  const howToRun = (Array.isArray(program.how_to_run) ? program.how_to_run : [])
    .map(text).filter(Boolean).slice(0, 4).map(line => line.slice(0, 200));
  return {
    draft: {
      step: 1,
      name: text(program.name) || "My AI program",
      totalWeeks: clamp(num(program.weeks, 8), 1, WEEKS_MAX),
      cycleDays: days.length,
      cyclePattern,
      dayIds: normalizeDayIds(undefined, days.length),
      isTrainingDay,
      workouts,
    },
    dropped,
    swapped,
    minutes,
    sessionLimit,
    trimmed,
    howToRun,
  };
}

/** "A", "A and B", "A, B and C". */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the Program Builder says once a program is built: where it is, how
 *  long its sessions take, what it made, trimmed, left out or swapped along
 *  the way, and how to run it. */
export function builtMessage(
  name: string,
  outcome: {
    added: readonly string[];
    noRoom: readonly string[];
    dropped: readonly string[];
    swapped: readonly { said: string; used: string }[];
    minutes?: readonly { day: string; minutes: number }[];
    sessionLimit?: number | null;
    trimmed?: readonly Trim[];
    howToRun?: readonly string[];
  },
  maxCustom: number = MAX_CUSTOM,
): string {
  const parts = [`Your program "${name}" is ready. It's open in the builder: check it over, change anything you like, and save it.`];
  const one = (list: readonly unknown[]) => list.length === 1;
  // To the nearest 5 minutes: it's an estimate.
  const fives = (outcome.minutes ?? []).map(m => Math.max(5, Math.round(m.minutes / 5) * 5));
  if (fives.length) {
    const lo = Math.min(...fives);
    const hi = Math.max(...fives);
    parts.push(lo === hi ? `Each session takes about ${lo} minutes.` : `Sessions take about ${lo} to ${hi} minutes.`);
  }
  for (const t of outcome.trimmed ?? []) {
    const what = [
      ...(t.sets ? [`${t.sets} set${t.sets === 1 ? "" : "s"}`] : []),
      ...(t.exercises.length ? [listOf(t.exercises)] : []),
    ];
    parts.push(`To keep ${t.day} within your ${outcome.sessionLimit} minutes, I took off ${what.join(" and ")}.`);
  }
  if (outcome.added.length) {
    parts.push(`I added ${listOf(outcome.added)} to your custom exercises.`);
  }
  if (outcome.noRoom.length) {
    parts.push(`${listOf(outcome.noRoom)} ${one(outcome.noRoom) ? "is" : "are"} left out: all ${maxCustom} of your custom exercise slots are used.`);
  }
  const others = outcome.dropped.filter(d => !outcome.noRoom.includes(d));
  if (others.length) {
    parts.push(`I left out ${listOf(others)}, which ${one(others) ? "isn't" : "aren't"} in your exercise list.`);
  }
  for (const s of outcome.swapped) parts.push(`I used ${s.used} for "${s.said}".`);
  const run = (outcome.howToRun ?? []).map(line => `• ${line}`);
  return run.length ? `${parts.join(" ")}\n\nHow to run it:\n${run.join("\n")}` : parts.join(" ");
}
