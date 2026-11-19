// Supersets (utils/supersets.ts; user request, 2026-11-15): what makes one,
// joining, leaving and moving keeping them whole, the session's order in
// rounds (utils/nextSet.ts), the rest only after a round (the Workout tab's
// tick and the lock screen's queue, utils/liveActivity.ts), and what a session
// saves (utils/unfinishedSession.ts completedExercises), the builder keeps
// (utils/programDays.ts canonicalizeWorkouts) and Log Workout opens and saves
// (utils/logWorkout.ts).
//
// Run:  npx tsx scripts/verify-supersets.ts
// Exits non-zero if any assertion fails.

import {
  blocksOf, cleanSupersets, cleanSupersetsIn, joinSuperset, leaveSuperset, moveKeepingSupersets, namesList,
  restAfterSet, runOf, setsInSessionOrder, supersetChoicesFor, supersetIdsOf, supersetLines, supersetPlaces, supersetRuns,
} from "../utils/supersets";
import { nextSetOf, pendingSetsInOrder } from "../utils/nextSet";
import { buildLiveActivityQueue } from "../utils/liveActivity";
import { completedExercises } from "../utils/unfinishedSession";
import { canonicalizeWorkouts } from "../utils/programDays";
import { logExercisesFor, loggedExercises } from "../utils/logWorkout";
import type { Exercise, WorkoutMap } from "../constants/programs";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

type Ex = { id: string; name: string; supersetId?: string; restSeconds?: number };
const ex = (id: string, supersetId?: string, restSeconds?: number): Ex =>
  ({ id, name: id, ...(supersetId ? { supersetId } : {}), ...(restSeconds !== undefined ? { restSeconds } : {}) });
/** The list as "A B(s) C(s)": each id, with its superset id in brackets. */
const show = (list: readonly Ex[]) => list.map(e => (e.supersetId ? `${e.id}(${e.supersetId})` : e.id)).join(" ");
/** A new superset's id, the same every time so each line can say it. */
const fresh = () => "x";

// ─── What makes a superset: 2+ side by side with one id ─────────────────────
{
  const list = [ex("A"), ex("B", "s"), ex("C", "s"), ex("D"), ex("E", "t"), ex("F", "s")];
  eq(supersetRuns(list), [[1, 2]], "runs: B and C side by side; E alone and F apart from its partners aren't");
  eq(blocksOf(list), [[0], [1, 2], [3], [4], [5]], "blocks: the superset is one, every other exercise its own");
  eq(supersetPlaces(list), [null, "first", "last", null, null, null], "places: first and last of the superset");
  eq(supersetIdsOf(list), [undefined, "s", "s", undefined, undefined, undefined], "ids: only a real superset's");
  eq(show(cleanSupersets(list)), "A B(s) C(s) D E F", "clean: the lone ids dropped");
  const tidy = [ex("A"), ex("B", "s"), ex("C", "s")];
  eq(cleanSupersets(tidy) === tidy, true, "clean: nothing to drop, the same list back");
  eq(supersetRuns([ex("A", "s"), ex("B", "s"), ex("C", "s")]), [[0, 1, 2]], "runs: three side by side are one (a giant set)");
  eq(supersetRuns([ex("A", "s"), ex("B", "t"), ex("C", "t")]), [[1, 2]], "runs: a new id starts a new one");
  eq(supersetRuns([ex("A", " "), ex("B", " ")]), [], "runs: a blank id is none");
  eq(runOf(list, 2), [1, 2], "runOf: its superset");
  eq(runOf(list, 3), null, "runOf: none");
  const map = { "0:Push": [ex("A", "s")], "1:Pull": tidy };
  const cleaned = cleanSupersetsIn(map);
  eq([show(cleaned["0:Push"]), cleaned["1:Pull"] === tidy], ["A", true], "clean in: day by day, an untouched day kept");
  const same = { "1:Pull": tidy };
  eq(cleanSupersetsIn(same) === same, true, "clean in: nothing to drop, the same map back");
}

