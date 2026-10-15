// A workout left unfinished goes to the Journal with what was entered in it
// (user request, 2026-10-15; utils/unfinishedSession.ts).
//
//   1. The session as it's filed: nothing entered (or only shaped) files
//      nothing; every set goes as it stood, ticked or not, weights in kg from
//      either unit, holds, swaps, places, the plan and the notes, as Finish
//      saves them; timed from its clock to the last change, to the minute, a
//      late night's finish on the day after its training day.
//   2. The real utils/unfinishedSessionStore.ts on an in-memory phone: a
//      session whose day is over is filed once, backed up and checked for
//      records, and goes with its clock; one still on its day (the late-night
//      grace included) is left alone; a filing cut short doesn't save twice; a
//      custom workout started to be added to the program is.
//
// Run:  npx tsx scripts/verify-unfinished-session.ts
// Exits non-zero (throws) if any assertion fails.

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import {
  completedFromDraft, draftIsOver, forgottenMessage, forgottenReminderAt, lastActivityAt, looksForgotten,
  noticeFor, noticeMessage, pastDayWords, REMINDER_LEAD_MS, sessionSpan, setsDone, setsOfLog,
  type WorkoutDraft,
} from "../utils/unfinishedSession";
import { FORGOTTEN_AFTER_MS } from "../utils/heldSession";

/* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, no @types/node (see ./harness/db.ts) */
type NodeModule = {
  _load(request: string, parent: { filename?: string } | null, isMain: boolean): unknown;
};
const Module = require("node:module") as NodeModule;
const path = require("node:path") as {
  resolve(...parts: string[]): string;
  dirname(p: string): string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

/** Local time on a day in October 2026. */
const oct = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, day, h, m, s);
const iso = (d: Date) => d.toISOString();

const set = (weight: string, reps: string, done: boolean, doneAt?: Date) =>
  ({ weight, reps, done, ...(doneAt ? { doneAt: doneAt.getTime() } : {}) });
const empty = () => set("", "", false);

/** A Push session on the 14th: bench ticked twice and a third typed but not
 *  ticked, a swapped-in fly, a plank held, an exercise added mid-session. */
function pushDraft(over: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return {
    date: "2026-10-14",
    workoutInfo: {
      name: "Push",
      programId: "p1",
      dayId: "d0",
      plan: [{ id: "e1", name: "Bench Press" }, { id: "e2", name: "Cable Fly" }, { id: "e3", name: "Plank" }],
      exercises: [
        { id: "e1", name: "Bench Press", sets: [], programExerciseId: "e1" },
        { id: "e2", name: "Pec Deck", sets: [], programExerciseId: "e2", swappedFrom: "Cable Fly" },
        { id: "e3", name: "Plank", sets: [], programExerciseId: "e3" },
        { id: "x1", name: "Dips", sets: [] },
      ],
    },
    log: {
      e1: {
        warmup: [set("40", "10", true, oct(14, 18, 5))],
        working: [set("80", "8", true, oct(14, 18, 20)), set("80", "8", true, oct(14, 18, 31)), set("80", "6", false)],
        notes: "Felt strong",
      },
      e2: { warmup: [], working: [set("50", "12", true, oct(14, 18, 50)), empty()], notes: "" },
      e3: { warmup: [], working: [set("", "60", true, oct(14, 19, 10, 30))], notes: "" },
      x1: { warmup: [], working: [empty(), empty()], notes: "" },
    },
    unitIsKg: true,
    isometricExIds: ["e3"],
    notes: "Phone died at the end",
    isFreeWorkout: false,
    freeWorkoutAddToProgram: false,
    savedAt: oct(14, 19, 12, 45).getTime(),
    ...over,
  };
}

/** The same session typed in but never ticked: no set done, so no clock. */
function typedOnly(over: Partial<WorkoutDraft> = {}): WorkoutDraft {
  const d = pushDraft(over);
  for (const l of Object.values(d.log)) {
    for (const s of [...l.warmup, ...l.working]) { s.done = false; delete s.doneAt; }
  }
  return d;
}

