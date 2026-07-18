// Framework-free verification of utils/workoutSummary.ts — the pure logic
// behind the post-workout completion summary (session records vs all-time
// prior bests, and the ordinal "Your Nth workout" helper).
//
// Run:  npx tsx scripts/verify-workout-summary.ts
// Exits non-zero (throws) if any assertion fails.

import { computeSessionRecords, ordinal } from "../utils/workoutSummary";
import type { CompletedWorkout, CompletedSet, CompletedExercise } from "../constants/programs";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${msg}\n      expected ${e}\n      got      ${a}`);
}

// ── builders ────────────────────────────────────────────────────────────────
function set(weight: string, reps: string, opts: Partial<CompletedSet> = {}): CompletedSet {
  return { type: "working", weight, reps, done: true, ...opts };
}
function ex(name: string, sets: CompletedSet[]): CompletedExercise {
  return { name, sets, notes: "" };
}
function workout(id: string, date: string, exercises: CompletedExercise[]): CompletedWorkout {
  return {
    id,
    date,
    completedAt: `${date}T10:00:00.000Z`,
    workoutName: "Test Day",
    durationSeconds: 3600,
    exercises,
  };
}

// ── computeSessionRecords ───────────────────────────────────────────────────

// First-ever exercise → exactly ONE record (heaviest, prevKg null), not three.
{
  const session = workout("w1", "2026-07-09", [ex("Bench Press", [set("100", "5")])]);
  const recs = computeSessionRecords(session, []);
  eq(
    recs,
    [{ exerciseName: "Bench Press", kind: "heaviest", valueKg: 100, prevKg: null }],
    "first-ever exercise emits a single first-log record",
  );
}

// Beating all three metrics → three records, in heaviest/oneRepMax/bestSetVolume order.
{
  const prior = [workout("w1", "2026-07-01", [ex("Bench Press", [set("100", "5")])])];
  const session = workout("w2", "2026-07-09", [ex("Bench Press", [set("105", "6")])]);
  const recs = computeSessionRecords(session, prior);
  eq(recs.map(r => r.kind), ["heaviest", "oneRepMax", "bestSetVolume"], "all-metric PR session emits three records in order");
  eq(recs[0], { exerciseName: "Bench Press", kind: "heaviest", valueKg: 105, prevKg: 100 }, "heaviest record carries new and prior kg");
  check(Math.abs(recs[1].valueKg - 105 * (1 + 6 / 30)) < 1e-9, "1RM record uses Epley on the session's best set");
  eq(recs[2].valueKg, 630, "best-set-volume record is weight × reps");
}

// Ties are NOT records (strict >).
{
  const prior = [workout("w1", "2026-07-01", [ex("Bench Press", [set("100", "5")])])];
  const session = workout("w2", "2026-07-09", [ex("Bench Press", [set("100", "5")])]);
  eq(computeSessionRecords(session, prior), [], "matching the prior best exactly is not a record");
}

// Heavier single but weaker 1RM/volume → only the heaviest record.
{
  const prior = [workout("w1", "2026-07-01", [ex("Squat", [set("100", "10")])])];
  const session = workout("w2", "2026-07-09", [ex("Squat", [set("105", "1")])]);
  eq(computeSessionRecords(session, prior).map(r => r.kind), ["heaviest"], "a heavy single only sets the heaviest record");
}

// Un-done and warmup sets never count.
{
  const prior = [workout("w1", "2026-07-01", [ex("Bench Press", [set("100", "5")])])];
  const session = workout("w2", "2026-07-09", [
    ex("Bench Press", [set("200", "5", { done: false }), set("150", "5", { type: "warmup" })]),
  ]);
  eq(computeSessionRecords(session, prior), [], "undone/warmup sets can't produce records");
}

// Non-numeric weights ("BW") have nothing to measure — no first-log record either.
{
  const session = workout("w1", "2026-07-09", [ex("Pull Up", [set("BW", "10")])]);
  eq(computeSessionRecords(session, []), [], "bodyweight-only exercises emit no records");
}

// Duplicate entries of the same exercise fold into one comparison.
{
  const prior = [workout("w1", "2026-07-01", [ex("Bench Press", [set("105", "5")])])];
  const session = workout("w2", "2026-07-09", [
    ex("Bench Press", [set("100", "5")]),
    ex("Bench Press", [set("110", "3")]),
  ]);
  const recs = computeSessionRecords(session, prior);
  eq(
    recs,
    [{ exerciseName: "Bench Press", kind: "heaviest", valueKg: 110, prevKg: 105 }],
    "duplicate session entries compare once, against the best across both",
  );
}

// Name matching is trim + case-insensitive (normalizeExerciseName semantics).
{
  const prior = [workout("w1", "2026-07-01", [ex("bench press ", [set("100", "5")])])];
  const session = workout("w2", "2026-07-09", [ex("Bench Press", [set("90", "5")])]);
  eq(computeSessionRecords(session, prior), [], "prior history matches case-insensitively (no false first-log)");
}

// ── ordinal ─────────────────────────────────────────────────────────────────
{
  eq(ordinal(1), "1st", "ordinal 1");
  eq(ordinal(2), "2nd", "ordinal 2");
  eq(ordinal(3), "3rd", "ordinal 3");
  eq(ordinal(4), "4th", "ordinal 4");
  eq(ordinal(11), "11th", "ordinal 11");
  eq(ordinal(12), "12th", "ordinal 12");
  eq(ordinal(13), "13th", "ordinal 13");
  eq(ordinal(21), "21st", "ordinal 21");
  eq(ordinal(22), "22nd", "ordinal 22");
  eq(ordinal(23), "23rd", "ordinal 23");
  eq(ordinal(111), "111th", "ordinal 111");
  eq(ordinal(0), "1st", "ordinal clamps below 1");
}

// ── report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failure(s), ${passed} passed:\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`✓ verify-workout-summary: all ${passed} assertions passed`);
