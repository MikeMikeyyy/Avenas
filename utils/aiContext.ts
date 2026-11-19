// utils/aiContext.ts
//
// The person's training as the AI is given it (docs/ARCHITECTURE.md "AI"): a
// plain-text summary built on the phone from what's stored here, sent with
// each question (lib/ai.ts askAi). Pure, so scripts/verify-ai.ts runs it.
//
// What goes in, most useful first:
//   - the unit they use, and today
//   - the running program: its name, week, today's workout, and each day's
//     exercises with their sets
//   - their own custom exercises (names and muscles) and the slots left
//   - their last workout, each lift against the previous time, and its PRs
//   - how the running program is going: sessions done and missed, its lifts
//     from their first session in it to their latest
//   - how often they've trained (sessions a week, the last 4 weeks)
//   - working sets per muscle group, the last 28 days against the 28 before
//   - their best set of the lifts they do most
//   - their recent sessions, set by set, as many as fit
// Never their name, email, photos, journal, notes or anyone else's training.
//
// It stays under AI_CONTEXT_BUDGET characters: the sections go in that order,
// and recent sessions (the longest) fill what's left, newest first.

import { getCurrentWeek, type CompletedExercise, type CompletedSet, type CompletedWorkout, type Exercise, type SavedProgram } from "../constants/programs";
import { MAX_CUSTOM, type CustomExercise } from "../constants/exercises";
import { liveCustoms } from "./customExercises";
import { isAssisted, liftBeats } from "./assisted";
import { daysBetweenYMD } from "./dates";
import { buildProgramHistory } from "./programHistory";
import { computeSessionRecords, type SessionRecord } from "./workoutSummary";
import { RADAR_GROUPS } from "./muscleGroups";
import { computeMuscleGroupStats } from "./progressStats";
import { dayExercises, programDays } from "./programDays";
import { startsLater } from "./programStart";
import { exerciseIdentity } from "./exerciseNames";
import { formatWeightForDisplay, prescribedWeight, SAME_KG, toDisplayWeight, trimNumber, unitLabel, unitOf } from "./units";
import { getEffectiveToday, resolveWorkoutForDate, type DayOverride } from "./workout";

/** Characters the summary may take. The server takes up to 16,000
 *  (supabase/functions/ai/request.ts LIMITS.contextChars); this leaves room. */
export const AI_CONTEXT_BUDGET = 12_000;

/** Recent sessions listed at most. */
const MAX_SESSIONS = 12;
/** Lifts listed with their best set. */
const MAX_BESTS = 12;

export type TrainingData = {
  history: readonly CompletedWorkout[];
  programs: readonly SavedProgram[];
  customs: readonly CustomExercise[];
  isKg: boolean;
  /** Today's change-day / free-workout pick, if any. */
  override?: DayOverride | null;
  now?: Date;
};

const num = (s: string | undefined): number => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** One done working set, as the person would read it: "80 kg x 8",
 *  "x 12" (no weight), "45s" (a hold), "20 kg help x 8" (assisted). */
function loggedSet(ex: CompletedExercise, weight: string, reps: string, isKg: boolean): string {
  const r = num(reps);
  if (ex.isIsometric) return `${trimNumber(r, 0)}s`;
  const w = num(weight);
  const unit = unitLabel(unitOf(isKg));
  if (!w) return `x ${trimNumber(r, 0)}`;
  const shown = `${formatWeightForDisplay(weight, isKg)} ${unit}`;
  return isAssisted(ex) ? `${shown} help x ${trimNumber(r, 0)}` : `${shown} x ${trimNumber(r, 0)}`;
}

/** A program exercise's working sets, collapsed: "4 x 6-8 @ 80 kg",
 *  "3 x 8, 1 x 6", "3 x 30s". Warm-ups counted, not listed. */
