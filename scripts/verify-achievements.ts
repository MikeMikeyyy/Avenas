// What earns an achievement, and how the Home cards replace and expire.
//
// Run:  npx tsx scripts/verify-achievements.ts
// Exits non-zero if any assertion fails.

import type { CompletedSet, CompletedWorkout, SavedProgram } from "../constants/programs";
import { EMPTY_ACHIEVEMENTS, type Achievement, type AchievementsState } from "../constants/achievements";
import {
  achievementsForWorkout,
  applyAchievements,
  bestBeforeEach,
  bestLiftsBefore,
  isPrSet,
  prSetsOfWorkout,
  describeAchievement,
  detectProgramAchievement,
  detectStreakAchievement,
  detectWorkoutAchievements,
  pickHeadline,
  visibleAchievements,
  withMilestoneCardMoved,
} from "../utils/achievements";
import { exerciseIdentity } from "../utils/exerciseNames";

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

// ─── Delete, redo, delete: the milestone's card follows the redo ────────────
// (user request, 2026-10-16) Announced once, but its card went with the
// deleted session and never came back on the redo.
{
  const nine = Array.from({ length: 9 }, () => workout([ex("Row", [set("50", "10")])]));
  const tenth = workout([], "tenth");
  let state = applyAchievements(EMPTY_ACHIEVEMENTS, detectWorkoutAchievements(tenth, nine, EMPTY_ACHIEVEMENTS, NOW), NOW);
  const shown = (s: AchievementsState, ids: string[]) =>
    visibleAchievements(s, new Set(ids), NOW).filter(c => c.category === "workouts").map(c => ("workoutId" in c ? c.workoutId : ""));
  const nineIds = nine.map(w => w.id);
  eq(shown(state, [...nineIds, "tenth"]), ["tenth"], "redo: the 10th's card");
  eq(shown(state, nineIds), [], "redo: deleted, its card goes with it");

  const redo = workout([], "redo");
  eq(detectWorkoutAchievements(redo, nine, state, NOW), [], "redo: nothing announced again");
  state = withMilestoneCardMoved(state, redo, nine);
  eq(shown(state, [...nineIds, "redo"]), ["redo"], "redo: done again, the card is back, on the redo");
  eq(state.awarded, ["workouts:10"], "redo: still awarded once");

  eq(shown(state, nineIds), [], "redo: deleted again, gone again");
  const again = workout([], "again");
  state = withMilestoneCardMoved(state, again, nine);
  eq(shown(state, [...nineIds, "again"]), ["again"], "redo: and back again on the next redo");

  // A card whose session is still there stays put, and an older session
  // deleted doesn't hand it to the next one.
  const tenAll = [...nine.slice(1), again];
  eq(withMilestoneCardMoved(state, workout([], "eleventh"), tenAll), state, "redo: a card on a session still there stays put");
  eq(withMilestoneCardMoved(state, workout([], "x"), nine.slice(1)), state, "redo: a different count leaves the card alone");
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
  eq(detectStreakAchievement(9, NOW), null, "streak: 9 days is not a milestone");
  eq(detectStreakAchievement(10, NOW)?.category, "streak", "streak: 10 days is");
  const first = detectStreakAchievement(10, NOW)!;
  const state = applyAchievements(EMPTY_ACHIEVEMENTS, [first], NOW);
  eq(state.awarded, [], "streak: not once-only, so a rebuilt streak earns it again");

  // Every 10 days up to 50, then every 50 for as long as the streak runs (user
  // decision, 2026-10-02). It was 7, 14 and 30 then the 50s, and a 14-day card
  // read as an odd number to celebrate. The list once stopped at 365, and the
  // longest streaks earned nothing after it.
  const earnedAt = (days: number): number | null => {
    const a = detectStreakAchievement(days, NOW);
    return a && a.category === "streak" ? a.days : null;
  };
  for (const days of [10, 20, 30, 40, 50, 100, 150, 200, 250, 400, 1000]) {
    eq(earnedAt(days), days, `streak: ${days} days is a milestone`);
  }
  for (const days of [0, 1, 7, 14, 25, 49, 51, 60, 70, 90, 99, 149, 365]) {
    eq(detectStreakAchievement(days, NOW), null, `streak: ${days} days is not`);
  }
}

