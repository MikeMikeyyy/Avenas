// Bringing another app's workout history in, and sending ours out (Settings >
// Import & Export, user request 2026-10-23).
//
//   1. Reading CSV: quotes, separators and line breaks inside fields, a
//      byte-order mark, semicolons, and what's written reads back the same.
//   2. The exports as Hevy and Strong write them (Hevy's real sample row for
//      row, Strong's older and newer formats): workouts, exercises in order, a
//      superset's sets kept together, warm-ups, holds, distances, notes,
//      units, a rest timer row that isn't a set, a file that isn't an export,
//      dates in another language.
//   3. Into sessions: kg and lbs as the app stores them, a day already logged
//      left out whole (user decision, 2026-10-23), an exercise's chosen name.
//   4. Ours out and back in: every set, hold and note comes back.
//   5. Which Avenas exercise a Hevy or Strong name is.
//   6. The real utils/importStore.ts on an in-memory phone: an import saved,
//      the same file again adding nothing, undone exactly, and every failure
//      leaving the phone as it was.
//   7. A restore of an account holding more than the API's 1000 rows a read,
//      against every migration (scripts/harness), which used to keep the
//      newest 1000 workouts and lose the rest.
//   8. How long it all takes with a long history: the import, and the history
//      readers every screen runs.
//
// Run:  npx tsx scripts/verify-import.ts
// Exits non-zero if any assertion fails.

import { connectDb, freshApp, on, stubModule, type Phone } from "./harness/app";
import { createDb } from "./harness/db";
import { detectDelimiter, parseCsv, toCsv } from "../utils/csv";
import {
  DATES_UNREADABLE, NOTHING_TO_IMPORT, NOT_AN_EXPORT,
  exercisesIn, parseDurationText, parseExportTime, planImport, readWorkoutCsv, type ParsedImport,
} from "../utils/workoutImport";
import { IMPORT_NAME_TARGETS, matchExerciseName } from "../utils/exerciseMatch";
import { workoutsToCsv } from "../utils/workoutExport";
import { ImportTooLargeError, loadImports, saveImport, undoImport } from "../utils/importStore";
import { EXERCISES } from "../constants/exerciseData";
import { IMPORT_LOG_KEY, WORKOUT_DATES_KEY, WORKOUT_HISTORY_KEY, type CompletedWorkout } from "../constants/programs";
import { formatWeightForDisplay } from "../utils/units";
import { addDaysYMD, toYMD } from "../utils/dates";
import { buildPrevSetsLookup } from "../utils/workout";
import { collectExerciseHistory, computeMuscleGroupStats } from "../utils/progressStats";
import { buildJournalFeed } from "../utils/journalFeed";
import { bestLiftsBefore } from "../utils/achievements";
import type * as Cloud from "../lib/cloud";

declare const process: { exitCode?: number };
declare const performance: { now(): number };

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const ok = (cond: boolean, label: string) => eq(cond, true, label);

/** The data of a file that reads, or a failure recorded and null. */
function read(text: string, label: string, now = new Date(2026, 9, 23, 12)): ParsedImport | null {
  const r = readWorkoutCsv(text, now);
  if (!r.ok) { failures.push(`✗ ${label}: didn't read (${r.error})`); return null; }
  passed += 1;
  return r.data;
}
const setsOf = (w: CompletedWorkout) => w.exercises.map(e => [e.name, e.sets.map(s => `${s.type === "warmup" ? "W " : ""}${s.weight}×${s.reps}`)]);

// ─── 1. CSV ──────────────────────────────────────────────────────────────────

eq(parseCsv('a,b,c\r\n1,"two, three","say ""hi"""\n'), [["a", "b", "c"], ["1", "two, three", 'say "hi"']], "csv: quoted separators and quotes");
eq(parseCsv('a,b\n"line one\nline two",x\n\n'), [["a", "b"], ["line one\nline two", "x"]], "csv: a line break inside quotes, a blank line left out");
eq(parseCsv("﻿a;b\n1;2,5"), [["a", "b"], ["1", "2,5"]], "csv: a byte-order mark, semicolons (commas then are text)");
eq(detectDelimiter('"Workout #";"Date";"Workout Name"\n'), ";", "csv: semicolons found in the header");
eq(detectDelimiter("title,start_time,end_time\n"), ",", "csv: commas found in the header");
eq(parseCsv("a,b,\n1,,"), [["a", "b", ""], ["1", "", ""]], "csv: empty fields at the end of a row");
{
  const rows = [["name", "notes"], ["Bench, heavy", 'He said "go"\non two lines'], [" padded ", "82.5"]];
  eq(parseCsv(toCsv(rows)), rows, "csv: what's written reads back the same");
  ok(toCsv(rows).startsWith("﻿"), "csv: written with a byte-order mark, for Excel");
}