function prescription(ex: Exercise, isKg: boolean): string {
  const working = (ex.sets ?? []).filter(s => s.type === "working");
  const warmups = (ex.sets ?? []).length - working.length;
  const parts: { text: string; count: number }[] = [];
  for (const s of working) {
    const reps = s.repMode === "range" && (s.repsMin || s.repsMax)
      ? `${s.repsMin ?? "?"}-${s.repsMax ?? "?"}`
      : s.reps || "?";
    const load = s.weightKg && num(s.weightKg)
      ? (() => { const w = prescribedWeight(s.weightKg, s.weightUnit, isKg); return ` @ ${w.text} ${unitLabel(w.unit)}`; })()
      : "";
    const text = ex.isIsometric ? `${reps}s${load}` : `${reps}${load}`;
    const last = parts[parts.length - 1];
    if (last && last.text === text) last.count += 1;
    else parts.push({ text, count: 1 });
  }
  const sets = parts.map(p => `${p.count} x ${p.text}`).join(", ") || "no sets";
  return warmups > 0 ? `${sets} (+${warmups} warm-up)` : sets;
}

function programSection(data: TrainingData, today: string, program: SavedProgram): string[] {
  const lines: string[] = [];
  const week = getCurrentWeek(program, data.now ?? new Date());
  const held = program.pausedAt ? `, on hold since ${program.pausedAt}` : "";
  // Set to start later (utils/programStart.ts): when, and that the days until
  // then are rest, rather than "week 0".
  const startsOn = startsLater(program, today);
  lines.push(startsOn
    ? `Running program: "${program.name}", ${program.totalWeeks} weeks, set to start on ${startsOn}; the days until then are rest days.`
    : `Running program: "${program.name}", week ${week} of ${program.totalWeeks}, started ${program.startDate}${held}.`);
  lines.push(`Cycle: ${program.cycleDays} days with ${program.trainingDays} training days.`);
  const todays = resolveWorkoutForDate(program, data.override ?? null, today, [...data.programs]);
  lines.push(todays ? `Today's workout: ${todays.name}.` : "Today: rest day.");
  lines.push("Program days:");
  for (const ref of programDays(program)) {
    if (ref.index < 0) continue;
    const exercises = dayExercises(program.workouts, ref.index, ref.label);
    const list = exercises.map(e => `${e.name} ${prescription(e, data.isKg)}`).join("; ");
    lines.push(`- ${ref.label}: ${list || "no exercises"}`);
  }
  return lines;
}

/** Their own exercises (live ones), which the Program Builder may use as it
 *  uses the catalogue's, and how many custom exercise slots are free for it to
 *  offer a new one (user ask, 2026-11-13). Names and muscles only. */
function customsSection(customs: readonly CustomExercise[]): string[] {
  const live = liveCustoms([...customs]);
  const free = Math.max(0, MAX_CUSTOM - live.length);
  const rows = live.map(c => `- ${c.name} | ${c.muscles.join(", ") || "no muscle set"}${c.assisted ? " | assisted (its weight is help)" : ""}`);
  return [
    `Their custom exercises (${live.length} of ${MAX_CUSTOM} slots used, ${free} free):`,
    ...(rows.length ? rows : ["- none yet"]),
  ];
}

/** The best of a session's done working sets of one lift: the heaviest (the
 *  least help for an assisted lift, liftBeats), the most reps at it; for a
 *  hold, the longest. Weights within SAME_KG are the same weight, as Exercise
 *  History counts them. */
function bestSet(sets: readonly CompletedSet[], assisted: boolean, hold: boolean): CompletedSet | null {
  let best: CompletedSet | null = null;
  for (const s of sets) {
    if (s.type !== "working" || !s.done || !num(s.reps)) continue;
    if (!best) { best = s; continue; }
    const kg = num(s.weight) - num(best.weight);
    const better = hold
      ? num(s.reps) > num(best.reps)
      : Math.abs(kg) >= SAME_KG ? liftBeats(num(s.weight), num(best.weight), assisted) : num(s.reps) > num(best.reps);
    if (better) best = s;
  }
  return best;
}

/** How a best set compares with an earlier one: "up 2.5 kg", "2 more reps",
 *  "5 kg less help (stronger)", "the same". */