// ─── Cards: one per category, newest replaces, a week long ──────────────────
{
  const day = (n: number) => new Date(NOW.getTime() + n * 86400000);
  const prA = { id: "pr:a", category: "pr", earnedAt: day(-3).toISOString(), workoutId: "a", prs: [{ exerciseName: "Bench", valueKg: 100, prevKg: 95 }] } as Achievement;
  const prB = { id: "pr:b", category: "pr", earnedAt: day(0).toISOString(), workoutId: "b", prs: [{ exerciseName: "Squat", valueKg: 150, prevKg: 145 }] } as Achievement;
  const streak = detectStreakAchievement(20, day(-1))!;

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

// ─── The trophy beside a set (the Workout tab) ───────────────────────────────
{
  const warm = (weight: string, reps: string): CompletedSet => ({ type: "warmup", weight, reps, done: true });
  const prior = [
    workout([ex("Bench Press", [set("100", "5"), set("110", "1", false), set("105", "")])]),
    workout([ex("Push-up", [set("", "20")]), ex("Squat", [warm("150", "3"), set("140", "5")])]),
  ];
  const best = bestLiftsBefore(prior);
  eq(best.get(exerciseIdentity({ name: "Bench Press" })), 100,
    "best: a ticked working set with reps (not the unticked 110, not the 105 with no reps)");
  eq(best.get(exerciseIdentity({ name: "Squat" })), 140, "best: a warm-up never counts");
  eq(best.has(exerciseIdentity({ name: "Push-up" })), false, "best: bodyweight only has none");
  eq(best.has(exerciseIdentity({ name: "Deadlift" })), false, "best: never done has none");

  const bench = best.get(exerciseIdentity({ name: "Bench Press" }));
  const pr = (weightKg: number, extra: Partial<{ type: "warmup" | "working"; done: boolean; reps: string }> = {}) =>
    isPrSet({ type: "working", done: true, reps: "3", weightKg, ...extra }, bench);
  eq(pr(102.5), true, "trophy: ticked, heavier than the best");
  eq(pr(100), false, "trophy: a tie isn't a PR");
  eq(pr(102.5, { done: false }), false, "trophy: only once it's ticked");
  eq(pr(102.5, { reps: "" }), false, "trophy: not without reps");
  eq(pr(102.5, { type: "warmup" }), false, "trophy: never a warm-up");
  eq(isPrSet({ type: "working", done: true, reps: "5", weightKg: 60 }, undefined), false,
    "trophy: no best before (a first time, or bodyweight only) is no PR");
  eq([pr(102.5), pr(105)], [true, true], "trophy: two sets over the old best both get one");

  // The trophy and the PR card agree: a session earns the card exactly when one
  // of its sets would wear the trophy.
  const sessions = [["102.5", "3"], ["100", "8"], ["95", "10"], ["120", ""]] as const;
  for (const [w, r] of sessions) {
    const s = workout([ex("Bench Press", [set(w, r)])]);
    const card = detectWorkoutAchievements(s, prior, EMPTY_ACHIEVEMENTS, NOW).some(a => a.category === "pr");
    const trophy = s.exercises[0].sets.some(x => isPrSet({ ...x, weightKg: parseFloat(x.weight) || 0 }, bench));
    eq(trophy, card, `trophy and PR card agree on ${w} × ${r || "no reps"}`);
  }

  // A saved workout (the Journal's page, the Workout tab's finished session).
  const on = (id: string, completedAt: string, sets: CompletedSet[]): CompletedWorkout =>
    ({ ...workout([ex("Bench Press", sets)], id), completedAt });
  const before = on("s1", "2026-09-01T10:00:00.000Z", [set("100", "5")]);
  const saved = on("s2", "2026-09-08T10:00:00.000Z", [warm("60", "10"), set("100", "5"), set("102.5", "3"), set("105", "1", false)]);
  const later = on("s3", "2026-09-15T10:00:00.000Z", [set("110", "2")]);
  const history = [later, saved, before];
  eq(prSetsOfWorkout(saved, history), [[false, false, true, false]],
    "saved: the 102.5 wears it; the warm-up, the tie and the unticked 105 don't");
  eq(prSetsOfWorkout(later, history), [[true]], "saved: the later 110 beat both before it");
  eq(prSetsOfWorkout(before, history), [[false]], "saved: the first-ever session has nothing to beat");
  eq(prSetsOfWorkout({ ...saved, completedAt: "garbage" }, history), [[false, false, false, false]],
    "saved: an unreadable time has nothing before it, so no trophies");
  for (const w of history) {
    eq(prSetsOfWorkout(w, history).flat().some(Boolean), achievementsForWorkout(w, history).some(a => a.category === "pr"),
      `saved ${w.id}: a trophy exactly when its Journal page shows the PR card`);
  }

  // The Exercise History page works every session's best out in one pass
  // (bestBeforeEach): the same trophies as each session's Journal page.
  const sameMoment = on("s4", later.completedAt, [set("112.5", "1")]);
  const unreadable = on("s5", "garbage", [set("120", "1")]);
  const all = [later, saved, before, sameMoment, unreadable];
  const each = bestBeforeEach(all, exerciseIdentity({ name: "Bench Press" }));
  eq([each.get("s1"), each.get("s2"), each.get("s3"), each.get("s4"), each.get("s5")], [undefined, 100, 102.5, 102.5, undefined],
    "each: nothing before the first; finished together, neither counts the other; an unreadable time has none and counts for none");
  for (const w of all) {
    const page = w.exercises[0].sets.map(x => isPrSet({ ...x, weightKg: parseFloat(x.weight) || 0 }, each.get(w.id)));
    eq(page, prSetsOfWorkout(w, all)[0], `each ${w.id}: the history page's trophies are its Journal page's`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ achievement rules hold");
