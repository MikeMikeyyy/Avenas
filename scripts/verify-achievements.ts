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
  prTrophySets,
  type PrSetInput,
  describeAchievement,
  detectProgramAchievement,
  detectStreakAchievement,
  detectWorkoutAchievements,
  pickHeadline,
  visibleAchievements,
  withMilestoneCardMoved,
  formatRepGain,
  formatRepPRLine,
  formatRepSet,
} from "../utils/achievements";
import { NO_REP_BESTS, repBestsBefore, repBestsBeforeEach, repPrSets, repPrSetsOfWorkout, type RepSetInput } from "../utils/repPrs";
import { computeSessionRecords } from "../utils/workoutSummary";
import { exerciseIdentity } from "../utils/exerciseNames";
import { isAssisted, isAssistedIdentity, noteAssistedCustoms } from "../utils/assisted";

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
  eq(categories(detectWorkoutAchievements(workout([ex("Bench Press", [set("100", "8")])]), prior, EMPTY_ACHIEVEMENTS, NOW)), ["reps"],
    "PR: more reps at the same weight (a higher estimated 1RM) is not a PR, but a rep PR (utils/repPrs.ts)");
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
  // One trophy per exercise a session (prTrophySets): the first set at the
  // session's heaviest new weight.
  const bp = exerciseIdentity({ name: "Bench Press" });
  const sq = exerciseIdentity({ name: "Squat" });
  const lift = (weightKg: number, extra: Partial<PrSetInput> = {}): PrSetInput => ({ type: "working", done: true, reps: "3", weightKg, ...extra });
  const worn = (...exercises: [string, PrSetInput[]][]) =>
    prTrophySets(exercises.map(([identity, sets]) => ({ identity, sets })), id => best.get(id));
  eq(worn([bp, [lift(102.5), lift(102.5)]]), [[true, false]], "trophy: the first to lift the new best wears it; the same again only matches it");
  eq(worn([bp, [lift(102.5), lift(105)]]), [[false, true]], "trophy: a heavier set later takes it from the first");
  eq(worn([bp, [lift(105), lift(102.5)]]), [[true, false]], "trophy: a lighter PR after the record doesn't take it");
  eq(worn([bp, [lift(102.5), lift(110, { done: false }), lift(107.5, { reps: "" }), lift(120, { type: "warmup" })]]), [[true, false, false, false]],
    "trophy: an unticked, rep-less or warm-up set never takes it");
  eq(worn([bp, [lift(102.5)]], [sq, [lift(145)]]), [[true], [true]], "trophy: one for each exercise");
  eq(worn([bp, [lift(102.5)]], [sq, [lift(145)]], [bp, [lift(105)]]), [[false], [true], [true]],
    "trophy: an exercise on two cards is one, and the heavier card's set wears it");
  eq(worn([bp, [lift(102.5)]], [bp, [lift(102.5)]]), [[true], [false]], "trophy: across two cards at the same weight, the earlier one");
  eq(worn([bp, [lift(100), lift(95)]]), [[false, false]], "trophy: none when nothing beat the best");
  eq(worn(["", [lift(500)]]), [[false]], "trophy: no exercise, no trophy");

  // The trophy and the PR card agree: a session earns the card exactly when one
  // of its sets wears the trophy.
  const sessions = [["102.5", "3"], ["100", "8"], ["95", "10"], ["120", ""]] as const;
  for (const [w, r] of sessions) {
    const s = workout([ex("Bench Press", [set(w, r)])]);
    const card = detectWorkoutAchievements(s, prior, EMPTY_ACHIEVEMENTS, NOW).some(a => a.category === "pr");
    const trophy = worn([bp, s.exercises[0].sets.map(x => ({ ...x, weightKg: parseFloat(x.weight) || 0 }))]).flat().some(Boolean);
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
  const twice = on("s6", "2026-09-10T10:00:00.000Z", [set("102.5", "5"), set("102.5", "4")]);
  const climb = on("s7", "2026-09-10T10:00:00.000Z", [set("102.5", "5"), set("104", "3")]);
  eq(prSetsOfWorkout(twice, [before, twice]), [[true, false]], "saved: the new best twice, the first one wears it");
  eq(prSetsOfWorkout(climb, [before, climb]), [[false, true]], "saved: a heavier set later wears it, not the first");

  // The Exercise History page works every session's best out in one pass
  // (bestBeforeEach): the same trophies as each session's Journal page.
  const sameMoment = on("s4", later.completedAt, [set("112.5", "1")]);
  const unreadable = on("s5", "garbage", [set("120", "1")]);
  const all = [later, saved, before, sameMoment, unreadable];
  const each = bestBeforeEach(all, exerciseIdentity({ name: "Bench Press" }));
  eq([each.get("s1"), each.get("s2"), each.get("s3"), each.get("s4"), each.get("s5")], [undefined, 100, 102.5, 102.5, undefined],
    "each: nothing before the first; finished together, neither counts the other; an unreadable time has none and counts for none");
  for (const w of all) {
    const page = prTrophySets([{ identity: bp, sets: w.exercises[0].sets.map(x => ({ ...x, weightKg: parseFloat(x.weight) || 0 })) }], () => each.get(w.id))[0];
    eq(page, prSetsOfWorkout(w, all)[0], `each ${w.id}: the history page's trophies are its Journal page's`);
  }
}