// ─── 2. The exports ──────────────────────────────────────────────────────────

eq(parseExportTime("22 Dec 2025, 08:00")?.getTime(), new Date(2025, 11, 22, 8, 0).getTime(), "time: Hevy's");
eq(parseExportTime("2020-12-30 18:51:52")?.getTime(), new Date(2020, 11, 30, 18, 51, 52).getTime(), "time: Strong's");
eq(parseExportTime("Dec 22, 2025, 8:05 PM")?.getTime(), new Date(2025, 11, 22, 20, 5).getTime(), "time: month first, 12-hour");
eq(parseExportTime("22 September 2025, 12:30 am")?.getTime(), new Date(2025, 8, 22, 0, 30).getTime(), "time: a full month name, 12:30 am");
eq(parseExportTime("31 Feb 2025, 10:00"), null, "time: a date that doesn't exist");
eq(parseExportTime("22 thg 12 2025, 08:00"), null, "time: a month in another language isn't guessed at");
eq([parseDurationText("2h 38m"), parseDurationText("45m"), parseDurationText("1h"), parseDurationText("1:05:00"), parseDurationText("90s")],
  [9480, 2700, 3600, 3900, 90], "duration: Strong's ways of writing one");

// Hevy's own sample export, row for row.
const HEVY_SAMPLE = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Pull Up (Assisted)",,"",0,"normal",21,10,,0,8.5
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Leg Press (Machine)",,"",1,"normal",90,12,,0,7.5
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Crunch (Weighted)",,"",2,"normal",10,15,,0,8
"Morning workout","22 Dec 2025, 08:00","22 Dec 2025, 08:37","","Seated Shoulder Press (Machine)",,"",3,"normal",25,8,,0,9
`;
const sample = read(HEVY_SAMPLE, "hevy sample");
if (sample) {
  eq([sample.source, sample.weightUnit, sample.workouts.length], ["hevy", "kg", 1], "hevy sample: one workout, in kg");
  const w = sample.workouts[0];
  eq([w.title, w.date, (w.end.getTime() - w.start.getTime()) / 60000], ["Morning workout", "2025-12-22", 37], "hevy sample: its name, day and 37 minutes");
  eq(w.exercises.map(e => [e.name, e.sets.length]), [["Pull Up (Assisted)", 1], ["Leg Press (Machine)", 1], ["Crunch (Weighted)", 1], ["Seated Shoulder Press (Machine)", 1]],
    "hevy sample: four exercises in order");
}

// A fuller Hevy file, in lbs: a warm-up, failure and drop sets, a superset
// whose rows alternate, notes with a quote, comma and line break, a hold, a
// run, a set with nothing in it, and a second workout that evening.
const HEVY_LBS = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Bench Press (Barbell)",,"Pause reps
on the last set",0,"warmup",135,10,,0,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Bench Press (Barbell)",,"Pause reps
on the last set",1,"normal",225,5,,0,8
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Bench Press (Barbell)",,"Pause reps
on the last set",2,"failure",225,4,,0,10
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Lateral Raise (Dumbbell)",0,"",0,"normal",25,12,,0,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Triceps Pushdown",0,"",0,"normal",50,15,,0,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Lateral Raise (Dumbbell)",0,"",1,"dropset",20,10,,0,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Triceps Pushdown",0,"",1,"normal",50,12,,0,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Plank",,"",0,"normal",,,,60,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Plank",,"",1,"normal",,,,45,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Running",,"",0,"normal",,,1.5,600,
"Push, heavy","28 Mar 2025, 17:29","28 Mar 2025, 18:52","Felt strong, ""PR"" day","Face Pull",,"",0,"normal",,,,0,
"Band work","28 Mar 2025, 19:00","28 Mar 2025, 19:10","","Band Pullaparts",,"",0,"normal",,20,,0,
`;
const lbs = read(HEVY_LBS, "hevy lbs");
if (lbs) {
  eq([lbs.weightUnit, lbs.distanceUnit, lbs.workouts.length, lbs.skippedRows], ["lb", "mi", 2, 1], "hevy lbs: two workouts, lbs and miles, the empty set left out");
  const push = lbs.workouts[0];
  eq(push.exercises.map(e => e.name), ["Bench Press (Barbell)", "Lateral Raise (Dumbbell)", "Triceps Pushdown", "Plank", "Running"],
    "hevy lbs: a superset's alternating rows make one exercise each, in order");
  eq(push.exercises[1].sets.map(s => s.weight), [25, 20], "hevy lbs: the superset's sets stay with their exercise");
  eq([push.notes, push.exercises[0].notes], ['Felt strong, "PR" day', "Pause reps\non the last set"], "hevy lbs: notes with quotes, commas and line breaks");
  eq(exercisesIn(lbs).slice(0, 2), [{ name: "Bench Press (Barbell)", sets: 3 }, { name: "Lateral Raise (Dumbbell)", sets: 2 }],
    "hevy lbs: the review lists exercises by how many sets they have");

  const plan = planImport(lbs, { weightUnit: "lb", choices: {}, history: [], now: 1 });
  const [band, pushDay] = plan.workouts; // newest first
  eq([band.workoutName, pushDay.workoutName, plan.sets], ["Band work", "Push, heavy", 11], "plan: newest first, every set");
  eq(setsOf(pushDay)[0], ["Bench Press (Barbell)", ["W 61.235×10", "102.058×5", "102.058×4"]],
    "plan: lbs stored as kg the way a typed lb weight is, warm-up kept, failure a working set");
  eq(formatWeightForDisplay(pushDay.exercises[0].sets[1].weight, false), "225", "plan: and shows as 225 lbs again");
  const plank = pushDay.exercises[3];
  eq([plank.isIsometric, plank.sets.map(s => s.reps), plank.sets.map(s => s.weight)], [true, ["60", "45"], ["", ""]], "plan: time with no reps is a hold, seconds as reps");
  const run = pushDay.exercises[4];
  eq([run.isIsometric, run.sets[0].reps, run.notes], [true, "600", "Distance: 1.5 mi"], "plan: a run's distance goes into its notes");
  eq(band.exercises[0].sets[0], { type: "working", weight: "", reps: "20", done: true }, "plan: no weight stays blank");
  eq([pushDay.programId, pushDay.durationSeconds, pushDay.date, pushDay.sessionNotes, pushDay.completedAt],
    ["", 83 * 60, "2025-03-28", 'Felt strong, "PR" day', new Date(2025, 2, 28, 18, 52).toISOString()],
    "plan: a free workout, its length, day, notes and real finish");
  ok(new Set(plan.workouts.map(w => w.id)).size === plan.workouts.length, "plan: every session its own id");

  const chosen = planImport(lbs, {
    weightUnit: "lb", history: [], now: 1,
    choices: { "Bench Press (Barbell)": { name: "Barbell Bench Press" }, "Triceps Pushdown": { name: "Cable Kickback", customId: "cx1" } },
  });
  eq(chosen.workouts[1].exercises.slice(0, 3).map(e => [e.name, e.customId ?? null]),
    [["Barbell Bench Press", null], ["Lateral Raise (Dumbbell)", null], ["Cable Kickback", "cx1"]],
    "plan: each exercise as chosen, a custom one with its id, the rest under their own names");

  const taken = planImport(lbs, { weightUnit: "lb", choices: {}, history: [{ date: "2025-03-28" }] });
  eq([taken.workouts.length, taken.skippedDays], [0, 2], "plan: a day already logged in Avenas is left out whole, both its workouts");
}