const NO_CLOCK = { startMs: null, pausedMs: null };
const CLOCK_6PM = { startMs: oct(14, 18, 0).getTime(), pausedMs: null };

// ─── 1. The session as it's filed ────────────────────────────────────────────

{
  const blank = pushDraft();
  const untouched = { ...blank, log: Object.fromEntries(Object.keys(blank.log).map(k => [k, { warmup: [empty()], working: [empty()], notes: "" }])) };
  eq(completedFromDraft(untouched, CLOCK_6PM, "w", true), null, "nothing ticked or typed: nothing filed");
  eq(completedFromDraft(pushDraft({ planned: true }), CLOCK_6PM, "w", true), null, "only shaped, never started: nothing filed");

  const w = completedFromDraft(pushDraft(), CLOCK_6PM, "workout_1", true) as CompletedWorkout;
  eq([w.id, w.date, w.workoutName, w.programId, w.dayId], ["workout_1", "2026-10-14", "Push", "p1", "d0"], "filed under its day, program and slot");
  eq(w.plan?.map(p => p.name), ["Bench Press", "Cable Fly", "Plank"], "with the plan it was set up from");
  eq(w.sessionNotes, "Phone died at the end", "with its session note");
  eq(w.exercises.map(e => e.name), ["Bench Press", "Pec Deck", "Plank", "Dips"], "every exercise, in the session's order");
  eq(w.exercises[0].sets, [
    { type: "warmup", weight: "40", reps: "10", done: true },
    { type: "working", weight: "80", reps: "8", done: true },
    { type: "working", weight: "80", reps: "8", done: true },
    { type: "working", weight: "80", reps: "6", done: false },
  ], "every set as it stood, the one typed but never ticked included");
  eq(w.exercises[0].notes, "Felt strong", "with its exercise notes");
  eq([w.exercises[1].swappedFrom, w.exercises[1].programExerciseId], ["Cable Fly", "e2"], "a swap keeps what it replaced and its place");
  eq(w.exercises[2].isIsometric, true, "a hold stays a hold");
  eq([w.exercises[3].programExerciseId, w.exercises[3].sets.length], [undefined, 2], "an exercise added during it has no place, and keeps its empty sets");

  // In lbs, as typed: stored in kg like any session.
  const lb = completedFromDraft(pushDraft({ unitIsKg: false }), CLOCK_6PM, "w", true) as CompletedWorkout;
  eq(lb.exercises[0].sets[1].weight, "36.287", "a session in lbs is stored in kg (80 lb)");
  const legacy = completedFromDraft(pushDraft({ unitIsKg: undefined }), CLOCK_6PM, "w", false) as CompletedWorkout;
  eq(legacy.exercises[0].sets[1].weight, "36.287", "a draft from before drafts kept their unit reads in the phone's unit");

  const free = completedFromDraft(pushDraft({ workoutInfo: { ...pushDraft().workoutInfo, programId: undefined, dayId: undefined, plan: undefined } }), CLOCK_6PM, "w", true) as CompletedWorkout;
  eq([free.programId, free.dayId, free.plan], ["", undefined, undefined], "a free workout is filed as Finish files one (programId \"\")");
}

