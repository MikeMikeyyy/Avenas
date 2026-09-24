// The achievement cards a trainer sees on a client's Journal tab, rebuilt from
// their history and programs (utils/clientAchievements.ts).
//
// Run:  npx tsx scripts/verify-client-achievements.ts
// Exits non-zero if any assertion fails.

import type { CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import { EMPTY_ACHIEVEMENTS, type Achievement, type AchievementsState } from "../constants/achievements";
import { applyAchievements, detectWorkoutAchievements, visibleAchievements } from "../utils/achievements";
import { deriveClientAchievements } from "../utils/clientAchievements";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const NOW = new Date("2026-09-23T12:00:00.000Z");
const daysAgo = (d: number, hour = 10) => {
  const t = new Date(NOW.getTime() - d * 86400000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString();
};

const set = (weight: string, reps = "5"): CompletedSet => ({ type: "working", weight, reps, done: true });
function session(id: string, ago: number, lifts: Record<string, string> = {}): CompletedWorkout {
  const completedAt = daysAgo(ago);
  return {
    id,
    date: completedAt.slice(0, 10),
    completedAt,
    workoutName: "Push",
    durationSeconds: 3600,
    exercises: Object.entries(lifts).map(([name, w]) => ({ name, sets: [set(w)], notes: "" })),
  };
}
/** Stored newest-first, the way @avenas/workout_history is. */
const stored = (...ws: CompletedWorkout[]) => [...ws].reverse();

function program(over: Partial<SavedProgram>): SavedProgram {
  return {
    id: "p1", name: "PPL", totalWeeks: 8, currentWeek: 8, status: "completed",
    startDate: "01 Jul 2026", trainingDays: 3, cycleDays: 7,
    cyclePattern: ["Push", "Pull", "Legs", "Rest", "Rest", "Rest", "Rest"],
    workouts: {}, ...over,
  } as SavedProgram;
}
const ymdStored = (ago: number) => {
  const d = new Date(NOW.getTime() - ago * 86400000);
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${M[d.getMonth()]} ${d.getFullYear()}`;
};

const summary = (list: Achievement[]) => list.map(a =>
  a.category === "pr" ? `pr:${a.workoutId}:${a.prs.map(p => `${p.exerciseName}@${p.valueKg}>${p.prevKg}`).join("+")}`
  : a.category === "workouts" ? `workouts:${a.count}:${a.workoutId}`
  : a.category === "program" ? `program:${a.programName}`
  : `streak:${a.days}`);

// ─── PRs ─────────────────────────────────────────────────────────────────────
eq(summary(deriveClientAchievements([], [], NOW)), [], "nothing logged, nothing shown");

eq(summary(deriveClientAchievements(stored(
  session("a", 20, { Bench: "100" }),
  session("b", 2, { Bench: "105" }),
), [], NOW)), ["pr:b:Bench@105>100"], "a heavier top set this week is a PR against an older session");

eq(summary(deriveClientAchievements(stored(
  session("a", 20, { Bench: "100" }),
  session("b", 9, { Bench: "105" }),
), [], NOW)), [], "a PR older than a week has expired");

eq(summary(deriveClientAchievements(stored(
  session("a", 3, { Bench: "100" }),
), [], NOW)), [], "the first time an exercise is logged is not a PR");

// Priors are what came BEFORE, never after: b beats a, c doesn't beat b.
eq(summary(deriveClientAchievements(stored(
  session("a", 6, { Bench: "100" }),
  session("b", 4, { Bench: "110" }),
  session("c", 1, { Bench: "105" }),
), [], NOW)), ["pr:b:Bench@110>100"], "a later session is never part of an earlier one's prior history");

eq(summary(deriveClientAchievements(stored(
  session("a", 6, { Bench: "100", Squat: "140" }),
  session("b", 4, { Bench: "110" }),
  session("c", 1, { Squat: "150", Bench: "112.5" }),
), [], NOW)), ["pr:c:Squat@150>140+Bench@112.5>110"], "one PR card, the newest session's, listing every record heaviest first");

eq(summary(deriveClientAchievements([
  session("b", 2, { Bench: "105" }),
  session("a", 20, { Bench: "100" }),
].reverse(), [], NOW)), ["pr:b:Bench@105>100"], "history order doesn't matter, completion time does");

// ─── Workout milestones ─────────────────────────────────────────────────────
{
  const nine = Array.from({ length: 9 }, (_, i) => session(`old${i}`, 40 - i));
  eq(summary(deriveClientAchievements(stored(...nine, session("tenth", 1)), [], NOW)),
    ["workouts:10:tenth"], "the 10th workout, logged this week, is a milestone");
  eq(summary(deriveClientAchievements(stored(...nine, session("tenth", 8)), [], NOW)),
    [], "a milestone older than a week has expired");
  eq(summary(deriveClientAchievements(stored(...nine.slice(1), session("ninth", 1)), [], NOW)),
    [], "the 9th workout is not a milestone");
}

// ─── Programs ────────────────────────────────────────────────────────────────
eq(summary(deriveClientAchievements([], [program({ completedDate: ymdStored(2) })], NOW)),
  ["program:PPL"], "a program run to its final week and completed this week");
eq(summary(deriveClientAchievements([], [program({ currentWeek: 5, completedDate: ymdStored(2) })], NOW)),
  [], "marking a program complete early earns nothing");
eq(summary(deriveClientAchievements([], [program({ completedDate: ymdStored(10) })], NOW)),
  [], "a program finished more than a week ago has expired");
eq(summary(deriveClientAchievements([], [program({ status: "active", completedDate: undefined })], NOW)),
  [], "a program still running earns nothing");
eq(summary(deriveClientAchievements([], [program({ completedDate: "garbage" })], NOW)),
  [], "an unparseable completedDate gives no card rather than a year-0 one");

// ─── Mixed, newest first, never a streak ────────────────────────────────────
{
  const nine = Array.from({ length: 9 }, (_, i) => session(`old${i}`, 40 - i, { Bench: "100" }));
  const got = deriveClientAchievements(
    stored(...nine, session("tenth", 3, { Bench: "105" })),
    [program({ completedDate: ymdStored(1) })],
    NOW,
  );
  // The PR and the milestone share a session, so a timestamp: the tie keeps the
  // order the client's phone gives it (applyAchievements puts the later-detected
  // milestone in front).
  eq(summary(got), ["program:PPL", "workouts:10:tenth", "pr:tenth:Bench@105>100"],
    "one card per category, newest first");
  eq(got.some(a => a.category === "streak"), false, "a streak card is never rebuilt");
}

// ─── Parity: the same cards the client's own phone built, save by save ──────
// Replays what workout.tsx does on Finish (detect against the history before
// it, then applyAchievements), with each save at its completion time.
{
  const lifts = ["Bench", "Squat", "Deadlift", "Row"];
  const history: CompletedWorkout[] = [];
  for (let i = 0; i < 30; i++) {
    const l: Record<string, string> = {};
    lifts.forEach((name, j) => { if ((i + j) % 3 !== 0) l[name] = String(60 + ((i * 7 + j * 13) % 25) * 2.5); });
    history.push(session(`s${i}`, 29 - i, l));
  }
  let phone: AchievementsState = EMPTY_ACHIEVEMENTS;
  const prior: CompletedWorkout[] = [];
  for (const w of history) {
    const at = new Date(w.completedAt);
    phone = applyAchievements(phone, detectWorkoutAchievements(w, prior, phone, at), at);
    prior.push(w);
  }
  const onPhone = visibleAchievements(phone, new Set(history.map(w => w.id)), NOW);
  const rebuilt = deriveClientAchievements(stored(...history), [], NOW);
  eq(summary(rebuilt), summary(onPhone), "a month of live-logged sessions: the trainer sees the client's exact cards");
  eq(rebuilt.map(a => a.earnedAt), onPhone.map(a => a.earnedAt), "  ...with the same dates on them");
  eq(onPhone.length > 0, true, "  ...and there were cards to compare");
}

// ─────────────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