// Strong's older export: commas, no unit, "2h 38m", W for a warm-up, a rest
// timer row, notes on a set.
const STRONG_OLD = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2020-12-30 18:51:52,Evening Workout,2h 38m,Snatch (Barbell),1,40.0,3,0,0,,,
2020-12-30 18:51:52,Evening Workout,2h 38m,Snatch (Barbell),2,50.0,2,0,0,,,
2020-12-30 18:51:52,Evening Workout,2h 38m,Squat (Barbell),W,60.0,5,0,0,,,
2020-12-30 18:51:52,Evening Workout,2h 38m,Squat (Barbell),1,100.0,5,0,0,"Belt on, felt good",Long one,8
2020-12-30 18:51:52,Evening Workout,2h 38m,Squat (Barbell),Rest Timer,0,0,0,120,,,
2020-12-30 18:51:52,Evening Workout,2h 38m,Squat (Barbell),2,100.0,5,0,0,,,
2021-01-02 09:05:00,Morning,45m,Plank,1,0,0,0,90,,,
`;
const strongOld = read(STRONG_OLD, "strong (older)");
if (strongOld) {
  eq([strongOld.source, strongOld.weightUnit, strongOld.workouts.length, strongOld.skippedRows], ["strong", null, 2, 1],
    "strong (older): no unit in the file, two workouts, the rest timer isn't a set");
  const plan = planImport(strongOld, { weightUnit: "kg", choices: {}, history: [] });
  const evening = plan.workouts[1];
  eq(setsOf(evening), [["Snatch (Barbell)", ["40×3", "50×2"]], ["Squat (Barbell)", ["W 60×5", "100×5", "100×5"]]], "strong (older): sets, the W a warm-up");
  eq([evening.durationSeconds, evening.completedAt, evening.sessionNotes, evening.exercises[1].notes],
    [9480, new Date(new Date(2020, 11, 30, 18, 51, 52).getTime() + 9480_000).toISOString(), "Long one", "Belt on, felt good"],
    "strong (older): the finish is its start and length, notes kept");
  eq([plan.workouts[0].exercises[0].isIsometric, plan.workouts[0].exercises[0].sets[0].reps], [true, "90"], "strong (older): a plank's seconds");
  eq(planImport(strongOld, { weightUnit: "lb", choices: {}, history: [] }).workouts[1].exercises[1].sets[1].weight, "45.359",
    "strong (older): when the person says lbs, 100 is 100 lbs");
}

// Strong's newer export: semicolons, quoted, a workout number, seconds,
// kilograms and metres named.
const STRONG_NEW = `"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"
"1";"2024-05-01 07:00:00";"Legs";"3600";"Leg Press";"1";"140";"10";"";"";"";"";"Quick one"
"1";"2024-05-01 07:00:00";"Legs";"3600";"Leg Press";"2";"150";"8";"";"";"";"";"Quick one"
"2";"2024-05-03 07:00:00";"Cardio";"1200";"Rowing Machine";"1";"";"";"";"2000";"480";"";""
`;
const strongNew = read(STRONG_NEW, "strong (newer)");
if (strongNew) {
  eq([strongNew.weightUnit, strongNew.distanceUnit, strongNew.workouts.length], ["kg", "m", 2], "strong (newer): kg and metres from the header");
  const plan = planImport(strongNew, { weightUnit: "kg", choices: {}, history: [] });
  eq([setsOf(plan.workouts[1]), plan.workouts[1].durationSeconds, plan.workouts[1].sessionNotes],
    [[["Leg Press", ["140×10", "150×8"]]], 3600, "Quick one"], "strong (newer): its sets, length and notes");
  eq([plan.workouts[0].exercises[0].sets[0].reps, plan.workouts[0].exercises[0].notes], ["480", "Distance: 2000 m"], "strong (newer): a row's time and distance");
}

{
  const r = readWorkoutCsv("name,age\nSam,30\n");
  eq(r.ok ? "read" : r.error, NOT_AN_EXPORT, "a file that isn't an export says so");
  const vi = readWorkoutCsv(HEVY_SAMPLE.replace(/22 Dec 2025/g, "22 thg 12 2025"));
  eq(vi.ok ? "read" : vi.error, DATES_UNREADABLE, "dates in another language say to switch to English");
  const empty = readWorkoutCsv(HEVY_SAMPLE.split("\n")[0]);
  eq(empty.ok ? "read" : empty.error, NOTHING_TO_IMPORT, "a header and nothing else has nothing to import");
  const future = readWorkoutCsv(HEVY_SAMPLE, new Date(2025, 11, 21, 12));
  eq(future.ok ? "read" : future.error, NOTHING_TO_IMPORT, "a file with only workouts after today has nothing to import");
  const both = readWorkoutCsv(`${HEVY_SAMPLE}${HEVY_SAMPLE.split("\n")[1].replace(/22 Dec 2025/g, "21 Dec 2025")}\n`, new Date(2025, 11, 21, 12));
  eq(both.ok ? [both.data.workouts.map(w => w.date), both.data.futureWorkouts] : both.error, [["2025-12-21"], 1],
    "a workout dated after today is left out, the rest read");
}

// ─── 4. Ours out and back ────────────────────────────────────────────────────

const OURS: CompletedWorkout[] = [
  {
    id: "w1", date: "2026-10-20", completedAt: new Date(2026, 9, 20, 19, 15).toISOString(), workoutName: "Upper",
    durationSeconds: 3600, programId: "p1", dayId: "a0", sessionNotes: "Good, then tired\nnext time eat first",
    exercises: [
      { name: "Barbell Bench Press", notes: "Elbows in, \"tight\"", sets: [
        { type: "warmup", weight: "40", reps: "10", done: true },
        { type: "working", weight: "102.058", reps: "5", done: true },
        { type: "working", weight: "102.058", reps: "4", done: false },
      ] },
      { name: "Plank", notes: "", isIsometric: true, sets: [{ type: "working", weight: "", reps: "60", done: true }] },
    ],
  },
  {
    id: "w2", date: "2026-10-21", completedAt: new Date(2026, 9, 22, 0, 40).toISOString(), workoutName: "Late one",
    durationSeconds: 1800, programId: "", exercises: [{ name: "Pull-Up", notes: "", sets: [{ type: "working", weight: "", reps: "8", done: true }] }],
  },
];
for (const isKg of [true, false]) {
  const unit = isKg ? "kg" : "lbs";
  const csv = workoutsToCsv(OURS, [{ id: "p1", name: "Strength" }], isKg);
  const rows = parseCsv(csv);
  eq(rows[0][8], isKg ? "weight_kg" : "weight_lbs", `export (${unit}): the header names the unit`);
  eq(rows[1].slice(0, 11), ["2026-10-20", "Upper", "Strength", "2026-10-20 18:15", "2026-10-20 19:15", "Barbell Bench Press", "1", "warmup",
    isKg ? "40" : "88.2", "10", ""], `export (${unit}): a set's row`);
  eq(rows[4].slice(5, 12), ["Plank", "1", "working", "", "", "60", "yes"], `export (${unit}): a hold's time under seconds`);
  const back = read(csv, `export (${unit}) reads back`);
  if (!back) continue;
  eq(back.source, "avenas", `export (${unit}): known as ours`);
  const plan = planImport(back, { weightUnit: back.weightUnit ?? "kg", choices: {}, history: [] });
  const byDay = new Map(plan.workouts.map(w => [w.date, w]));
  for (const o of OURS) {
    const b = byDay.get(o.date);
    if (!b) { failures.push(`✗ export (${unit}): ${o.date} didn't come back`); continue; }
    eq([b.workoutName, b.completedAt, b.durationSeconds, b.sessionNotes ?? ""], [o.workoutName, o.completedAt, o.durationSeconds, o.sessionNotes ?? ""],
      `export (${unit}): ${o.workoutName}'s name, finish, length and notes come back`);
    eq(b.exercises.map(e => [e.name, e.notes, !!e.isIsometric, e.sets.map(s => [s.type, formatWeightForDisplay(s.weight, isKg), s.reps, s.done])]),
      o.exercises.map(e => [e.name, e.notes, !!e.isIsometric, e.sets.map(s => [s.type, formatWeightForDisplay(s.weight, isKg), s.reps, s.done])]),
      `export (${unit}): ${o.workoutName}'s sets come back as they show`);
  }
}
eq(parseCsv(workoutsToCsv([{ ...OURS[1], exercises: [] }], [], true))[1].slice(0, 6), ["2026-10-21", "Late one", "", "2026-10-22 00:10", "2026-10-22 00:40", ""],
  "export: a workout with no sets still has its row");