// Timing: from the clock to the last change, to the minute.
{
  const running = completedFromDraft(pushDraft(), CLOCK_6PM, "w", true) as CompletedWorkout;
  eq(running.completedAt, iso(oct(14, 19, 12)), "running clock: ends at the last change (19:12:45 → 19:12)");
  eq(running.durationSeconds, 72 * 60, "running clock: from its start (18:00), 72 minutes");

  const paused = completedFromDraft(pushDraft({ savedAt: oct(14, 20, 0).getTime() }), { startMs: null, pausedMs: 45 * 60_000 }, "w", true) as CompletedWorkout;
  eq([paused.completedAt, paused.durationSeconds], [iso(oct(14, 20, 0)), 45 * 60], "paused clock: the time it had run, before the last change");

  const ticksOnly = completedFromDraft(pushDraft({ savedAt: undefined }), CLOCK_6PM, "w", true) as CompletedWorkout;
  eq([ticksOnly.completedAt, ticksOnly.durationSeconds], [iso(oct(14, 19, 10)), 70 * 60], "a draft from before saves were timed ends at its last tick");

  const noClock = completedFromDraft(typedOnly({ savedAt: oct(14, 17, 30).getTime() }), NO_CLOCK, "w", true) as CompletedWorkout;
  eq([noClock.completedAt, noClock.durationSeconds], [iso(oct(14, 17, 30)), 0], "typed, never ticked (no clock): no time taken, at the last change");
  eq(noClock.exercises[0].sets.map(s => [s.weight, s.done]), [["40", false], ["80", false], ["80", false], ["80", false]], "and every set kept, none ticked");

  const legacy = typedOnly({ savedAt: undefined });
  eq(sessionSpan(legacy, NO_CLOCK), null, "a draft from before saves were timed, nothing ticked: nothing to time it by");
  const noon = completedFromDraft(legacy, NO_CLOCK, "w", true) as CompletedWorkout;
  eq([noon.completedAt, noon.durationSeconds], [iso(oct(14, 12, 0)), 0], "then midday on its day, no time taken");

  // Started at 11:20pm, last change at 12:40am: finished the day after its training day.
  const late = completedFromDraft(
    pushDraft({ savedAt: oct(15, 0, 40).getTime() }),
    { startMs: oct(14, 23, 20).getTime(), pausedMs: null }, "w", true) as CompletedWorkout;
  eq([late.date, late.completedAt, late.durationSeconds], ["2026-10-14", iso(oct(15, 0, 40)), 80 * 60], "a late night: its day kept, finished after midnight");

  // Begun at 1am, still the 14th's session (before 3am the tab stays on it).
  const small = completedFromDraft(
    pushDraft({ savedAt: oct(15, 2, 0).getTime() }),
    { startMs: oct(15, 1, 0).getTime(), pausedMs: null }, "w", true) as CompletedWorkout;
  eq([small.date, small.completedAt, small.durationSeconds], ["2026-10-14", iso(oct(15, 2, 0)), 60 * 60], "begun in the small hours: finished then, not a day early");
}

