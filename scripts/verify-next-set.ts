// Where a workout session is up to (utils/nextSet.ts): after the set ticked
// last, with skipped sets left for the end, and the lock-screen queue that
// walks the same order (utils/liveActivity.ts).
//
// Run:  npx tsx scripts/verify-next-set.ts
// Exits non-zero (throws) if any assertion fails.

import { nextSetOf, pendingSetsInOrder } from "../utils/nextSet";
import { buildLiveActivityQueue } from "../utils/liveActivity";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

type S = { weight: string; reps: string; done: boolean; doneAt?: number };
/** Unticked. */
const o = (weight = "", reps = ""): S => ({ weight, reps, done: false });
/** Ticked at `at` (epoch-ish ms); no `at` = ticked by a build that kept no time. */
const t = (at?: number): S => (at === undefined ? { weight: "", reps: "", done: true } : { weight: "", reps: "", done: true, doneAt: at });
const ex = (working: S[], warmup: S[] = []) => ({ warmup, working });

const IDS = ["A", "B", "C"];
type Log = Record<string, { warmup: S[]; working: S[] } | undefined>;
/** "B2" = B's working set 2, "Aw1" = A's warmup 1, a trailing * = skipped. */
const order = (log: Log, ids: string[] = IDS) =>
  pendingSetsInOrder(ids, log).map(p => `${p.exId}${p.setType === "warmup" ? "w" : ""}${p.setIdx + 1}${p.skipped ? "*" : ""}`);

// ─── nothing ticked: the page's order ────────────────────────────────────────

eq(order({ A: ex([o(), o()]), B: ex([o(), o()]) }), ["A1", "A2", "B1", "B2"], "nothing ticked: straight down the page");
eq(nextSetOf(IDS, { A: ex([o()]) })?.exIndex, 0, "nothing ticked: the first exercise is up next");

// ─── after the set ticked last ───────────────────────────────────────────────

eq(order({ A: ex([t(1), t(2), o()]), B: ex([o(), o()]) }), ["A3", "B1", "B2"], "in order: the next set, then down the page");
eq(
  order({ A: ex([t(1), t(2), t(3), o()]), B: ex([t(4), o(), o()]), C: ex([o()]) }),
  ["B2", "B3", "C1", "A4*"],
  "a set skipped in A and moved on: B is up next, A's set waits at the end, marked skipped",
);
eq(
  order({ A: ex([t(3), o()]), B: ex([o(), o()]), C: ex([t(1), t(2), o()]) }),
  ["A2", "B1", "B2", "C3"],
  "by WHEN it was ticked, not where: C done first, then back to A, and A is where you are",
);
eq(
  order({ A: ex([t(1), t(3), t(5)]), B: ex([t(2), t(4), o()]) }),
  ["B3"],
  "a superset: A's last set ticked, B's last set is next",
);
eq(
  order({ A: ex([t(1), t(2), o()]), B: ex([{ ...o(), doneAt: 3 }, o()]) }),
  ["A3", "B1", "B2"],
  "an unticked set never counts as ticked last, even with a tick time left on it",
);

// ─── wrapping round ──────────────────────────────────────────────────────────

eq(
  order({ A: ex([o(), o()]), B: ex([o()]), C: ex([t(1), t(2)]) }),
  ["A1", "A2", "B1"],
  "the last exercise done first: back to the top for the ones not started",
);
eq(
  order({ A: ex([t(1), o()]), B: ex([o(), o()]), C: ex([t(2), t(3)]) }),
  ["B1", "B2", "A2*"],
  "wrapping round, an exercise not started comes before a skipped set",
);

// ─── only skipped sets left ──────────────────────────────────────────────────