function versus(now: CompletedSet, before: CompletedSet, assisted: boolean, hold: boolean, isKg: boolean): string {
  if (!hold) {
    const kg = num(now.weight) - num(before.weight);
    if (Math.abs(kg) >= SAME_KG) {
      const by = `${trimNumber(toDisplayWeight(Math.abs(kg), isKg), 1)} ${unitLabel(unitOf(isKg))}`;
      if (assisted) return kg < 0 ? `${by} less help (stronger)` : `${by} more help (easier)`;
      return kg > 0 ? `up ${by}` : `down ${by}`;
    }
  }
  const more = num(now.reps) - num(before.reps);
  const what = hold ? "seconds" : "reps";
  return more > 0 ? `${trimNumber(more, 0)} more ${what}` : more < 0 ? `${trimNumber(-more, 0)} fewer ${what}` : "the same";
}

/** Every time a session did one lift, its sets together. */
const setsOf = (w: CompletedWorkout, id: string) => w.exercises.filter(e => exerciseIdentity(e) === id).flatMap(e => e.sets);

/** What each record the post-workout summary shows reads as here. */
function recordLabel(r: SessionRecord): string {
  if (r.kind === "heaviest") return r.assisted ? "least help yet" : "heaviest yet";
  if (r.kind === "reps") {
    // A rep PR (utils/repPrs.ts): more than ever at a weight done before.
    const what = r.hold ? "seconds" : "reps";
    // At bodyweight, more than any set of it ever, weighted or not.
    const at = r.assisted ? " at that help or less" : r.valueKg > 0 ? " at that weight or more" : "";
    return `rep PR, most ${what} yet${at} (${trimNumber(r.reps ?? 0, 1)}, up from ${trimNumber(r.prevReps ?? 0, 1)})`;
  }
  return r.kind === "oneRepMax" ? "best estimated one rep max yet" : "best set volume yet";
}

/**
 * Their last workout, each lift's best set against the previous time they did
 * it, and its records (computeSessionRecords, as the post-workout summary
 * shows them): what "Review my last workout" is answered from (user pick,
 * 2026-11-14: insights only when asked, in Insights).
 */
function lastWorkoutSection(data: TrainingData): string[] {
  const sorted = [...data.history].sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const last = sorted[sorted.length - 1];
  if (!last) return [];
  const before = sorted.slice(0, -1);
  const records = computeSessionRecords(last, before);
  const minutes = last.durationSeconds > 0 ? `, ${Math.round(last.durationSeconds / 60)} min` : "";
  const lines = [`Their last workout, ${last.date} ${last.workoutName}${minutes}, each lift's best set against the previous time they did it:`];
  const seen = new Set<string>();
  for (const ex of last.exercises) {
    const id = exerciseIdentity(ex);
    if (seen.has(id)) continue;
    seen.add(id);
    const assisted = isAssisted(ex);
    const hold = !!ex.isIsometric;
    const best = bestSet(setsOf(last, id), assisted, hold);
    if (!best) continue;
    let previous: { w: CompletedWorkout; set: CompletedSet } | null = null;
    for (let i = before.length - 1; i >= 0 && !previous; i--) {
      const set = bestSet(setsOf(before[i], id), assisted, hold);
      if (set) previous = { w: before[i], set };
    }
    const vs = previous
      ? `last time ${loggedSet(ex, previous.set.weight, previous.set.reps, data.isKg)} on ${previous.w.date}: ${versus(best, previous.set, assisted, hold, data.isKg)}`
      : "the first time they've done it";
    const prs = records.filter(r => r.exerciseName === ex.name && r.prevKg !== null).map(recordLabel);
    lines.push(`- ${ex.name}: best ${loggedSet(ex, best.weight, best.reps, data.isKg)}; ${vs}${prs.length ? `. PR: ${prs.join(", ")}` : ""}`);
  }
  return lines.length > 1 ? lines : [];
}

/**
 * How the running program is going: this week's sessions done against those
 * planned, those done and missed so far (buildProgramHistory, the program
 * history page's own counts), and each lift done in its sessions (planned or
 * swapped in) from its first session in the program to its latest. What
 * "How's my program going?" is answered from.
 */