// ─── 5. Exercise names ───────────────────────────────────────────────────────

const visible = new Set(EXERCISES.filter(e => !e.hidden).map(e => e.name));
for (const target of IMPORT_NAME_TARGETS) ok(visible.has(target), `names: "${target}" is in the picker`);
const EXPECT: [string, "matched" | "check" | "none", string?][] = [
  ["Bench Press (Barbell)", "matched", "Barbell Bench Press"],
  ["Squat (Barbell)", "matched", "Barbell Back Squat"],
  ["Deadlift (Barbell)", "matched", "Deadlift"],
  ["Overhead Press (Barbell)", "matched", "Overhead Press"],
  ["Bench Press - Close Grip (Barbell)", "matched", "Close-Grip Bench Press"],
  ["Incline Bench Press (Dumbbell)", "matched", "Incline Dumbbell Press"],
  ["Lat Pulldown (Cable)", "matched", "Lat Pulldown"],
  ["Pull Up", "matched", "Pull-Up"],
  ["Pull Up (Assisted)", "matched", "Assisted Pull-Up"],
  ["Chin Up (Assisted)", "check", "Assisted Pull-Up"],
  ["Leg Press (Machine)", "matched", "Leg Press"],
  ["Romanian Deadlift (Dumbbell)", "matched", "Dumbbell Romanian Deadlift"],
  ["Lateral Raise (Dumbbell)", "matched", "Lateral Raise"],
  ["Lateral Raise (Cable)", "matched", "Cable Lateral Raise"],
  ["Bicep Curl (Barbell)", "matched", "Barbell Curl"],
  ["Bicep Curl (Dumbbell)", "matched", "Biceps Curl"],
  ["Reverse Curl (Barbell)", "matched", "Reverse Curl"],
  ["Triceps Pushdown", "matched", "Tricep Pushdown"],
  ["Skullcrusher (Barbell)", "matched", "Skull Crusher"],
  ["Chest Dip", "matched", "Dips"],
  ["Push Up", "matched", "Push-Up"],
  ["Farmers Walk", "matched", "Farmer's Walk"],
  ["Back Extension (Weighted Hyperextension)", "check", "Back Extension"],
  ["Hammer Curl (Dumbbell)", "matched", "Hammer Curl"],
  ["Plank", "matched", "Plank"],
  ["Zzzz Flarp Machine", "none"],
];
for (const [name, kind, want] of EXPECT) {
  const m = matchExerciseName(name);
  eq(m.kind === "none" ? ["none"] : [m.kind, m.name], kind === "none" ? ["none"] : [kind, want], `names: ${name}`);
}
eq(matchExerciseName("iso-lateral row (MACHINE)", [{ id: "cx9", name: "Iso-Lateral Row (Machine)", muscles: ["Back"] }]),
  { kind: "matched", name: "Iso-Lateral Row (Machine)", customId: "cx9" }, "names: your own custom exercise of the name, by its id");