// Forgotten: an hour with nothing ticked or typed (user decision, 2026-10-15).
{
  const MIN = 60_000;
  const last = oct(14, 19, 12, 45).getTime();
  eq(lastActivityAt(pushDraft()), last, "last activity: the last save");
  eq(lastActivityAt(pushDraft({ savedAt: undefined })), oct(14, 19, 10, 30).getTime(), "...or the last tick");
  eq(lastActivityAt(typedOnly({ savedAt: undefined })), null, "...or nothing to say");
  eq(FORGOTTEN_AFTER_MS, 60 * MIN, "forgotten after an hour");

  eq(looksForgotten(true, last, null, last + 59 * MIN), false, "59 minutes quiet: still training");
  eq(looksForgotten(true, last, null, last + 60 * MIN), true, "an hour quiet: forgotten");
  eq(looksForgotten(false, last, null, last + 5 * 60 * MIN), false, "no clock going: nothing open to forget");
  eq(looksForgotten(true, last, last + 70 * MIN, last + 100 * MIN), false, "Keep Going: the next ask waits an hour from it");
  eq(looksForgotten(true, last, last + 70 * MIN, last + 130 * MIN), true, "...and comes once that hour's passed");

  eq(forgottenReminderAt(last, last + 5 * MIN), last + 60 * MIN, "left mid-workout: reminded an hour after the last thing logged");
  eq(forgottenReminderAt(last, last + 90 * MIN), last + 90 * MIN + REMINDER_LEAD_MS, "left after the hour had passed: a little after leaving");

  // Over: from a day that's over and not still being logged.
  const live = { startMs: oct(14, 23, 0).getTime(), pausedMs: null };
  const lateNight = pushDraft({ savedAt: oct(15, 0, 20).getTime() });
  eq(draftIsOver(pushDraft(), "2026-10-14", NO_CLOCK, oct(14, 23, 0).getTime()), false, "its own day: not over");
  eq(draftIsOver(lateNight, "2026-10-15", live, oct(15, 0, 30).getTime()), false, "past midnight, logged 10 minutes ago, clock going: still going");
  eq(draftIsOver(lateNight, "2026-10-15", live, oct(15, 1, 30).getTime()), true, "...an hour after the last thing logged: over");
  eq(draftIsOver(lateNight, "2026-10-15", NO_CLOCK, oct(15, 0, 30).getTime()), true, "...or with no clock going: over");

  // What the alerts say.
  const w = completedFromDraft(pushDraft(), CLOCK_6PM, "workout_1", true) as CompletedWorkout;
  eq(setsDone(setsOfLog(pushDraft().log)), { done: 5, total: 9 }, "sets done of all the session's sets");
  eq(noticeFor(w), { id: "workout_1", workoutName: "Push", date: "2026-10-14", done: 5, total: 9 }, "the notice: which workout, its day, its sets");
  eq(pastDayWords("2026-10-14", "2026-10-15"), "yesterday", "named: yesterday");
  eq(pastDayWords("2026-10-12", "2026-10-15"), "Monday", "named: a weekday within the week");
  eq(pastDayWords("2026-10-03", "2026-10-15"), "3 Oct", "named: a date before that");
  eq(noticeMessage(noticeFor(w), "2026-10-15"),
    "Your Push workout from yesterday wasn't finished, so what you logged is saved in your Journal: 5 of 9 sets done.",
    "the notice's words");
  eq(forgottenMessage("Push", "7:12 pm", 5, 9, true), "Nothing's been logged in Push since 7:12 pm. 5 of 9 sets done.", "the prompt's words");
  eq(forgottenMessage("Push", "6:00 pm", 0, 9, false), "Push has been open since 6:00 pm with nothing logged.", "...with nothing entered");
}

// ─── 2. The store, on an in-memory phone ─────────────────────────────────────