function programProgressSection(data: TrainingData, today: string, program: SavedProgram): string[] {
  const run = buildProgramHistory(program, [...data.history], today);
  if (!run.weeks.length) return [];
  const sofar = run.weeks.filter(w => w.startYMD <= today);
  const count = (state: string) => sofar.reduce((n, w) => n + w.days.filter(d => d.state === state).length, 0);
  const current = run.weeks.find(w => w.isCurrent);
  const replaced = count("replaced");
  const lines = [`How "${program.name}" is going:`];
  if (current) lines.push(`- This week (Monday to Sunday): ${current.done} of ${current.planned} sessions done.`);
  lines.push(`- So far: ${run.totals.sessions} sessions done, ${count("missed")} missed${replaced ? `, ${replaced} days another workout was done instead` : ""}.`);

  // Oldest first: each lift's first session in the program and its latest.
  const sessions = run.weeks.flatMap(w => w.sessions).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  // Every lift done in its sessions, planned or swapped in (what they really
  // trained), in the order first done.
  const lifts: string[] = [];
  const seen = new Set<string>();
  for (const ex0 of sessions.flatMap(w => w.exercises)) {
    const id = exerciseIdentity(ex0);
    if (seen.has(id)) continue;
    seen.add(id);
    const done = sessions.filter(w => setsOf(w, id).some(s => s.type === "working" && s.done));
    if (done.length < 2) continue;
    const first = done[0];
    const latest = done[done.length - 1];
    const ex = latest.exercises.find(e => exerciseIdentity(e) === id)!;
    const assisted = isAssisted(ex);
    const hold = !!ex.isIsometric;
    const from = bestSet(setsOf(first, id), assisted, hold);
    const to = bestSet(setsOf(latest, id), assisted, hold);
    if (!from || !to) continue;
    lifts.push(`  - ${ex.name}: ${loggedSet(ex, from.weight, from.reps, data.isKg)} (${first.date}) to ${loggedSet(ex, to.weight, to.reps, data.isKg)} (${latest.date}), ${versus(to, from, assisted, hold, data.isKg)}`);
  }
  if (lifts.length) lines.push("- Its lifts, best set in their first session of the program against their latest:", ...lifts);
  return lines;
}

/** Days from `ymd` back to `today` (0 = today), or null for a bad date. */
function ago(today: string, ymd: string): number | null {
  const d = daysBetweenYMD(ymd, today);
  return d === null || d < 0 ? null : d;
}

function frequencySection(history: readonly CompletedWorkout[], today: string): string[] {
  const weeks = [0, 0, 0, 0];
  for (const w of history) {
    const d = ago(today, w.date);
    if (d !== null && d < 28) weeks[Math.floor(d / 7)] += 1;
  }
  const first = history.reduce<string | null>((min, w) => (min === null || w.date < min ? w.date : min), null);
  return [
    `Workouts logged: ${history.length} in total${first ? `, since ${first}` : ""}.`,
    `Sessions a week, the last 4 weeks (this week first): ${weeks.join(", ")}.`,
  ];
}

function muscleSection(data: TrainingData, today: string): string[] {
  const window = (from: number, to: number) => data.history.filter(w => {
    const d = ago(today, w.date);
    return d !== null && d >= from && d < to;
  });
  const recent = computeMuscleGroupStats([...window(0, 28)], [...data.customs]);
  const before = computeMuscleGroupStats([...window(28, 56)], [...data.customs]);
  const rows = RADAR_GROUPS
    .filter(g => recent[g].sets > 0 || before[g].sets > 0)
    .map(g => `- ${g}: ${Math.round(recent[g].sets)} (before: ${Math.round(before[g].sets)})`);
  if (!rows.length) return [];
  return ["Working sets per muscle group, last 28 days (the 28 days before in brackets):", ...rows];
}

type Best = { name: string; weight: number; reps: number; date: string; text: string; sessions: number; assisted: boolean; hold: boolean };