eq(matchExerciseName("Iso-Lateral Row (Machine)", [{ id: "cx9", name: "Iso-Lateral Row (Machine)", muscles: ["Back"], deletedAt: "2026-10-01" }]),
  { kind: "matched", name: "Seated Machine Row" }, "names: a deleted custom exercise isn't matched, the catalogue's is");

// ─── 6. Saving and undoing ───────────────────────────────────────────────────

const AVENAS_ONE: CompletedWorkout = {
  id: "workout_1", date: "2025-03-27", completedAt: "2025-03-27T08:00:00.000Z", workoutName: "Lower", durationSeconds: 1800,
  programId: "", exercises: [{ name: "Leg Press", notes: "", sets: [{ type: "working", weight: "100", reps: "10", done: true }] }],
};
const SAM: Phone = { uid: "sam", name: "Sam", store: new Map(), offline: false };
const fresh = () => new Map([
  [WORKOUT_HISTORY_KEY, JSON.stringify([AVENAS_ONE])],
  [WORKOUT_DATES_KEY, JSON.stringify(["2025-03-27"])],
]);
/** A phone whose storage fails writing `key`. */
class FailingStore extends Map<string, string> {
  constructor(entries: Map<string, string>, private failing: string) { super(entries); }
  set(key: string, value: string) {
    if (this.failing === key && this.size > 0) throw new Error("disk full");
    return super.set(key, value);
  }
}