const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
const ROOT = path.resolve(__dirname, "..");
const byFile: Record<string, unknown> = {};
const byRequest: Record<string, unknown> = {};
const originalLoad = Module._load;
Module._load = function (this: unknown, request, parent, isMain) {
  if (request in byRequest) return byRequest[request];
  if (request.startsWith(".") && parent?.filename) {
    const hit = byFile[norm(path.resolve(path.dirname(parent.filename), request))];
    if (hit) return hit;
  }
  return originalLoad.call(this, request, parent, isMain);
};
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const disk = new Map<string, string>();
const storage = {
  getItem: async (k: string) => disk.get(k) ?? null,
  setItem: async (k: string, v: string) => { disk.set(k, v); },
  removeItem: async (k: string) => { disk.delete(k); },
  multiRemove: async (keys: string[]) => { for (const k of keys) disk.delete(k); },
};
byRequest["@react-native-async-storage/async-storage"] = { __esModule: true, default: storage };
let pushes = 0;
byFile[norm(path.resolve(ROOT, "lib/syncManager"))] = { __esModule: true, scheduleCloudPush: () => { pushes += 1; } };
const awarded: { id: string; prior: number; isKg: boolean }[] = [];
byFile[norm(path.resolve(ROOT, "utils/achievementStore"))] = {
  __esModule: true,
  awardWorkoutAchievements: async (c: CompletedWorkout, prior: CompletedWorkout[], isKg: boolean) => { awarded.push({ id: c.id, prior: prior.length, isKg }); },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the stubs
const store = require("../utils/unfinishedSessionStore") as typeof import("../utils/unfinishedSessionStore");

const K = {
  draft: "@avenas/workout_draft", history: "@avenas/workout_history", dates: "@avenas/workout_dates",
  programs: "@avenas/programs", start: "@avenas/workout_timer_start", paused: "@avenas/workout_timer_paused_ms", unit: "@avenas/unit",
  notice: "@avenas/unfinished_notice",
};
const read = <T,>(k: string): T | null => (disk.has(k) ? JSON.parse(disk.get(k) as string) as T : null);
/** Push every day: the 14th is a training day, so before 3am on the 15th the
 *  Workout tab is still on it until it's logged (getEffectiveToday). */
const PROGRAM = {
  id: "p1", name: "Daily", totalWeeks: 8, currentWeek: 1, status: "active", startDate: "01 Oct 2026",
  trainingDays: 1, cycleDays: 1, cyclePattern: ["Push"],
  workouts: { "0:Push": [{ id: "e1", name: "Bench Press", sets: [{ type: "working", reps: "8" }] }] },
} as unknown as SavedProgram;
const OLD: CompletedWorkout = { id: "old", date: "2026-10-10", completedAt: iso(oct(10, 19, 0)), workoutName: "Push", durationSeconds: 3600, exercises: [] };

async function storeChecks() {
  const fresh = (draft: WorkoutDraft | null) => {
    disk.clear();
    disk.set(K.programs, JSON.stringify([PROGRAM]));
    disk.set(K.history, JSON.stringify([OLD]));
    disk.set(K.dates, JSON.stringify(["2026-10-10"]));
    if (draft) disk.set(K.draft, JSON.stringify(draft));
    disk.set(K.start, String(oct(14, 18, 0).getTime()));
    pushes = 0;
    awarded.length = 0;
  };

  fresh(null);
  eq(await store.fileStaleDraft(oct(15, 9, 0)), { stale: false, filed: null }, "no session saved: nothing to do");

  // Opened again on its own day: left alone.
  fresh(pushDraft());
  eq((await store.fileStaleDraft(oct(14, 21, 0))).stale, false, "still its day: left alone");
  eq([disk.has(K.draft), disk.has(K.start), read<CompletedWorkout[]>(K.history)?.length], [true, true, 1], "its draft and clock stay, nothing filed");

  // The late-night grace: 1:30am, the 14th's Push not logged, the tab still on it.
  eq((await store.fileStaleDraft(oct(15, 1, 30))).stale, false, "1:30am with the day's workout unlogged: still its day");

  // The phone died at 7:12pm and opened again at 9am the next day.
  fresh(pushDraft());
  const r = await store.fileStaleDraft(oct(15, 9, 0));
  const history = read<CompletedWorkout[]>(K.history) ?? [];
  eq([r.stale, r.filed?.workoutName, r.filed?.id], [true, "Push", `workout_${oct(14, 19, 12, 45).getTime()}`], "the next morning: filed, named by when it ended");
  eq(history.map(w => w.id), [r.filed?.id, "old"], "it heads the history");
  eq(history[0]?.exercises[0].sets.map(s => s.done), [true, true, true, false], "with its sets as they stood");
  eq(read<string[]>(K.dates), ["2026-10-10", "2026-10-14"], "its day is a workout day");
  eq([disk.has(K.draft), disk.has(K.start), disk.has(K.paused)], [false, false, false], "the draft goes, and its clock with it");
  eq(pushes, 1, "it's backed up");
  eq(awarded, [{ id: r.filed?.id, prior: 1, isKg: true }], "and checked for records against the history before it");

  // A filing cut short: saved, but the draft was never removed.
  disk.set(K.draft, JSON.stringify(pushDraft()));
  const again = await store.fileStaleDraft(oct(15, 9, 5));
  eq([again.stale, (read<CompletedWorkout[]>(K.history) ?? []).length, disk.has(K.draft)], [true, 2, false], "filed again: not saved twice, and the draft goes");

  // A day past only shaped: nothing to keep.
  fresh(pushDraft({ planned: true }));
  const shaped = await store.fileStaleDraft(oct(15, 9, 0));
  eq([shaped.stale, shaped.filed, (read<CompletedWorkout[]>(K.history) ?? []).length, disk.has(K.draft)], [true, null, 1, false], "only shaped: goes, nothing filed");

  // The phone in lbs, with a draft from before drafts kept their unit.
  fresh(pushDraft({ unitIsKg: undefined }));
  disk.set(K.unit, "lbs");
  const lbs = await store.fileStaleDraft(oct(15, 9, 0));
  eq([lbs.filed?.exercises[0].sets[1].weight, awarded[0]?.isKg], ["36.287", false], "the phone in lbs: read as lbs, stored in kg");

  // A custom workout started to be added to the program.
  const custom = pushDraft({
    isFreeWorkout: true, freeWorkoutAddToProgram: true,
    workoutInfo: { ...pushDraft().workoutInfo, name: "Arms", programId: undefined, dayId: undefined, plan: undefined },
  });
  fresh(custom);
  await store.fileStaleDraft(oct(15, 9, 0));
  eq(read<SavedProgram[]>(K.programs)?.[0].extraWorkouts, ["Arms"], "a custom workout set to be added joins the program, as Finish does");
  disk.set(K.draft, JSON.stringify(custom));
  await store.fileStaleDraft(oct(15, 9, 5));
  eq(read<SavedProgram[]>(K.programs)?.[0].extraWorkouts, ["Arms"], "and only once");

  // A custom workout carried past midnight (no program, so the day turns at
  // midnight): still being logged, it's left to carry on; quiet, it's filed.
  fresh(null);
  disk.set(K.programs, JSON.stringify([]));
  disk.set(K.start, String(oct(14, 23, 0).getTime()));
  disk.set(K.draft, JSON.stringify(pushDraft({ savedAt: oct(15, 0, 20).getTime() })));
  disk.delete(K.notice);
  let heard = 0;
  const off = store.onUnfinishedFiled(() => { heard += 1; });
  const going = await store.fileStaleDraft(oct(15, 0, 30));
  eq([going.stale, disk.has(K.draft), disk.has(K.start), disk.has(K.notice), heard], [false, true, true, false, 0],
    "12:30am, logged at 12:20: still going, left to carry on");
  const quiet = await store.fileStaleDraft(oct(15, 1, 30));
  eq([quiet.stale, quiet.filed?.date, disk.has(K.draft), disk.has(K.start), heard], [true, "2026-10-14", false, false, 1],
    "1:30am, nothing since 12:20: filed under its day, its clock gone, and said so");
  off();

  // The notice: kept until shown, shown once.
  eq(await store.takeUnfinishedNotice(), quiet.filed ? noticeFor(quiet.filed) : "nothing filed", "the notice waits to be shown");
  eq(await store.takeUnfinishedNotice(), null, "...and shows once");

  // The launch, the Workout tab and the watcher asking at once: filed once.
  fresh(pushDraft());
  let told = 0;
  const off2 = store.onUnfinishedFiled(() => { told += 1; });
  const both = await Promise.all([store.fileStaleDraft(oct(15, 9, 0)), store.fileStaleDraft(oct(15, 9, 0))]);
  off2();
  eq([both.map(b => b.stale), (read<CompletedWorkout[]>(K.history) ?? []).length, told], [[true, false], 2, 1],
    "asked twice at once: one filing, one notice");

  // Finish's own save goes the same road.
  fresh(null);
  const finished: CompletedWorkout = { ...OLD, id: "finish_1", date: "2026-10-15", completedAt: iso(oct(15, 19, 0)) };
  const after = await store.saveSessionToHistory(finished, true);
  eq([after.map(w => w.id), read<string[]>(K.dates), pushes], [["finish_1", "old"], ["2026-10-10", "2026-10-15"], 1], "Finish: history, dates and a backup, as before");
}

void (async () => {
  await storeChecks();
  if (failures.length) {
    console.error(failures.join("\n"));
    throw new Error(`verify-unfinished-session: ${failures.length} failed, ${passed} passed`);
  }
  console.log(`verify-unfinished-session: all ${passed} checks passed`);
})();
