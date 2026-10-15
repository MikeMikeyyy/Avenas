// Exercise renames and the picker's search (utils/exerciseNames.ts,
// utils/exerciseRenameMigration.ts, utils/exerciseSearch.ts).
//
// The catalogue renamed exercises ("Dumbbell Lateral Raise" → "Lateral Raise")
// without rewriting a single logged session. These checks hold that promise:
// a session logged under a former name still feeds the new name's "last time"
// numbers, chart, records, Exercise History, muscles and favourites; programs
// and favourites take the new names (never a custom exercise's); and search
// finds what people actually type.
//
// Run:  npx tsx scripts/verify-exercise-renames.ts
// Exits non-zero if any assertion fails.

import { EXERCISES } from "../constants/exerciseData";
import type { CompletedWorkout, ProgramDayRef, SavedProgram } from "../constants/programs";
import { currentExerciseName, exerciseKey, isFormerExerciseName } from "../utils/exerciseNames";
import { exerciseByName, exerciseIdByName } from "../utils/exerciseLookup";
import { musclesForExercise } from "../utils/muscleGroups";
import { buildPrevByName, normalizeExerciseName } from "../utils/workout";
import { collectExerciseHistory, collectLoggedExercisesForDay, computePRs } from "../utils/progressStats";
import { exerciseHistoryRows } from "../utils/exerciseHistory";
import { computeSessionRecords } from "../utils/workoutSummary";
import { isFavourite } from "../utils/exerciseFavourites";
import { renameFavourites, renameProgramExercises } from "../utils/exerciseRenameMigration";
import { exerciseSearchDoc, parseQuery, rankMatch, searchDoc, stem } from "../utils/exerciseSearch";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}
const ok = (cond: boolean, label: string) => eq(cond, true, label);

// ─── the catalogue's own rules ───────────────────────────────────────────────

const lower = (s: string) => s.trim().toLowerCase();
const live = new Set(EXERCISES.map(e => lower(e.name)));
const formers = EXERCISES.flatMap(e => (e.formerNames ?? []).map(f => ({ f, owner: e.name })));
ok(formers.length > 0, "the catalogue records former names");
ok(formers.every(({ f }) => !live.has(lower(f))), "no former name is also a live exercise's name");
eq(new Set(formers.map(x => lower(x.f))).size, formers.length, "no former name belongs to two exercises");
ok(formers.every(({ f, owner }) => exerciseKey(f) === lower(owner)), "every former name keys to its exercise");
ok(EXERCISES.filter(e => !e.hidden).every(e => (e.instructions ?? []).length > 0), "every listed exercise has steps");
ok(EXERCISES.every(e => !/—/.test([e.name, ...(e.instructions ?? [])].join(" "))), "no em dash in names or steps");

// ─── one name, before and after ──────────────────────────────────────────────

eq(currentExerciseName("Dumbbell Lateral Raise"), "Lateral Raise", "a former name resolves to the current one");
eq(currentExerciseName("  dumbbell lateral raise "), "Lateral Raise", "...whatever the case and spacing");
eq(currentExerciseName("Lateral Raise"), "Lateral Raise", "a current name is itself");
eq(currentExerciseName("My Odd Lift"), "My Odd Lift", "a name the catalogue never had is left alone");
eq(exerciseKey("Dumbbell Curl"), "biceps curl", "the key of a former name is the current one's");
eq(normalizeExerciseName("Dumbbell Curl"), exerciseKey("Biceps Curl"), "normalizeExerciseName goes through the renames");
ok(isFormerExerciseName("Barbell Row") && !isFormerExerciseName("Bent-Over Row"), "former names are recognised as such");
eq(exerciseByName("Dumbbell Curl")?.name, "Biceps Curl", "the catalogue entry is found by a former name");
eq(exerciseIdByName("Dumbbell Lateral Raise"), exerciseIdByName("Lateral Raise"), "...and so is its picture");
eq(musclesForExercise({ name: "Dumbbell Lateral Raise" }, []), ["Shoulders"], "a former name keeps its muscle on the radar");
eq(musclesForExercise({ name: "Cuban Press" }, []), ["Shoulders"], "a retired exercise still counts toward its muscle");
ok(exerciseByName("Cuban Press")?.hidden === true, "a retired exercise is kept, hidden");

// ─── history logged under the old name ───────────────────────────────────────

function session(id: string, date: string, name: string, weight: string, reps = "8"): CompletedWorkout {
  return {
    id, date, completedAt: `${date}T18:00:00.000Z`, workoutName: "Shoulders", durationSeconds: 3000,
    programId: "p1", dayId: "d0",
    exercises: [{ name, notes: "", sets: [{ type: "working", weight, reps, done: true }] }],
  } as CompletedWorkout;
}
const oldA = session("w1", "2026-09-01", "Dumbbell Lateral Raise", "10");
const oldB = session("w2", "2026-09-08", "Dumbbell Lateral Raise", "12");
const newC = session("w3", "2026-10-12", "Lateral Raise", "14");
const history = [newC, oldB, oldA];