// ─── Joining ────────────────────────────────────────────────────────────────
{
  const list = [ex("A", undefined, 90), ex("B", undefined, 60), ex("C", undefined, 120), ex("D", undefined, 45)];
  eq(show(joinSuperset(list, 0, 2, fresh)), "A(x) C(x) B D", "join: the one picked comes to just after it");
  eq(joinSuperset(list, 0, 2, fresh).map(e => e.restSeconds), [90, 90, 60, 45], "join: and takes its rest, the superset's");
  eq(show(joinSuperset(list, 2, 0, fresh)), "B C(x) A(x) D", "join: picking one above moves it down after it");
  const pair = [ex("A", "s", 90), ex("B", "s", 90), ex("C", undefined, 30), ex("D")];
  eq(show(joinSuperset(pair, 0, 3, fresh)), "A(s) B(s) D(s) C", "join: a third goes after the superset's last");
  eq(joinSuperset(pair, 1, 3, fresh).map(e => e.restSeconds), [90, 90, 90, 30], "join: every member the superset's rest, the rest their own");
  eq(show(joinSuperset(pair, 0, 1, fresh)), "A(s) B(s) C D", "join: already in it, nothing changes");
  const two = [ex("A", "s"), ex("B", "s"), ex("C", "t"), ex("D", "t")];
  eq(show(joinSuperset(two, 0, 3, fresh)), "A(s) B(s) D(s) C", "join: one taken from another superset leaves it, and a superset of one is none");
  eq(show(joinSuperset(list, 0, 0, fresh)), "A B C D", "join: itself, nothing");
  eq(show(joinSuperset(list, 0, 9, fresh)), "A B C D", "join: out of range, nothing");
}

// ─── Leaving ────────────────────────────────────────────────────────────────
{
  const three = [ex("A", "s"), ex("B", "s"), ex("C", "s"), ex("D")];
  eq(show(leaveSuperset(three, 0)), "A B(s) C(s) D", "leave: from the top end it just leaves");
  eq(show(leaveSuperset(three, 2)), "A(s) B(s) C D", "leave: from the bottom end too");
  eq(show(leaveSuperset(three, 1)), "A(s) C(s) B D", "leave: from between two it steps out after the superset, which stays whole");
  eq(show(leaveSuperset([ex("A", "s"), ex("B", "s"), ex("C")], 1)), "A B C", "leave: a superset of two is none after");
  eq(show(leaveSuperset([ex("A"), ex("B")], 0)), "A B", "leave: in none, nothing");
}

// ─── Moving (the reorder sheet's drop) ──────────────────────────────────────
{
  const list = [ex("A"), ex("B", "s"), ex("C", "s"), ex("D"), ex("E")];
  eq(show(moveKeepingSupersets(list, 2, 1)), "A C(s) B(s) D E", "move: within its superset it stays in it, in its new place");
  eq(show(moveKeepingSupersets(list, 2, 4)), "A B D E C", "move: dragged away it leaves, and the other's alone");
  eq(show(moveKeepingSupersets(list, 0, 1)), "B(s) C(s) A D E", "move: dropped between two members going down, it lands past them");
  eq(show(moveKeepingSupersets(list, 4, 2)), "A E B(s) C(s) D", "move: going up, it lands before them");
  eq(show(moveKeepingSupersets(list, 0, 3)), "B(s) C(s) D A E", "move: past a superset, nothing to fix");
  const giant = [ex("A", "s"), ex("B", "s"), ex("C", "s"), ex("D")];
  eq(show(moveKeepingSupersets(giant, 0, 2)), "B(s) C(s) A(s) D", "move: a giant set's first to its end stays in it");
  eq(show(moveKeepingSupersets(giant, 1, 3)), "A(s) C(s) D B", "move: its middle dragged out leaves; the rest stay one");
  const two = [ex("A", "s"), ex("B", "s"), ex("C", "t"), ex("D", "t")];
  eq(show(moveKeepingSupersets(two, 0, 2)), "B C(t) D(t) A", "move: a member into another superset's middle lands past it, leaving its own");
}

// ─── The session's order: warm-ups, then rounds ─────────────────────────────
{
  const at = (rows: [number, "warmup" | "working", number][]) => rows.map(([i, k, j]) => `${"ABCD"[i]}${k === "warmup" ? "w" : ""}${j + 1}`).join(" ");
  eq(at(setsInSessionOrder([undefined, "s", "s", undefined], [
    { warmup: 1, working: 2 }, { warmup: 1, working: 3 }, { warmup: 0, working: 3 }, { warmup: 0, working: 1 },
  ])), "Aw1 A1 A2 Bw1 B1 C1 B2 C2 B3 C3 D1", "order: the superset's warm-ups, then a set of each in turn");
  eq(at(setsInSessionOrder(["s", "s"], [{ warmup: 0, working: 4 }, { warmup: 0, working: 2 }])), "A1 B1 A2 B2 A3 A4",
    "order: one with more sets does its extra ones at the end");
  eq(at(setsInSessionOrder([], [{ warmup: 1, working: 1 }, { warmup: 0, working: 2 }])), "Aw1 A1 B1 B2", "order: no supersets, the page's");
}