// ─── Assisted exercises: less help is the record (utils/assisted.ts) ────────
{
  const on = (id: string, completedAt: string, name: string, sets: CompletedSet[], customId?: string): CompletedWorkout =>
    ({ ...workout([{ ...ex(name, sets), ...(customId ? { customId } : {}) }], id), completedAt });
  const ap = exerciseIdentity({ name: "Assisted Pull-Up" });
  eq(isAssistedIdentity(ap), true, "assisted: the catalogue's Assisted Pull-Up is");
  eq(isAssisted({ name: "assisted pull-up" }), true, "assisted: by its name in any case");
  eq(isAssisted({ name: "Assisted Dip" }), true, "assisted: the catalogue's Assisted Dip is");
  eq(isAssisted({ name: "Pull-Up" }), false, "assisted: a plain pull-up isn't");
  eq(isAssisted({ name: "Suspension Assisted Squat" }), false, "assisted: a strap squat isn't (no counterweight)");

  const first = on("a1", "2026-09-01T10:00:00.000Z", "Assisted Pull-Up", [set("40", "8"), set("35", "6")]);
  const prior = [first];
  const best = bestLiftsBefore(prior);
  eq(best.get(ap), 35, "assisted best: the least help, not the most");

  const lift = (weightKg: number, extra: Partial<PrSetInput> = {}): PrSetInput => ({ type: "working", done: true, reps: "5", weightKg, ...extra });
  eq(isPrSet(lift(30), 35, true), true, "assisted trophy: less help than the best");
  eq(isPrSet(lift(40), 35, true), false, "assisted trophy: more help is never a PR (the bug: a heavier set got it)");
  eq(isPrSet(lift(35), 35, true), false, "assisted trophy: a tie isn't");
  eq(isPrSet(lift(0), 35, true), false, "assisted trophy: no weight typed isn't a PR");
  const worn = (sets: PrSetInput[]) => prTrophySets([{ identity: ap, sets }], id => best.get(id));
  eq(worn([lift(30), lift(25)]), [[false, true]], "assisted trophy: the least help that session wears it");
  eq(worn([lift(25), lift(30)]), [[true, false]], "assisted trophy: more help after the record doesn't take it");
  eq(worn([lift(45), lift(50)]), [[false, false]], "assisted trophy: none when every set needed more help");

  // The PR card: less help, and it says so.
  const better = on("a2", "2026-09-08T10:00:00.000Z", "Assisted Pull-Up", [set("30", "6")]);
  const heavier = on("a3", "2026-09-08T10:00:00.000Z", "Assisted Pull-Up", [set("50", "10")]);
  const card = detectWorkoutAchievements(better, prior, EMPTY_ACHIEVEMENTS, NOW);
  eq(categories(card), ["pr"], "assisted card: less help than ever is a PR");
  if (card[0]?.category === "pr") {
    eq(card[0].prs, [{ exerciseName: "Assisted Pull-Up", valueKg: 30, prevKg: 35 }], "assisted card: records the new and beaten help");
    eq(describeAchievement(card[0], true).detail, "30 kg assistance, down from 35 kg", "assisted card: reads as help coming down");
  }
  eq(categories(detectWorkoutAchievements(heavier, prior, EMPTY_ACHIEVEMENTS, NOW)), [], "assisted card: more help is no PR");
  eq(prSetsOfWorkout(better, [first, better]), [[true]], "assisted saved: the Journal page's trophy");
  eq(prSetsOfWorkout(heavier, [first, heavier]), [[false]], "assisted saved: no trophy on more help");
  const each = bestBeforeEach([first, better, heavier], ap);
  eq([each.get("a1"), each.get("a2")], [undefined, 35], "assisted each: the history page's best before is the least help");

  // A custom exercise with its Assisted switch on, and then off again: all its
  // sessions read the new way, never half of them.
  const custom = { id: "cx_gravitron", name: "Gravitron", muscles: ["Back" as const], assisted: true };
  const g1 = on("g1", "2026-09-01T10:00:00.000Z", "Gravitron", [set("40", "8")], custom.id);
  const g2 = on("g2", "2026-09-08T10:00:00.000Z", "Gravitron", [set("30", "8")], custom.id);
  noteAssistedCustoms("own", [custom]);
  eq(prSetsOfWorkout(g2, [g1, g2]), [[true]], "custom assisted: less help is its PR");
  noteAssistedCustoms("own", [{ ...custom, assisted: false }]);
  eq(prSetsOfWorkout(g2, [g1, g2]), [[false]], "custom switched off: reads as weight again");
  // Your own definition wins over one carried with a program.
  noteAssistedCustoms("carried", [custom]);
  eq(isAssisted({ name: "Gravitron", customId: custom.id }), false, "custom: your own switch wins over a carried copy");
  noteAssistedCustoms("own", []);
  eq(isAssisted({ name: "Gravitron", customId: custom.id }), true, "custom: a carried one is read by its own switch");
  noteAssistedCustoms("carried", []);
  // Back to normal for the bench press: nothing above changed its direction.
  eq(isPrSet(lift(110), 100), true, "normal: heavier is still a PR");
}

