// scripts/verify-exercise-changes.ts
//
// What a session changed about its program day (utils/exerciseChanges.ts): the
// Journal's "Planned 2nd" / "Instead of" / "Added" / "Skipped", the Journal
// card's summary, and the Workout tab's "Last session:" lines, including the
// reset after the day changes in the builder, and its session still under way.
//
// Run: npx tsx scripts/verify-exercise-changes.ts

import {
  changesSummary, lastTimeCues, planForDay, samePlan, sessionChanges,
} from "../utils/exerciseChanges";
import type { CompletedExercise, CompletedWorkout, PlannedExercise, SavedProgram } from "../constants/programs";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${what}\n    expected ${b}\n    actual   ${a}`);
}

// Push: Barbell Bench, Incline Bench, Cable Fly, Shoulder Press, Lateral Raise.
const PLAN: PlannedExercise[] = [
  { id: "e1", name: "Barbell Bench Press" },
  { id: "e2", name: "Incline Bench Press" },
  { id: "e3", name: "Cable Fly" },
  { id: "e4", name: "Dumbbell Shoulder Press" },
  { id: "e5", name: "Lateral Raise" },
];
const ex = (name: string, pid?: string, swappedFrom?: string): CompletedExercise =>
  ({ name, sets: [], notes: "", ...(pid ? { programExerciseId: pid } : {}), ...(swappedFrom ? { swappedFrom } : {}) });
const asPlanned = (p: PlannedExercise) => ex(p.name, p.id);
const session = (exercises: CompletedExercise[], extra: Partial<CompletedWorkout> = {}): CompletedWorkout => ({
  id: "w", date: "2026-10-06", completedAt: "2026-10-06T08:00:00.000Z", workoutName: "Push",
  durationSeconds: 3600, programId: "p1", dayId: "d0", plan: PLAN, exercises, ...extra,
});
const cuesOf = (w: CompletedWorkout) => sessionChanges(w)?.cues ?? null;

// ─── nothing to read against ─────────────────────────────────────────────────
eq(sessionChanges(session(PLAN.map(asPlanned))), { cues: [null, null, null, null, null], skipped: [], counts: { moved: 0, swapped: 0, skipped: 0, added: 0 } },
  "done as planned: no cues");
eq(changesSummary(sessionChanges(session(PLAN.map(asPlanned)))), null, "...and no summary");
eq(sessionChanges(session([ex("Bench"), ex("Rows")], { dayId: undefined, plan: undefined, programId: "" })), null,
  "a free workout says nothing (no day to read it against)");
eq(sessionChanges(session([ex("Barbell Bench Press"), ex("Cable Fly")], { plan: undefined })), null,
  "a session from before places says nothing, rather than calling everything added");

// ─── moved ───────────────────────────────────────────────────────────────────
const [b1, b2, b3, b4, b5] = PLAN.map(asPlanned);
eq(cuesOf(session([b1, b2, b3, b5, b4])), [null, null, null, { kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 4 }],
  "the 5th moved up to 4th: the 4th it went ahead of says Planned 4th too (user report, 2026-10-22)");
eq(cuesOf(session([b2, b1, b3, b4, b5])), [{ kind: "moved", plannedPosition: 2 }, { kind: "moved", plannedPosition: 1 }, null, null, null],
  "1 and 2 swapped round: both say where they were planned");
eq(cuesOf(session([b5, b1, b2, b3, b4])), [{ kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 1 }, null, null, null],
  "one done first from 5th: it and the 1st whose place it took, not the three that slid down after");
eq(cuesOf(session([b2, b3, b4, b5, b1])), [null, null, null, { kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 1 }],
  "one left to the end: it and the 5th whose place it took");
eq(cuesOf(session([b3, b4, b1, b2, b5])), [{ kind: "moved", plannedPosition: 3 }, { kind: "moved", plannedPosition: 4 }, { kind: "moved", plannedPosition: 1 }, { kind: "moved", plannedPosition: 2 }, null],
  "two pairs traded: all four say so, the 5th untouched");
eq(cuesOf(session([b1, b2, b5, b4])), [null, null, { kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 4 }],
  "with one skipped, the place taken is counted among what was done");
eq(changesSummary(sessionChanges(session([b2, b1, b3, b4, b5]))), "Order changed", "summary: order changed");

// ─── swapped, added, skipped ─────────────────────────────────────────────────
const pecDeck = ex("Pec Deck", "e3", "Cable Fly");
eq(cuesOf(session([b2, b1, pecDeck, b4, b5])),
  [{ kind: "moved", plannedPosition: 2 }, { kind: "moved", plannedPosition: 1 }, { kind: "swapped", from: "Cable Fly" }, null, null],
  "the reported week: Incline done 1st, Bench after it, Pec Deck instead of Cable Fly");
eq(changesSummary(sessionChanges(session([b2, b1, pecDeck, b4, b5]))), "Order changed · 1 swap", "summary of it");
eq(cuesOf(session([b1, b2, ex("Pec Deck", "e3", "Cable Fly"), b5, b4])),
  [null, null, { kind: "swapped", from: "Cable Fly" }, { kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 4 }],
  "a swap-in says it was a swap; the pair moved past each other after it both say so");
eq(cuesOf(session([b1, ex("Pec Deck", "e3", "Cable Fly"), b2, b4, b5])),
  [null, { kind: "swapped", from: "Cable Fly" }, { kind: "moved", plannedPosition: 2 }, null, null],
  "a swap-in brought forward still says it was a swap; the one it went ahead of says Planned 2nd");
eq(cuesOf(session([b1, b2, b3, b4, b5, ex("Dips")])), [null, null, null, null, null, { kind: "added" }], "an exercise added mid-session");
const skipped = sessionChanges(session([b1, b2, b4, b5]))!;
eq(skipped.skipped, [{ id: "e3", name: "Cable Fly", plannedPosition: 3, before: 2 }], "a skipped exercise sits in its planned place");
eq(sessionChanges(session([b1, b2, b3, b4]))!.skipped[0].before, 4, "...or at the end when it was last");
eq(changesSummary(sessionChanges(session([b2, b1, pecDeck, b4, ex("Dips")]))), "Order changed · 1 swap · 1 skipped · 1 added",
  "summary of everything");
eq(cuesOf(session([b1, ex("Cable Crossover", "e2", "Incline Bench Press")], { plan: undefined })),
  [null, { kind: "swapped", from: "Incline Bench Press" }],
  "no plan: a swap still says so (no Planned or Skipped without one)");

// ─── the Workout tab: last session against today's plan ──────────────────────
const last = session([b2, b1, pecDeck, b4]);
eq(lastTimeCues(last, PLAN), {
  e2: { kind: "moved", donePosition: 1 },
  e1: { kind: "moved", donePosition: 2 },
  e3: { kind: "swapped", to: "Pec Deck" },
  e5: { kind: "skipped" },
}, "next week: Incline done 1st, Bench done 2nd, Pec Deck instead, Lateral Raise skipped");
eq(lastTimeCues(null, PLAN), {}, "no last session: nothing");
eq(lastTimeCues(session([b1, b2, b3, b4, b5, ex("Dips")]), PLAN), {}, "an exercise added last time has no card to mark");

// The reset: the day changed in the builder since, so last time's plan isn't today's.
eq(lastTimeCues(last, [PLAN[1], PLAN[0], ...PLAN.slice(2)]), {}, "reordered in the builder: starts fresh");
eq(lastTimeCues(last, [...PLAN, { id: "e6", name: "Dips" }]), {}, "an exercise added in the builder: starts fresh");
eq(lastTimeCues(last, PLAN.map(p => (p.id === "e3" ? { ...p, name: "Pec Deck" } : p))), {},
  "changed in the builder (same place, another exercise): starts fresh");

// A program whose weights changed still plans the same day.
const program = (workouts: SavedProgram["workouts"]): SavedProgram => ({
  id: "p1", name: "PPL", totalWeeks: 8, currentWeek: 1, status: "active", startDate: "Mon 5 Oct 2026",
  trainingDays: 1, cycleDays: 2, cyclePattern: ["Push", "Rest"], dayIds: ["d0", "d1"], workouts,
});
const day = PLAN.map(p => ({ id: p.id, name: p.name, sets: [{ type: "working" as const, weightKg: "60", reps: "8" }] }));
eq(planForDay(program({ "0:Push": day }), "d0"), PLAN, "planForDay: the day's exercises in order");
eq(planForDay(program({ "0:Push": day }), "d1"), undefined, "...nothing for a rest day");
eq(planForDay(program({ "0:Push": day }), undefined), undefined, "...or a free workout");
const heavier = day.map(e => ({ ...e, sets: [{ type: "working" as const, weightKg: "62.5", reps: "6" }] }));
eq(samePlan(planForDay(program({ "0:Push": day }), "d0")!, planForDay(program({ "0:Push": heavier }), "d0")!), true,
  "new weights and reps are the same plan: the cues stay");
eq(lastTimeCues(last, planForDay(program({ "0:Push": heavier }), "d0")).e3, { kind: "swapped", to: "Pec Deck" },
  "...so last week's lines still show after a weight bump");

// A session from before plans: only swaps, and only while the place still holds the original.
const oldLast = session([b2, b1, pecDeck, b4], { plan: undefined });
eq(lastTimeCues(oldLast, PLAN), { e3: { kind: "swapped", to: "Pec Deck" } }, "pre-plan session: its swap shows, no order or skip");
eq(lastTimeCues(oldLast, PLAN.map(p => (p.id === "e3" ? { ...p, name: "Cable Crossover" } : p))), {},
  "...unless the builder has since put another exercise in that place");

// ─── the Workout tab: today's session while it's under way ───────────────────
// Its exercises are session exercises (an id, a name, sets still being typed),
// carrying programExerciseId and swappedFrom until Finish writes them; the
// cards read them the Journal's way (user request, 2026-10-22).
const live = (exercises: { id: string; name: string; programExerciseId?: string; swappedFrom?: string }[]) =>
  sessionChanges({ dayId: "d0", plan: PLAN, exercises })?.cues ?? null;
const card = (p: PlannedExercise, i: number) => ({ id: `s${i}`, name: p.name, programExerciseId: p.id });
const cards = PLAN.map(card);
eq(live(cards), [null, null, null, null, null], "under way, as planned: no lines");
eq(live([cards[2], cards[0], cards[1], cards[3], cards[4]]), [{ kind: "moved", plannedPosition: 3 }, { kind: "moved", plannedPosition: 1 }, null, null, null],
  "under way: a card dragged to the top says Planned 3rd at once, and the 1st it went ahead of Planned 1st");
eq(live([cards[0], cards[1], cards[2], cards[4], cards[3]]), [null, null, null, { kind: "moved", plannedPosition: 5 }, { kind: "moved", plannedPosition: 4 }],
  "under way: the 5th moved up to 4th, and the 4th says Planned 4th too");
eq(live([cards[0], { ...cards[1], name: "Smith Incline Press", swappedFrom: "Incline Bench Press" }, cards[2], cards[3], cards[4]]),
  [null, { kind: "swapped", from: "Incline Bench Press" }, null, null, null], "under way: a swap says Instead of at once");
eq(live([...cards, { id: "s9", name: "Dips" }]), [null, null, null, null, null, { kind: "added" }], "under way: an added card says Added");
eq(sessionChanges({ exercises: cards }), null, "under way on a custom workout (no day): nothing");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ exercise change invariants hold");