const prev = buildPrevByName([oldB, oldA]);
ok(prev[exerciseKey("Lateral Raise")] !== undefined, "last time's numbers logged under the old name reach the new name");
const points = collectExerciseHistory(history, "Lateral Raise");
eq(points.map(p => p.topWeight), [10, 12, 14], "the chart for the new name includes the sessions logged under the old");
eq(collectExerciseHistory(history, "Dumbbell Lateral Raise").length, 3, "...and asking by the old name finds the same");
eq(computePRs(points, history, "Lateral Raise").heaviest?.value, 14, "records span both names");
{
  const records = computeSessionRecords(newC, [oldB, oldA]);
  const heaviest = records.find(r => r.kind === "heaviest");
  eq(heaviest?.prevKg, 12, "a new session's PR is measured against the best logged under the old name");
}
eq(
  exerciseHistoryRows(history, [], { exerciseName: "Lateral Raise", days: 365, today: new Date(2026, 9, 20) }).map(r => r.workoutId),
  ["w3", "w2", "w1"],
  "Exercise History lists sessions under both names",
);
{
  const day = { key: "p1:d0", dayId: "d0", index: 0, label: "Shoulders", programId: "p1", programName: "P", programExercises: [exerciseKey("Lateral Raise")], isHistorical: false } as unknown as ProgramDayRef;
  const rows = collectLoggedExercisesForDay(history, day);
  eq(rows.map(r => [r.name, r.sessionCount, r.inProgram]), [["Lateral Raise", 3, true]], "the Progress day list shows one row, under the new name");
}
ok(isFavourite(["Dumbbell Lateral Raise"], "Lateral Raise"), "a star saved under the old name still marks the exercise");

// ─── programs and favourites take the new names ──────────────────────────────

function program(names: { name: string; custom?: boolean }[]): SavedProgram {
  return {
    id: "p1", name: "P", cyclePattern: ["Shoulders"],
    workouts: { "0:Shoulders": names.map((n, i) => ({ id: `e${i}`, name: n.name, sets: [], ...(n.custom ? { customDetails: { name: n.name, muscles: ["Chest"] } } : {}) })) },
  } as unknown as SavedProgram;
}
{
  const before = [program([{ name: "Dumbbell Lateral Raise" }, { name: "Squat Jumps" }, { name: "Barbell Row", custom: true }, { name: "Dumbbell Curl" }])];
  const r = renameProgramExercises(before, new Set(["dumbbell curl"]));
  eq(r.changed, true, "a program with a former name changes");
  eq(r.programs[0].workouts["0:Shoulders"].map(e => e.name), ["Lateral Raise", "Squat Jumps", "Barbell Row", "Dumbbell Curl"],
    "a catalogue exercise is renamed; an unknown name, one carrying custom details, and one named like your own custom exercise are not");
  eq(r.programs[0].workouts["0:Shoulders"][0].id, "e0", "the program exercise keeps its id (its place, its notes)");
  const again = renameProgramExercises(r.programs, new Set(["dumbbell curl"]));
  eq(again.changed, false, "renaming is idempotent: a second launch writes nothing");
  const untouched = [program([{ name: "Lateral Raise" }])];
  ok(renameProgramExercises(untouched, new Set()).programs === untouched, "a program with nothing to rename is returned as is");
}
{
  const r = renameFavourites(["Dumbbell Lateral Raise", "Lateral Raise", "My Custom"], new Set(["my custom"]));
  eq(r.favourites, ["Lateral Raise", "My Custom"], "favourites take the new name, without a duplicate");
  eq(renameFavourites(r.favourites, new Set(["my custom"])).changed, false, "...and stay put on the next launch");
}

// ─── search ──────────────────────────────────────────────────────────────────