// ─── Where the session's up to, and the lock screen's queue ────────────────
{
  type S = { weight: string; reps: string; done: boolean; doneAt?: number };
  const o = (): S => ({ weight: "", reps: "", done: false });
  const t = (at: number): S => ({ weight: "", reps: "", done: true, doneAt: at });
  const ids = ["A", "B", "C"];
  const ss = [undefined, "s", "s"];
  const order = (log: Record<string, { warmup: S[]; working: S[] }>) =>
    pendingSetsInOrder(ids, log, ss).map(p => `${p.exId}${p.setType === "warmup" ? "w" : ""}${p.setIdx + 1}${p.skipped ? "*" : ""}`).join(" ");
  const fresh3 = { A: { warmup: [], working: [o()] }, B: { warmup: [o()], working: [o(), o()] }, C: { warmup: [], working: [o(), o()] } };
  eq(order(fresh3), "A1 Bw1 B1 C1 B2 C2", "next: nothing ticked, in rounds");
  eq(order({ ...fresh3, A: { warmup: [], working: [t(1)] }, B: { warmup: [t(2)], working: [t(3), o()] } }), "C1 B2 C2",
    "next: after bench set 1, the shoulder press's set 1");
  eq(order({ ...fresh3, A: { warmup: [], working: [t(1)] }, B: { warmup: [t(2)], working: [t(3), o()] }, C: { warmup: [], working: [t(4), o()] } }), "B2 C2",
    "next: then back to bench, set 2");
  eq(nextSetOf(ids, { ...fresh3, A: { warmup: [], working: [t(1)] } }, ss)?.exId, "B", "next: nextSetOf follows too");
  eq(pendingSetsInOrder(ids, fresh3).map(p => `${p.exId}${p.setType === "warmup" ? "w" : ""}${p.setIdx + 1}`).join(" "), "A1 Bw1 B1 B2 C1 C2",
    "next: without the supersets passed, the page's order as before");

  // The lock screen walks the same order, resting only after a round.
  const exercises = [
    { id: "A", name: "Squat", restSeconds: 120 },
    { id: "B", name: "Bench", restSeconds: 90, supersetId: "s" },
    { id: "C", name: "Shoulder Press", restSeconds: 90, supersetId: "s" },
  ];
  const live = { A: { warmup: [], working: [t(1)] }, B: { warmup: [], working: [o(), o()] }, C: { warmup: [], working: [o(), o()] } };
  const { queue } = buildLiveActivityQueue(exercises, live, () => []);
  eq(queue.map(q => `${q.exerciseName} ${q.setIdx + 1}: ${q.restSeconds}`), [
    "Bench 1: 0", "Shoulder Press 1: 90", "Bench 2: 0", "Shoulder Press 2: 90",
  ], "lock screen: straight from bench to shoulder press, the rest after each round");
  const halfway = { ...live, B: { warmup: [], working: [t(2), o()] } };
  eq(buildLiveActivityQueue(exercises, halfway, () => []).queue.map(q => `${q.exerciseName} ${q.setIdx + 1}: ${q.restSeconds}`),
    ["Shoulder Press 1: 90", "Bench 2: 0", "Shoulder Press 2: 90"], "lock screen: from halfway through a round");
  eq(queue[queue.length - 1].isFinal, true, "lock screen: the last set is the final one (no rest after it anyway)");

  // The Workout tab's tick: no rest while a partner's set of the round waits.
  const tabLog = { A: { warmup: [], working: [t(1)] }, B: { warmup: [o()], working: [t(2), o()] }, C: { warmup: [], working: [o(), o()] } };
  eq(restAfterSet(exercises, tabLog, "B", "working", 0), 0, "rest: bench set 1 ticked, shoulder press waits: no rest");
  eq(restAfterSet(exercises, { ...tabLog, C: { warmup: [], working: [t(3), o()] } }, "C", "working", 0), 90, "rest: the round's last set rests");
  eq(restAfterSet(exercises, { ...tabLog, B: { warmup: [o()], working: [o(), o()] }, C: { warmup: [], working: [t(3), o()] } }, "C", "working", 0), 0,
    "rest: done out of order (shoulder press first), bench waits: no rest");
  eq(restAfterSet(exercises, tabLog, "B", "warmup", 0), 90, "rest: a warm-up rests as the exercise does");
  eq(restAfterSet(exercises, tabLog, "A", "working", 0), 120, "rest: an exercise in no superset, its own");
  const uneven = { B: { warmup: [], working: [t(1), t(2), o()] }, C: { warmup: [], working: [t(3), t(4)] } };
  eq(restAfterSet(exercises, uneven, "B", "working", 2), 90, "rest: an extra set with no partner rests");
  eq(restAfterSet(exercises, tabLog, "Z", "working", 0), 0, "rest: no such exercise, none");
}