async function storeChecks() {
  if (!lbs) return;
  const plan = planImport(lbs, { weightUnit: "lb", choices: {}, history: [AVENAS_ONE], now: 7 });
  SAM.store = fresh();
  const first = await on(SAM, () => saveImport(plan.workouts, "hevy", { now: 1000 }));
  eq(first, { added: 2, skipped: 0 }, "store: an import adds its workouts");
  const history = JSON.parse(SAM.store.get(WORKOUT_HISTORY_KEY)!) as CompletedWorkout[];
  eq([history.length, history[0].id], [3, "workout_1"], "store: after what was there");
  eq(JSON.parse(SAM.store.get(WORKOUT_DATES_KEY)!), ["2025-03-27", "2025-03-28"], "store: its day joins the workout dates once");
  const log = await on(SAM, () => loadImports());
  eq(log.map(r => [r.at, r.source, r.workouts.length]), [[1000, "hevy", 2]], "store: the import is on record to undo");

  eq(await on(SAM, () => saveImport(plan.workouts, "hevy", { now: 2000 })), { added: 0, skipped: 2 }, "store: the same file again adds nothing");
  eq((await on(SAM, () => loadImports())).length, 1, "store: ...and records nothing");

  // Something logged in Avenas since, on another day: the undo leaves it.
  const later: CompletedWorkout = { ...AVENAS_ONE, id: "workout_2", date: "2025-03-29", completedAt: "2025-03-29T08:00:00.000Z" };
  SAM.store.set(WORKOUT_HISTORY_KEY, JSON.stringify([later, ...JSON.parse(SAM.store.get(WORKOUT_HISTORY_KEY)!)]));
  SAM.store.set(WORKOUT_DATES_KEY, JSON.stringify(["2025-03-27", "2025-03-28", "2025-03-29"]));
  eq(await on(SAM, () => undoImport(1000)), 2, "store: an undo takes out what it added");
  eq(JSON.parse(SAM.store.get(WORKOUT_HISTORY_KEY)!), [later, AVENAS_ONE], "store: ...and nothing else");
  eq(JSON.parse(SAM.store.get(WORKOUT_DATES_KEY)!), ["2025-03-27", "2025-03-29"], "store: its day leaves the dates");
  eq(JSON.parse(SAM.store.get(IMPORT_LOG_KEY)!), [], "store: ...and its record goes");
  eq(await on(SAM, () => undoImport(1000)), 0, "store: undoing it twice does nothing");

  // Failures leave the phone as it was.
  SAM.store = fresh();
  const before = new Map(SAM.store);
  let threw: unknown = null;
  try { await on(SAM, () => saveImport(plan.workouts, "hevy", { maxHistoryChars: 500 })); } catch (e) { threw = e; }
  ok(threw instanceof ImportTooLargeError, "store: more than the phone can hold is refused");
  eq([...SAM.store], [...before], "store: ...and nothing is written");

  SAM.store = new FailingStore(fresh(), WORKOUT_DATES_KEY);
  threw = null;
  try { await on(SAM, () => saveImport(plan.workouts, "hevy")); } catch (e) { threw = e; }
  ok(threw instanceof Error, "store: a write that fails, fails out loud");
  eq([...SAM.store], [...before], "store: ...and what was written is put back");

  SAM.store = new Map([[WORKOUT_HISTORY_KEY, "{not json"]]);
  threw = null;
  try { await on(SAM, () => saveImport(plan.workouts, "hevy")); } catch (e) { threw = e; }
  ok(threw instanceof Error && SAM.store.get(WORKOUT_HISTORY_KEY) === "{not json", "store: a history that can't be read is never written over");
}