function bestsSection(data: TrainingData, today: string): string[] {
  const byLift = new Map<string, Best>();
  // Oldest first, so the latest name a lift was logged under is the one shown.
  const sorted = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of sorted) {
    const d = ago(today, w.date);
    if (d === null || d >= 90) continue;
    for (const ex of w.exercises) {
      const id = exerciseIdentity(ex);
      const assisted = isAssisted(ex);
      const hold = !!ex.isIsometric;
      let best = byLift.get(id);
      let counted = false;
      for (const s of ex.sets) {
        if (s.type !== "working" || !s.done) continue;
        const weight = num(s.weight);
        const reps = num(s.reps);
        if (!reps) continue;
        if (!counted) {
          counted = true;
          if (best) { best.sessions += 1; best.name = ex.name; }
        }
        const better = !best
          || (hold ? reps > best.reps
            : weight === best.weight ? reps > best.reps
            : weight > 0 && best.weight > 0 ? liftBeats(weight, best.weight, assisted)
            : weight > best.weight);
        if (better) {
          const text = loggedSet(ex, s.weight, s.reps, data.isKg);
          best = { name: ex.name, weight, reps, date: w.date, text, sessions: best?.sessions ?? 1, assisted, hold };
          byLift.set(id, best);
        }
      }
    }
  }
  const rows = [...byLift.values()]
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
    .slice(0, MAX_BESTS)
    .map(b => `- ${b.name}: ${b.text} on ${b.date} (${b.sessions} session${b.sessions === 1 ? "" : "s"})`);
  if (!rows.length) return [];
  return ["Best working set of their most-done lifts, last 90 days:", ...rows];
}

function sessionLine(w: CompletedWorkout, isKg: boolean): string {
  const minutes = w.durationSeconds > 0 ? `, ${Math.round(w.durationSeconds / 60)} min` : "";
  const exercises = w.exercises
    .map(ex => {
      const sets = ex.sets.filter(s => s.type === "working" && s.done && num(s.reps));
      if (!sets.length) return null;
      return `${ex.name} ${sets.map(s => loggedSet(ex, s.weight, s.reps, isKg)).join(", ")}`;
    })
    .filter((x): x is string => !!x);
  return `- ${w.date} ${w.workoutName}${minutes}: ${exercises.join("; ") || "nothing logged"}`;
}

/** The summary the AI is sent. Fits AI_CONTEXT_BUDGET. */
export function buildTrainingSummary(data: TrainingData): string {
  const now = data.now ?? new Date();
  const active = data.programs.find(p => p.status === "active") ?? null;
  const today = getEffectiveToday(active, data.history, now);

  const lines: string[] = [];
  const add = (section: string[]) => { if (section.length) lines.push(...section, ""); };
  add([`Weights are in ${unitLabel(unitOf(data.isKg))}.`, `Today is ${today}.`]);
  add(active ? programSection(data, today, active) : ["No program running."]);
  add(customsSection(data.customs));
  if (!data.history.length) {
    add(["Nothing logged yet."]);
    return lines.join("\n").trim().slice(0, AI_CONTEXT_BUDGET);
  }
  add(lastWorkoutSection(data));
  if (active) add(programProgressSection(data, today, active));
  add(frequencySection(data.history, today));
  add(muscleSection(data, today));
  add(bestsSection(data, today));

  let text = lines.join("\n").trim();
  // A section too long on its own (a huge program) is cut at the budget.
  if (text.length > AI_CONTEXT_BUDGET) return text.slice(0, AI_CONTEXT_BUDGET);

  const recent = [...data.history]
    .sort((a, b) => b.date.localeCompare(a.date) || b.completedAt.localeCompare(a.completedAt))
    .slice(0, MAX_SESSIONS);
  const heading = "\n\nRecent sessions, newest first (done working sets):";
  if (recent.length && text.length + heading.length < AI_CONTEXT_BUDGET) {
    let block = heading;
    for (const w of recent) {
      const line = `\n${sessionLine(w, data.isKg)}`;
      if (text.length + block.length + line.length > AI_CONTEXT_BUDGET) break;
      block += line;
    }
    if (block !== heading) text += block;
  }
  return text;
}