// ─── What's saved, and what the builder keeps ──────────────────────────────
{
  const day: Exercise[] = [
    { id: "a", name: "Bench", sets: [{ type: "working" }], supersetId: "s", restSeconds: 90 },
    { id: "b", name: "Shoulder Press", sets: [{ type: "working" }], supersetId: "s", restSeconds: 90 },
    { id: "c", name: "Curl", sets: [{ type: "working" }], supersetId: "t" },
  ];
  const log = Object.fromEntries(day.map(e => [e.id, { warmup: [], working: [{ weight: "50", reps: "8", done: true }], notes: "" }]));
  eq(completedExercises(day, log, true, new Set()).map(e => e.supersetId ?? null), ["s", "s", null],
    "saved: the superset's two carry it, a lone id isn't saved");
  const map: WorkoutMap = { "0:Push": day };
  eq(canonicalizeWorkouts(map, ["Push"], [true])["0:Push"].map(e => e.supersetId ?? null), ["s", "s", null],
    "builder: every load and save path drops a lone id");
}

// ─── Log Workout: a past session (utils/logWorkout.ts) ─────────────────────
// The program day's supersets come with it, Superset With pairs two for the
// log alone, and Save writes them only where they're real (user request,
// 2026-11-15).
{
  const day: Exercise[] = [
    { id: "a", name: "Bench", sets: [{ type: "warmup" }, { type: "working", reps: "8" }], supersetId: "s" },
    { id: "b", name: "Shoulder Press", sets: [{ type: "working", reps: "10" }], supersetId: "s" },
    { id: "c", name: "Curl", sets: [{ type: "working" }], supersetId: "t" },
    { id: "d", name: "Dip", sets: [{ type: "working" }] },
  ];
  let n = 0;
  const opened = logExercisesFor(day, () => `row${n++}`);
  eq(opened.map(e => [e.id, e.programExerciseId, e.supersetId ?? null]), [["row0", "a", "s"], ["row1", "b", "s"], ["row2", "c", null], ["row3", "d", null]],
    "log: a program day opens with its superset, a lone id dropped");
  eq(opened[0].sets.map(s => [s.type, s.weight, s.done, s.programSet?.reps ?? null]), [["warmup", "", false, null], ["working", "", false, "8"]],
    "log: each set empty, the program's target its placeholder");
  const typed = opened.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, weight: "100", reps: "5", done: true })) }));
  eq(loggedExercises(typed, false).map(e => [e.name, e.supersetId ?? null, e.sets[0].weight, e.programExerciseId]), [
    ["Bench", "s", "45.359", "a"], ["Shoulder Press", "s", "45.359", "b"], ["Curl", null, "45.359", "c"], ["Dip", null, "45.359", "d"],
  ], "log: saved with its superset, weights typed in lbs stored as kg");
  // Superset With on Curl's card, picking Dip: for this log alone.
  const paired = joinSuperset(typed, 2, 3, fresh);
  eq(supersetRuns(loggedExercises(paired, true)), [[0, 1], [2, 3]], "log: one made here is saved with the day's");
  eq(day.map(e => e.supersetId ?? null), ["s", "s", "t", null], "log: the program's own day untouched");
  // Bench removed: Shoulder Press alone isn't in one, whatever its id says.
  eq(loggedExercises(typed.slice(1), true).map(e => e.supersetId ?? null), [null, null, null], "log: a superset left with one saves none");
}

// ─── The sheets' and the reorder sheet's words ─────────────────────────────
{
  const list = [ex("Bench", "s"), ex("Press", "s"), ex("Curl", "t"), ex("Dip", "t"), ex("Row")];
  const choices = supersetChoicesFor(list, 0, e => e.id);
  eq(choices, {
    choices: [{ key: "Curl", name: "Curl", with: ["Dip"] }, { key: "Dip", name: "Dip", with: ["Curl"] }, { key: "Row", name: "Row" }],
    partners: ["Press"],
  }, "choices: the others but its own superset's, each with the superset it'd leave");
  eq(supersetChoicesFor(list, -1, e => e.id), { choices: [], partners: [] }, "choices: no exercise, none");
  eq([...supersetLines(list, e => e.id)], [["Bench", "Superset with Press"], ["Press", "Superset with Bench"], ["Curl", "Superset with Dip"], ["Dip", "Superset with Curl"]],
    "lines: each member's, for the reorder sheet");
  eq([namesList(["A"]), namesList(["A", "B"]), namesList(["A", "B", "C"])], ["A", "A and B", "A, B and C"], "names: listed in words");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
console.log("✓ supersets hold together");