// ─── 7. A restore past 1000 workouts ─────────────────────────────────────────

/** `n` sessions, one a day back from `last`, with two finishing at the same
 *  moment on each page's edge so a tie straddles it. */
function longHistory(n: number, last = "2026-10-01"): CompletedWorkout[] {
  return Array.from({ length: n }, (_, i): CompletedWorkout => {
    const date = addDaysYMD(last, -i);
    const at = new Date(`${date}T07:30:00.000Z`);
    if (i === 1000) at.setTime(new Date(`${addDaysYMD(last, -999)}T07:30:00.000Z`).getTime());
    return {
      id: `workout_${i}`, date, completedAt: at.toISOString(), workoutName: i % 2 ? "Pull" : "Push", durationSeconds: 3600, programId: "",
      exercises: [
        { name: "Barbell Bench Press", notes: "", sets: [{ type: "working", weight: String(60 + (i % 40)), reps: "8", done: true }] },
        { name: "Lat Pulldown", notes: "", sets: [{ type: "working", weight: "55", reps: "10", done: true }] },
      ],
    };
  });
}

async function restoreChecks() {
  stubModule({ file: "lib/push.ts" }, { unregisterPushToken: async () => {} });
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- after the stub above, see freshApp
  const cloud = freshApp(() => require("../lib/cloud") as typeof Cloud);
  const db = await createDb({ apiGrants: true });
  connectDb(db);
  const LENA: Phone = { uid: "eeeeeeee-0000-4000-8000-00000000000e", name: "Lena", store: new Map(), offline: false };
  await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [LENA.uid, "lena@example.com"]);
  const SIGN_IN = [["@avenas/account_type", "gym_user"], ["@avenas/unit", "kg"]] as [string, string][];
  try {
    const history = longHistory(1234);
    LENA.store = new Map([...SIGN_IN, [WORKOUT_HISTORY_KEY, JSON.stringify(history)], [WORKOUT_DATES_KEY, JSON.stringify(history.map(w => w.date))]]);
    await on(LENA, () => cloud.pushAllLocalDataToCloud(LENA.uid));
    LENA.store = new Map(SIGN_IN);
    eq(await on(LENA, () => cloud.reconcileOnSignIn(LENA.uid)), "replaced", "restore: a new phone restores the account");
    const back = JSON.parse(LENA.store.get(WORKOUT_HISTORY_KEY) ?? "[]") as CompletedWorkout[];
    eq(back.length, 1234, "restore: every workout comes back, past the API's 1000 a read");
    eq([...new Set(back.map(w => `${w.date}|${w.completedAt}|${w.workoutName}`))].length, 1234, "restore: none twice, a tie on a page's edge included");
    ok(back.every((w, i) => i === 0 || back[i - 1].completedAt >= w.completedAt), "restore: newest first");
    eq((JSON.parse(LENA.store.get(WORKOUT_DATES_KEY) ?? "[]") as string[]).length, 1234, "restore: every day in the workout dates");
  } finally {
    await db.close();
  }
}