const LISTED = EXERCISES.filter(e => !e.hidden);
const DOCS = new Map(LISTED.map(e => [e.id, exerciseSearchDoc(e)]));
/** The picker's catalogue results for what's typed, closest first. */
function search(text: string): string[] {
  const query = parseQuery(text);
  if (!query) return LISTED.map(e => e.name);
  return LISTED
    .map(e => ({ e, s: rankMatch(query, DOCS.get(e.id)!) }))
    .filter((x): x is { e: typeof x.e; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .map(x => x.e.name);
}
const first = (text: string) => search(text)[0];
const before = (list: string[], a: string, b: string) => list.includes(a) && list.includes(b) && list.indexOf(a) < list.indexOf(b);

eq([stem("curls"), stem("presses"), stem("flyes"), stem("raises"), stem("press"), stem("traps")], ["curl", "press", "fly", "raise", "press", "traps"], "plural endings strip (not 'traps', the muscle)");
eq(first("lateral raise"), "Lateral Raise", "'lateral raise' finds Lateral Raise first");
ok(search("lateral raises").includes("Lateral Raise"), "a plural still finds it");
ok(search("raise lateral").includes("Lateral Raise"), "word order doesn't matter");
ok(search("dumbbell lateral raise").includes("Lateral Raise"), "the old name finds the renamed exercise");
{
  const curls = search("bicep curl");
  eq(curls[0], "Biceps Curl", "'bicep curl' finds Biceps Curl first");
  ok(curls.includes("Barbell Curl") && curls.includes("Hammer Curl"), "...and the other curls, whatever they're called");
  ok(before(curls, "Hammer Curl", "Leg Curl") && before(curls, "Barbell Curl", "Wrist Curl"), "...with leg and wrist curls only below every biceps curl");
}
ok(search("curls").includes("Biceps Curl"), "'curls' finds curls");
ok(search("db press").includes("Dumbbell Chest Press"), "'db' means dumbbell");
ok(search("pushup").includes("Push-Up") && search("pushups").includes("Push-Up"), "hyphens and spaces don't matter");
eq(first("pull down"), "Lat Pulldown", "two words typed apart find a name that's one word");
ok(search("tri pushdown").includes("Tricep Pushdown"), "'tri' means triceps");
ok(search("squats").includes("Barbell Back Squat"), "'squats' finds squats");
ok(!search("cuban press").includes("Cuban Press"), "a retired exercise isn't offered");
eq(search("zzz"), [], "nonsense finds nothing");

// One wrong or mixed-up word adds possible answers instead of emptying the
// list (user report, 2026-10-12: "inner hip abduction" found nothing).
{
  const hips = search("inner hip abduction");
  eq(hips[0], "Inner Hip Adduction", "'inner hip abduction' finds the inner one first (one word a typo of its name)");
  ok(hips.includes("Outer Hip Abduction"), "...and the abduction one, two words of three");
  ok(!hips.includes("Hip Thrust"), "...but not an exercise with one word of three");
}
eq(first("inner thigh"), "Inner Hip Adduction", "what it's known as finds it");
eq(first("outer thigh"), "Outer Hip Abduction", "...and the other");
ok(!search("leg press").includes("Front Squat"), "short of every word, a match must be in a name (Front Squat only works the 'Legs')");
eq(first("lateral rasie"), "Lateral Raise", "a typo still finds it");
eq(first("dumbel row"), "Dumbbell Row", "...a missing letter too");
eq(first("benhc press"), "Barbell Bench Press", "...and swapped letters");
eq(first("squat with dumbbells"), "Dumbbell Squat", "'with' and plurals don't get in the way");

// The closest first: the name as typed, then one ending with it, then
// starting with it, then the staple lifts.
eq(first("shrug"), "Shrug", "the exercise called what was typed comes first");
eq(first("leg press"), "Leg Press", "...over ones holding it");
ok(before(search("leg press"), "Single Leg Leg Press", "Leg Press Calf Raise"), "a name ending with it (a leg press) beats one starting with it (a calf raise)");
eq(first("military press"), "Overhead Press", "another of its names as typed comes first");
ok(before(search("squat"), "Barbell Back Squat", "Band Squat") && !search("squat").slice(0, 5).includes("Squat to Stand"), "'squat' leads with the staple squats, not Squat to Stand");
eq(first("bench press"), "Barbell Bench Press", "'bench press' finds the flat barbell one first");
eq(first("t bar row"), "Chest-Supported T-Bar Row", "'t bar row' finds the T-bar row first");
ok(!search("abs").includes("Outer Hip Abduction"), "shorthand means whole words ('abs' isn't 'abduction')");
ok(search("abs").includes("Crunch"), "...and 'abs' means the core");
ok(search("traps")[0] !== "Trap Bar Deadlift" && search("traps").includes("Shrug"), "'traps' means the muscle");
eq(first("gravitron"), "Assisted Pull-Up", "a machine's brand name finds it");
eq(first("machine pulldown"), "Lat Pulldown", "a retired exercise's name finds what replaced it");
ok(search("cardio").includes("Treadmill Run") && search("cardio").includes("Rowing Machine"), "'cardio' finds the cardio machines");
{
  // Custom exercises are searched the same way, by name and muscles.
  const custom = searchDoc("Towel Pull-Apart", [], ["Back"]);
  ok(rankMatch(parseQuery("towel pull apart")!, custom) !== null && rankMatch(parseQuery("back")!, custom) !== null, "a custom exercise is found by its name and its muscles");
}

// ─── result ──────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`✓ verify-exercise-renames: ${passed} checks passed`);