{
  const log = { A: ex([t(1), o()]), B: ex([t(2), t(3)]), C: ex([t(4)]) };
  eq(order(log), ["A2*"], "everything done but a skipped set: it's all that's left");
  eq(nextSetOf(IDS, log)?.skipped, true, "…and it reads as skipped, so the page goes to Complete Workout");
}
eq(
  order({ A: ex([t(1), t(2), t(3), t(10)]), B: ex([t(4), o(), t(5)]), C: ex([t(6), t(7)]) }),
  ["B2"],
  "fixing one skipped set (A4, ticked last) moves on to the next one below it",
);
eq(nextSetOf(IDS, { A: ex([t(1)]), B: ex([t(2)]), C: ex([t(3)]) }), null, "every set ticked: nothing is next");

// ─── ticks from before times were kept ───────────────────────────────────────

eq(order({ A: ex([t(), t(), o()]), B: ex([t(), o()]) }), ["B2", "A3*"], "untimed ticks: the lowest on the page counts as last");
eq(order({ A: ex([t(5), o()]), B: ex([t(), o()]) }), ["A2", "B2"], "a timed tick beats an untimed one");
eq(order({ A: ex([t(5)]), B: ex([t(5), o()]) }), ["B2"], "a tie goes to the lower row");

// ─── rows, warmups and missing logs ──────────────────────────────────────────

eq(
  nextSetOf(["A"], { A: ex([o(), o()], [t(1)]) }),
  { exId: "A", exIndex: 0, setType: "working", setIdx: 0, flatIdx: 1, skipped: false },
  "after a warmup: working set 1, drawn on the card's second row",
);
eq(order({ A: ex([o()], [o(), o()]) }, ["A"]), ["Aw1", "Aw2", "A1"], "warmups come before working sets");
eq(
  pendingSetsInOrder(IDS, { A: ex([t(1)]), C: ex([o()]) }).map(p => [p.exId, p.exIndex]),
  [["C", 2]],
  "an exercise with no log is passed over, and the others keep their places",
);
{
  const log = { A: ex([t(1), o()]), B: ex([o()]) };
  const before = JSON.stringify(log);
  pendingSetsInOrder(IDS, log);
  eq(JSON.stringify(log), before, "the log is never mutated");
}

// ─── the lock screen walks the same order ────────────────────────────────────

{
  const exercises = [
    { id: "A", name: "Bench Press", restSeconds: 90 },
    { id: "B", name: "Row", restSeconds: 60 },
    { id: "C", name: "Curl" },
  ];
  const log = { A: ex([t(1), t(2), t(3), o()]), B: ex([t(4), o(), o()]), C: ex([o()]) };
  const { queue, doneCount, totalCount } = buildLiveActivityQueue(exercises, log, () => []);
  eq(
    queue.map(q => `${q.exId}${q.setIdx + 1}`),
    ["B2", "B3", "C1", "A4"],
    "lock screen: its head is the set the page glows on, the skipped set last",
  );
  eq(queue.map(q => q.isFinal), [false, false, false, true], "lock screen: only the last pending set finishes the workout");
  eq([doneCount, totalCount], [4, 8], "lock screen: done/total counts every set");
  eq(queue[0].setLabel, "Set 2 of 3", "lock screen: set labels count the exercise's working sets");
  eq(queue[3].exerciseName, "Bench Press", "lock screen: each entry names its own exercise");
  eq(queue[0].restSeconds, 60, "lock screen: rest comes from the set's own exercise");
  eq(queue[2].restSeconds, 0, "lock screen: no rest set means none");
}
{
  const exercises = [{ id: "A", name: "Squat" }];
  const hints = ["20×10", "60×8", "60×8"];
  const { queue } = buildLiveActivityQueue(
    exercises,
    { A: ex([o(), o("70", "")], [o()]) },
    id => (id === "A" ? hints : []),
  );
  eq(queue.map(q => q.setLabel), ["Warmup 1", "Set 1 of 2", "Set 2 of 2"], "lock screen: warmups first, labelled as warmups");
  eq([queue[1].weight, queue[1].reps], ["60", "8"], "lock screen: an empty set previews last time's numbers for its row");
  eq([queue[2].weight, queue[2].reps], ["70", ""], "lock screen: anything typed wins over the hint");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("next-set invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ next-set invariants hold");