// ─── 8. A long history ───────────────────────────────────────────────────────

function hevyFile(workouts: number): string {
  const head = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"`;
  const lines = [head];
  const names = ["Bench Press (Barbell)", "Incline Bench Press (Dumbbell)", "Chest Fly (Dumbbell)", "Lateral Raise (Dumbbell)", "Triceps Pushdown", "Plank"];
  for (let i = 0; i < workouts; i++) {
    const d = new Date(2026, 9, 20 - i, 18, 0);
    const day = `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}`;
    for (const name of names) {
      for (let s = 0; s < 5; s++) {
        const timed = name === "Plank";
        lines.push(`"Push","${day}, 18:00","${day}, 19:05","","${name}",,"",${s},"${s === 0 ? "warmup" : "normal"}",${timed ? "" : 40 + s * 10},${timed ? "" : 8},,${timed ? 60 : 0},`);
      }
    }
  }
  return lines.join("\n");
}

function timingChecks() {
  const N = 2000;
  const text = hevyFile(N);
  let t = performance.now();
  const parsed = read(text, `a ${N}-workout file reads`, new Date(2026, 9, 23, 12));
  const readMs = performance.now() - t;
  if (!parsed) return;
  t = performance.now();
  const names = exercisesIn(parsed).map(e => matchExerciseName(e.name));
  const matchMs = performance.now() - t;
  t = performance.now();
  const plan = planImport(parsed, { weightUnit: "kg", choices: {}, history: [] });
  const planMs = performance.now() - t;
  eq([plan.workouts.length, plan.sets, names.length], [N, N * 30, 6], `long history: all ${N} workouts and their sets`);

  const history = plan.workouts;
  const json = JSON.stringify(history);
  const timings: [string, number][] = [["read the file", readMs], ["match its exercises", matchMs], ["plan the sessions", planMs]];
  const time = (label: string, fn: () => unknown) => { const s = performance.now(); fn(); timings.push([label, performance.now() - s]); };
  time("read the history back", () => JSON.parse(json));
  time("Previous: numbers", () => buildPrevSetsLookup(history, toYMD(new Date()), { name: "Push" })({ name: "Barbell Bench Press" }));
  time("an exercise's history", () => collectExerciseHistory(history, "Barbell Bench Press"));
  time("muscle groups", () => computeMuscleGroupStats(history, []));
  time("the Journal feed", () => buildJournalFeed({ entries: [], workouts: history, windowDays: 3650 }));
  time("best lifts (PRs)", () => bestLiftsBefore(history));
  console.log(`\nWith ${N} workouts (${(json.length / 1e6).toFixed(2)} MB saved), on this computer:`);
  for (const [label, ms] of timings) console.log(`  ${label.padEnd(24)} ${ms.toFixed(0).padStart(5)} ms`);
  // A phone is several times slower than this; seconds here would be a hang there.
  for (const [label, ms] of timings) ok(ms < 1500, `long history: ${label} takes under 1.5s here (${ms.toFixed(0)} ms)`);
}

timingChecks();
storeChecks()
  .then(restoreChecks)
  .catch(e => { failures.push(`✗ checks threw: ${(e as Error).stack ?? e}`); })
  .finally(() => {
    for (const f of failures) console.log(f);
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) process.exitCode = 1;
    else console.log("✓ import and export hold");
  });
