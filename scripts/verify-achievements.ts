// What earns an achievement, and how the Home cards replace and expire.
//
// Run:  npx tsx scripts/verify-achievements.ts
// Exits non-zero if any assertion fails.

import type { CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import { EMPTY_ACHIEVEMENTS, type Achievement, type AchievementsState } from "../constants/achievements";
import {
  achievementsForWorkout,
  applyAchievements,
  describeAchievement,
  detectProgramAchievement,
  detectStreakAchievement,
  detectWorkoutAchievements,
  pickHeadline,
  visibleAchievements,
} from "../utils/achievements";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const set = (weight: string, reps: string, done = true): CompletedSet => ({ type: "working", weight, reps, done });
const ex = (name: string, sets: CompletedSet[]) => ({ name, sets, notes: "" });
let seq = 0;
function workout(exercises: CompletedWorkout["exercises"], id = `w${++seq}`): CompletedWorkout {
  return { id, date: "2026-09-01", completedAt: "2026-09-01T10:00:00.000Z", workoutName: "Push", durationSeconds: 0, exercises };
}
const NOW = new Date("2026-09-18T12:00:00.000Z");
const categories = (list: Achievement[]) => list.map(a => a.category);

// ─── PRs: heaviest weight only, against a real previous best ────────────────
{
  const prior = [workout([ex("Bench Press", [set("100", "5")]), ex("Squat", [set("140", "3")])])];

  eq(categories(detectWorkoutAchievements(workout([ex("Deadlift", [set("180", "3")])]), prior, EMPTY_ACHIEVEMENTS, NOW)), [],
    "PR: logging an exercise for the first time is not a PR");
  eq(categories(detectWorkoutAchievements(workout([ex("Bench Press", [set("100", "5")])]), prior, EMPTY_ACHIEVEMENTS, NOW)), [],
    "PR: matching your best is not a PR");
  eq(categories(detectWorkoutAchievements(workout([ex("Bench Press", [set("100", "8")])]), prior, EMPTY_ACHIEVEMENTS, NOW)), [],
    "PR: more reps at the same weight (a higher estimated 1RM) is not a PR");
  eq(categories(detectWorkoutAchievements(workout([ex("Bench Press", [set("102.5", "3", false)])]), prior, EMPTY_ACHIEVEMENTS, NOW)), [],
    "PR: an unticked set doesn't count");

  const beat = detectWorkoutAchievements(workout([ex("Bench Press", [set("102.5", "3")])]), prior, EMPTY_ACHIEVEMENTS, NOW);
  eq(categories(beat), ["pr"], "PR: a heavier top set than ever is a PR");
  const pr = beat[0];
  if (pr.category === "pr") {
    eq(pr.prs, [{ exerciseName: "Bench Press", valueKg: 102.5, prevKg: 100 }], "PR: records the new and beaten weights");
  }

  const two = detectWorkoutAchievements(
    workout([ex("Bench Press", [set("102.5", "3")]), ex("Squat", [set("145", "2")])]),
    prior, EMPTY_ACHIEVEMENTS, NOW,
  );
  eq(categories(two), ["pr"], "PR: several in one session make ONE card");
  const head = two[0];
  if (head.category === "pr") {
    eq(head.prs.map(p => p.exerciseName), ["Squat", "Bench Press"],
      "PR: every record is kept, heaviest first, so the card can list them all");
  }
}

// ─── Workout milestones: exact counts, once each ────────────────────────────
{
  const history = (n: number) => Array.from({ length: n }, () => workout([ex("Row", [set("50", "10")])]));
  eq(categories(detectWorkoutAchievements(workout([]), history(8), EMPTY_ACHIEVEMENTS, NOW)), [],
    "milestone: the 9th workout earns nothing");
  const tenth = detectWorkoutAchievements(workout([]), history(9), EMPTY_ACHIEVEMENTS, NOW);
  eq(tenth.map(a => a.id), ["workouts:10"], "milestone: the 10th workout earns one");
  eq(categories(detectWorkoutAchievements(workout([]), history(10), EMPTY_ACHIEVEMENTS, NOW)), [],
    "milestone: the 11th earns nothing");
  const after = applyAchievements(EMPTY_ACHIEVEMENTS, tenth, NOW);
  eq(after.awarded, ["workouts:10"], "milestone: remembered once earned");
  eq(categories(detectWorkoutAchievements(workout([]), history(9), after, NOW)), [],
    "milestone: deleting and redoing the 10th doesn't award it again");
}

// ─── Programs: only a full run, once per run ─────────────────────────────────
{
  const program = { id: "P", name: "PPL", totalWeeks: 8, startDate: "01 Jul 2026" } as SavedProgram;
  eq(detectProgramAchievement(program, 5, EMPTY_ACHIEVEMENTS, NOW), null, "program: ending in week 5 of 8 isn't an achievement");
  const done = detectProgramAchievement(program, 8, EMPTY_ACHIEVEMENTS, NOW);
  eq(done?.category, "program", "program: reaching the final week is");
  const state = applyAchievements(EMPTY_ACHIEVEMENTS, done ? [done] : [], NOW);
  eq(detectProgramAchievement(program, 8, state, NOW), null, "program: the same run isn't awarded twice");
  eq(detectProgramAchievement({ ...program, startDate: "01 Sep 2026" }, 8, state, NOW)?.category, "program",
    "program: running it again later earns it again");
}

// ─── Streaks: milestones only, and they can recur ───────────────────────────
{
  eq(detectStreakAchievement(6, NOW), null, "streak: 6 days is not a milestone");
  eq(detectStreakAchievement(7, NOW)?.category, "streak", "streak: 7 days is");
  const first = detectStreakAchievement(7, NOW)!;
  const state = applyAchievements(EMPTY_ACHIEVEMENTS, [first], NOW);
  eq(state.awarded, [], "streak: not once-only, so a rebuilt streak earns it again");

  // The early ones, then every 50 days for as long as the streak runs — the
  // list used to stop at 365 and the longest streaks earned nothing after it.
  const earnedAt = (days: number): number | null => {
    const a = detectStreakAchievement(days, NOW);
    return a && a.category === "streak" ? a.days : null;
  };
  eq(earnedAt(30), 30, "streak: 30 days is an early milestone");
  eq(detectStreakAchievement(40, NOW), null, "streak: 40 days (the top flame tier) is not one");
  for (const days of [50, 100, 150, 200, 250, 400, 1000]) {
    eq(earnedAt(days), days, `streak: ${days} days is a milestone`);
  }
  for (const days of [49, 51, 99, 149, 365]) {
    eq(detectStreakAchievement(days, NOW), null, `streak: ${days} days is not`);
  }
}

// ─── Cards: one per category, newest replaces, a week long ──────────────────
{
  const day = (n: number) => new Date(NOW.getTime() + n * 86400000);
  const prA = { id: "pr:a", category: "pr", earnedAt: day(-3).toISOString(), workoutId: "a", prs: [{ exerciseName: "Bench", valueKg: 100, prevKg: 95 }] } as Achievement;
  const prB = { id: "pr:b", category: "pr", earnedAt: day(0).toISOString(), workoutId: "b", prs: [{ exerciseName: "Squat", valueKg: 150, prevKg: 145 }] } as Achievement;
  const streak = detectStreakAchievement(14, day(-1))!;

  let state: AchievementsState = applyAchievements(EMPTY_ACHIEVEMENTS, [prA, streak], day(-1));
  state = applyAchievements(state, [prB], NOW);
  eq(state.cards.map(c => c.id).sort(), ["pr:b", streak.id].sort(), "cards: a new PR replaces the old PR card, other categories stay");

  const ids = new Set(["a", "b"]);
  eq(visibleAchievements(state, ids, NOW).map(c => c.id), ["pr:b", streak.id], "cards: newest first");
  eq(visibleAchievements(state, ids, day(8)).map(c => c.id), [], "cards: gone after a week");
  eq(visibleAchievements(state, new Set(["a"]), NOW).map(c => c.id), [streak.id],
    "cards: deleting the workout that set a PR hides its card");
  eq(applyAchievements(state, [], day(9)).cards, [], "cards: expired cards are pruned on the next write");
}

// ─── Notification headline + copy ───────────────────────────────────────────
{
  const onePR = { id: "pr:x", category: "pr", earnedAt: NOW.toISOString(), workoutId: "x", prs: [{ exerciseName: "Bench Press", valueKg: 100, prevKg: 97.5 }] } as Achievement;
  const pr = {
    ...onePR,
    prs: [
      { exerciseName: "Squat", valueKg: 150, prevKg: 145 },
      { exerciseName: "Bench Press", valueKg: 100, prevKg: 97.5 },
      { exerciseName: "Row", valueKg: 80, prevKg: 77.5 },
      { exerciseName: "Curl", valueKg: 30, prevKg: 27.5 },
    ],
  } as Achievement;
  const milestone = { id: "workouts:100", category: "workouts", earnedAt: NOW.toISOString(), workoutId: "x", count: 100 } as Achievement;
  eq(pickHeadline([pr, milestone])?.category, "workouts", "notify: a workout milestone outranks a PR");

  const kg = describeAchievement(onePR, true);
  eq([kg.title, kg.detail], ["New PR on Bench Press", "100 kg, up from 97.5 kg"], "copy: a single PR card in kg");
  eq(describeAchievement(onePR, false).detail.startsWith("220.5 lbs"), true, "copy: re-expressed in lbs, not frozen");

  const many = describeAchievement(pr, true);
  eq(many.title, "4 new PRs", "copy: several PRs are counted, not hidden behind \"plus N more\"");
  eq(many.detail, "Squat, Bench Press, Row, Curl", "copy: and the card names every exercise");
  eq(many.notifyBody, "Squat 150 kg, Bench Press 100 kg, Row 80 kg and 1 more.", "copy: the notification names three, then summarises");

  const all: Achievement[] = [
    pr,
    milestone,
    { id: "program:P:x", category: "program", earnedAt: NOW.toISOString(), programId: "P", programName: "PPL", totalWeeks: 1 },
    detectStreakAchievement(30, NOW)!,
  ];
  const text = all.flatMap(a => Object.values(describeAchievement(a, true))).join(" ");
  eq(/[–—]/.test(text), false, "copy: no em or en dashes anywhere");
  eq(describeAchievement(all[2], true).notifyBody, "You finished PPL. Great work.", "copy: a one-week program doesn't say \"all 1 week\"");
}

// ─── What one workout earned, for its own screen ────────────────────────────
// Measured against what came BEFORE it, as it was when saved live: a later,
// heavier session doesn't take its PR away, and it doesn't count itself.
{
  const at = (id: string, iso: string, kg: string): CompletedWorkout =>
    ({ ...workout([ex("Bench Press", [set(kg, "5")])], id), completedAt: iso });
  const first = at("a", "2026-09-01T10:00:00.000Z", "100");
  const pr = at("b", "2026-09-08T10:00:00.000Z", "105");
  const later = at("c", "2026-09-15T10:00:00.000Z", "110");
  const history = [later, pr, first];

  const earned = achievementsForWorkout(pr, history);
  eq(earned.map(a => (a.category === "pr" ? a.prs : a.category)),
    [[{ exerciseName: "Bench Press", valueKg: 105, prevKg: 100 }]],
    "forWorkout: its PR, against the sessions before it");
  eq(achievementsForWorkout(first, history), [], "forWorkout: a later, heavier session doesn't make the first one a PR");
  eq(earned[0]?.earnedAt, pr.completedAt, "forWorkout: earned when the workout was completed");
  eq(achievementsForWorkout({ ...pr, completedAt: "garbage" }, history), [], "forWorkout: an unreadable time earns nothing, rather than throwing");
  const nine = Array.from({ length: 9 }, (_, i) => at(`m${i}`, `2026-08-0${i + 1}T10:00:00.000Z`, "50"));
  eq(categories(achievementsForWorkout(first, [...nine, first])), ["pr", "workouts"],
    "forWorkout: the tenth workout shows its milestone (and beats the earlier 50s)");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ achievement rules hold");