// ─── Rep PRs (utils/repPrs.ts; user request, 2026-11-14) ────────────────────
{
  const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
  const sess = (id: string, d: number, exercises: CompletedWorkout["exercises"]): CompletedWorkout =>
    ({ id, date: day(d), completedAt: `${day(d)}T10:00:00.000Z`, workoutName: "Push", durationSeconds: 0, exercises });
  const warmSet = (weight: string, reps: string): CompletedSet => ({ type: "warmup", weight, reps, done: true });
  const hold = (name: string, sets: CompletedSet[]) => ({ ...ex(name, sets), isIsometric: true as const });
  const bench = (...sets: CompletedSet[]) => ex("Bench Press", sets);
  const lift = (weightKg: number, reps: string, extra: Partial<RepSetInput> = {}): RepSetInput =>
    ({ type: "working", done: true, reps, weightKg, ...extra });
  const bp = exerciseIdentity({ name: "Bench Press" });
  const prior = [sess("r1", 1, [bench(set("80", "8"), set("85", "6"), set("100", "3"))])];
  const bests = repBestsBefore(prior);
  const medal = (sets: RepSetInput[]) => repPrSets([{ identity: bp, hold: false, sets }], bests)[0];

  // The rule.
  eq(medal([lift(80, "9")]), [true], "rep PR: more reps at a weight done before");
  eq(medal([lift(85, "7")]), [true], "rep PR: 85 × 7 beats 85 × 6");
  eq(medal([lift(80, "8")]), [false], "rep PR: the same reps is a tie, no record");
  eq(medal([lift(80, "6")]), [false], "rep PR: fewer reps isn't one");
  const twelve = repBestsBefore([sess("r2", 1, [bench(set("80", "12"), set("60", "10"))])]);
  eq(repPrSets([{ identity: bp, hold: false, sets: [lift(60, "12")] }], twelve), [[false]],
    "rep PR: 60 × 12 isn't, after 80 × 12 (as many reps with more on the bar)");
  eq(repPrSets([{ identity: bp, hold: false, sets: [lift(60, "13")] }], twelve), [[true]],
    "rep PR: 60 × 13 is, after 80 × 12 and 60 × 10");
  eq(medal([lift(90, "5")]), [false], "rep PR: a weight never done (90, under the best) is neither");
  eq(medal([lift(102.5, "5")]), [false], "rep PR: heavier than ever is the trophy's, never the medal's");
  eq(medal([lift(80, "9", { type: "warmup" })]), [false], "rep PR: never a warm-up");
  eq(medal([lift(80, "9", { done: false })]), [false], "rep PR: only once it's ticked");
  eq(medal([lift(80, "")]), [false], "rep PR: not without reps");
  eq(medal([lift(80.014, "9")]), [true], "rep PR: 176.4 lbs (80.014 kg) is the same weight as 80 kg");
  eq(medal([lift(80.05, "9")]), [false], "rep PR: 80.05 kg is another weight, never done");

  // One per exercise, the records the session leaves.
  eq(medal([lift(80, "9"), lift(80, "10")]), [false, true], "rep PR one each: the most reps at the weight");
  eq(medal([lift(80, "10"), lift(80, "9")]), [true, false], "rep PR one each: fewer after it doesn't take it");
  eq(medal([lift(80, "9"), lift(80, "9")]), [true, false], "rep PR one each: the first of two the same");
  eq(medal([lift(80, "12"), lift(85, "7")]), [false, true], "rep PR one each: the heavier, though the lighter beat its best by more");
  eq(medal([lift(80, "9"), lift(85, "9")]), [false, true], "rep PR: 85 × 9 later beats 80 × 9, and is one itself");
  eq(medal([lift(80, "9"), lift(102.5, "9")]), [false, false],
    "rep PR: a weight PR with as many reps leaves 80 × 9 no record (only the trophy)");
  eq(medal([lift(80, "9"), lift(102.5, "3")]), [true, false], "rep PR: a weight PR with fewer reps leaves it its own");
  eq(repPrSets([{ identity: bp, hold: false, sets: [lift(80, "9")] }, { identity: bp, hold: false, sets: [lift(80, "10")] }], bests),
    [[false], [true]], "rep PR: an exercise on two cards is one");
  eq(repPrSets([{ identity: "", hold: false, sets: [lift(80, "20")] }], bests), [[false]], "rep PR: no exercise, none");

  // Bodyweight is a weight like any other.
  const pu = exerciseIdentity({ name: "Push-Up" });
  const pushPrior = [sess("b1", 1, [ex("Push-Up", [set("", "20"), set("", "22")])])];
  const pushBests = repBestsBefore(pushPrior);
  eq(repPrSets([{ identity: pu, hold: false, sets: [lift(0, "25")] }], pushBests), [[true]], "rep PR bodyweight: 25 push-ups after 22");
  eq(repPrSets([{ identity: pu, hold: false, sets: [lift(0, "22")] }], pushBests), [[false]], "rep PR bodyweight: 22 again isn't");
  const pl = exerciseIdentity({ name: "Pull-Up" });
  const pullBests = repBestsBefore([sess("p1", 1, [ex("Pull-Up", [set("", "10"), set("5", "12")])])]);
  eq(repPrSets([{ identity: pl, hold: false, sets: [lift(0, "11")] }], pullBests), [[false]],
    "rep PR bodyweight: 11 isn't, after 12 with 5 kg on");
  eq(repPrSets([{ identity: pl, hold: false, sets: [lift(0, "13")] }], pullBests), [[true]], "rep PR bodyweight: 13 is");

  // A hold's seconds, kept apart from reps.
  const pk = exerciseIdentity({ name: "Plank" });
  const plankPrior = [sess("h1", 1, [hold("Plank", [set("", "45")])])];
  const plankBests = repBestsBefore(plankPrior);
  eq(repPrSets([{ identity: pk, hold: true, sets: [lift(0, "60")] }], plankBests), [[true]], "hold PR: a longer hold at the same weight");
  eq(repPrSets([{ identity: pk, hold: false, sets: [lift(0, "60")] }], plankBests), [[false]], "hold PR: seconds held aren't reps");

  // Assisted: more reps at the same help, beating every set at that help or less.
  const ap = exerciseIdentity({ name: "Assisted Pull-Up" });
  eq(isAssistedIdentity(ap), true, "assisted rep PR: (the catalogue's assisted pull-up)");
  const assistedBests = repBestsBefore([sess("a1", 1, [ex("Assisted Pull-Up", [set("30", "8"), set("20", "6"), set("40", "10")])])]);
  const am = (sets: RepSetInput[]) => repPrSets([{ identity: ap, hold: false, sets }], assistedBests)[0];
  eq(am([lift(30, "9")]), [true], "assisted rep PR: more reps at the same help");
  eq(am([lift(40, "10")]), [false], "assisted rep PR: 40 × 10 again is a tie");
  eq(am([lift(40, "11")]), [true], "assisted rep PR: 40 × 11, more than any set at that help or less");
  eq(am([lift(30, "8")]), [false], "assisted rep PR: 30 × 8 again is a tie");
  eq(am([lift(0, "12")]), [false], "assisted rep PR: no help typed counts for nothing");
  eq(am([lift(30, "9"), lift(20, "9")]), [false, true], "assisted rep PR: 20 × 9 (less help) beats 30 × 9, and is one");

  // Saved workouts (the Journal page), and Exercise History agreeing with them.
  const s1 = sess("x1", 1, [bench(set("80", "8"))]);
  const s2 = sess("x2", 8, [bench(warmSet("60", "12"), set("80", "9"), set("80", "9"))]);
  const s3 = sess("x3", 15, [bench(set("80", "10"))]);
  const t1 = sess("t1", 20, [bench(set("80", "11"))]);
  const t2 = sess("t2", 20, [bench(set("80", "12"))]);
  const all = [t2, s3, s1, t1, s2];
  eq(repPrSetsOfWorkout(s2, all), [[false, true, false]], "rep saved: against the sessions before it, the first of the two");
  eq(repPrSetsOfWorkout(s3, all), [[true]], "rep saved: the next session's 10 beats it, and a later one never takes it away");
  eq(repPrSetsOfWorkout(s1, all), [[false]], "rep saved: the first session has nothing to beat");
  eq(repPrSetsOfWorkout(t2, all), [[true]], "rep saved: a session at the same moment isn't before it");
  eq(repPrSetsOfWorkout({ ...s3, completedAt: "not a date" }, all), [[false]], "rep saved: no readable time, nothing before it");
  const eachBefore = repBestsBeforeEach(all, bp);
  for (const s of all) {
    const sets = s.exercises[0].sets.map(x => ({ type: x.type, done: x.done, reps: x.reps, weightKg: parseFloat(x.weight) || 0 }));
    eq(repPrSets([{ identity: bp, hold: false, sets }], eachBefore.get(s.id) ?? NO_REP_BESTS), repPrSetsOfWorkout(s, all),
      `rep each: Exercise History's medals are the Journal page's on ${s.id}`);
  }

  // The summary's records.
  const c1 = sess("c1", 8, [bench(set("80", "9"))]);
  const c1Records = computeSessionRecords(c1, prior).filter(r => r.kind === "reps");
  eq(c1Records, [{ exerciseName: "Bench Press", kind: "reps", valueKg: 80, prevKg: 80, reps: 9, prevReps: 8 }],
    "summary: a rep PR is a record, at its weight, with what it beat");
  const c2 = sess("c2", 8, [bench(set("80", "9"), set("102.5", "2"))]);
  eq(computeSessionRecords(c2, prior).filter(r => r.kind === "heaviest" || r.kind === "reps").map(r => r.kind), ["heaviest", "reps"],
    "summary: a weight PR and a rep PR in one session are both records, the weight's first");
  eq(computeSessionRecords(sess("c3", 8, [ex("Push-Up", [set("", "25")])]), pushPrior).map(r => r.kind), ["reps"],
    "summary: a bodyweight rep PR is a record, where there's no weight to have one");
  const holdRecord = computeSessionRecords(sess("c4", 8, [hold("Plank", [set("", "60")])]), plankPrior);
  eq(holdRecord.map(r => [r.kind, r.hold, r.reps, r.prevReps]), [["reps", true, 60, 45]], "summary: a hold PR, in seconds");

  // Home's card: rep PRs only when the session set no weight PR, and quietly.
  const card = detectWorkoutAchievements(c1, prior, EMPTY_ACHIEVEMENTS, NOW);
  eq(categories(card), ["reps"], "rep card: a session of rep PRs alone earns the rep card");
  if (card[0]?.category === "reps") {
    eq(card[0].repPrs, [{ exerciseName: "Bench Press", weightKg: 80, reps: 9, prevReps: 8 }], "rep card: the set and what it beat");
    eq(describeAchievement(card[0], true).title, "New rep PR on Bench Press", "rep card: its title");
    eq(describeAchievement(card[0], true).detail, "9 reps at 80 kg, up from 8", "rep card: its line");
    eq(describeAchievement(card[0], false).detail, "9 reps at 176.4 lbs, up from 8", "rep card: in pounds");
  }
  eq(categories(detectWorkoutAchievements(c2, prior, EMPTY_ACHIEVEMENTS, NOW)), ["pr"],
    "rep card: a session with a weight PR is the weight PR's card alone");
  const many = detectWorkoutAchievements(sess("c5", 8, [bench(set("85", "7")), hold("Plank", [set("", "60")])]), [...prior, ...plankPrior], EMPTY_ACHIEVEMENTS, NOW);
  eq(categories(many), ["reps"], "rep card: several rep PRs are one card");
  if (many[0]?.category === "reps") {
    const copy = describeAchievement(many[0], true);
    eq([copy.title, copy.detail], ["2 new rep PRs", "Bench Press, Plank"], "rep card: counted and named");
    eq(formatRepPRLine(many[0].repPrs[1], true), "60 s, up from 45 s", "rep card: a hold's line");
  }
  eq(pickHeadline(many), null, "rep card: never a notification");
  const fillers = Array.from({ length: 8 }, (_, i) => sess(`f${i}`, 2 + i, [ex("Row", [set("50", "10")])]));
  const tenth = detectWorkoutAchievements(sess("c6", 12, [bench(set("80", "9"))]), [...prior, ...fillers], EMPTY_ACHIEVEMENTS, NOW);
  eq([categories(tenth), pickHeadline(tenth)?.category], [["reps", "workouts"], "workouts"], "rep card: beside a milestone, the milestone is the notification");
  const withPr = applyAchievements(EMPTY_ACHIEVEMENTS, detectWorkoutAchievements(sess("c7", 3, [bench(set("102.5", "1"))]), prior, EMPTY_ACHIEVEMENTS, NOW), NOW);
  const thenReps = applyAchievements(withPr, card, NOW);
  eq(thenReps.cards.map(c => c.category).sort(), ["pr", "reps"], "rep card: a card of its own, never in place of a weight PR's");

  // The words.
  eq(formatRepPRLine({ weightKg: 30, reps: 9, prevReps: 8, assisted: true }, true), "9 reps with 30 kg assistance, up from 8", "rep line: assisted");
  eq(formatRepPRLine({ weightKg: 0, reps: 25, prevReps: 22 }, true), "25 reps, up from 22", "rep line: bodyweight");
  eq(formatRepPRLine({ weightKg: 20, reps: 60, prevReps: 45, hold: true }, true), "60 s at 20 kg, up from 45 s", "rep line: a weighted hold");
  eq([formatRepSet({ weightKg: 80, reps: 9 }, true), formatRepSet({ weightKg: 0, reps: 25 }, true), formatRepSet({ weightKg: 0, reps: 60, hold: true }, true), formatRepSet({ weightKg: 20, reps: 60, hold: true }, true)],
    ["80 kg × 9", "25 reps", "60 s", "20 kg, 60 s"], "rep set: short, beside its record");
  eq([formatRepGain({ reps: 9, prevReps: 8 }), formatRepGain({ reps: 12, prevReps: 10 }), formatRepGain({ reps: 60, prevReps: 45, hold: true })],
    ["1 rep", "2 reps", "15 s"], "rep gain: by how much");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ achievement rules hold");
