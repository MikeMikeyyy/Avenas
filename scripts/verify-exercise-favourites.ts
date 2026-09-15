// Favourite exercises: name-keyed toggling and the muscle-group ordering the
// picker hoists them with.
//
// Run:  npx tsx scripts/verify-exercise-favourites.ts
// Exits non-zero (throws) if any assertion fails.

import {
  MUSCLE_ORDER,
  isFavourite,
  muscleOrderIndex,
  normalizeFavourite,
  sortByMuscleThenName,
  toggleFavourite,
} from "../utils/exerciseFavourites";
import type { SelectableMuscle } from "../constants/exercises";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── names are the identity, matched loosely ─────────────────────────────────

eq(normalizeFavourite("  Bench Press  "), "bench press", "normalize trims + lowercases");
eq(isFavourite(["Bench Press"], "bench press"), true, "match is case-insensitive");
eq(isFavourite(["Bench Press"], "  BENCH PRESS "), true, "match ignores surrounding space");
eq(isFavourite(["Bench Press"], "Bench Pres"), false, "match is exact, not a prefix");
eq(isFavourite([], "Bench Press"), false, "empty list favourites nothing");

// ─── toggling ────────────────────────────────────────────────────────────────

eq(toggleFavourite([], "Squat"), ["Squat"], "toggle adds to an empty list");
eq(toggleFavourite(["Squat"], "Squat"), [], "toggle removes an existing one");
eq(toggleFavourite(["Squat"], "squat"), [], "toggle removes regardless of casing");
eq(toggleFavourite(["Squat"], "Bench"), ["Squat", "Bench"], "toggle appends, keeping order");
eq(toggleFavourite(["Squat"], "  Bench  "), ["Squat", "Bench"], "toggle stores the trimmed name");
eq(
  toggleFavourite(toggleFavourite(["Squat"], "squat"), "Squat"),
  ["Squat"],
  "toggle round-trips: off then on leaves one entry, never a duplicate",
);
// The input is never mutated — the picker holds it in state.
{
  const original = ["Squat"];
  toggleFavourite(original, "Bench");
  eq(original, ["Squat"], "toggle does not mutate its input");
}

// ─── muscle-group ordering ───────────────────────────────────────────────────

eq(MUSCLE_ORDER, ["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"], "picker muscle order, 'All' stripped");
eq(muscleOrderIndex("Chest"), 0, "Chest sorts first");
eq(muscleOrderIndex("Core"), 5, "Core sorts last of the known groups");
eq(muscleOrderIndex(undefined), 6, "a missing muscle sorts after every group, not first");
eq(muscleOrderIndex("Elbow" as SelectableMuscle), 6, "an unknown muscle sorts last too");

type Item = { name: string; muscle?: SelectableMuscle };
const sort = (items: Item[]) =>
  sortByMuscleThenName(items, i => i.muscle, i => i.name).map(i => i.name);

eq(
  sort([
    { name: "Squat", muscle: "Legs" },
    { name: "Bench Press", muscle: "Chest" },
    { name: "Curl", muscle: "Arms" },
    { name: "Row", muscle: "Back" },
  ]),
  ["Bench Press", "Row", "Squat", "Curl"],
  "sorts by muscle group order, not alphabetically by muscle name",
);
eq(
  sort([
    { name: "Incline Press", muscle: "Chest" },
    { name: "Cable Fly", muscle: "Chest" },
    { name: "Bench Press", muscle: "Chest" },
  ]),
  ["Bench Press", "Cable Fly", "Incline Press"],
  "alphabetical inside a muscle group",
);
eq(
  sort([
    { name: "Custom Thing" },
    { name: "Bench Press", muscle: "Chest" },
  ]),
  ["Bench Press", "Custom Thing"],
  "an item with no muscle lands at the end, never ahead of Chest",
);
eq(
  sort([{ name: "plank", muscle: "Core" }, { name: "Ab Wheel", muscle: "Core" }]),
  ["Ab Wheel", "plank"],
  "alphabetical compare is case-insensitive (localeCompare)",
);
// Stable, order-independent: the same set in a different input order sorts the same.
{
  const a = sort([{ name: "Squat", muscle: "Legs" }, { name: "Row", muscle: "Back" }]);
  const b = sort([{ name: "Row", muscle: "Back" }, { name: "Squat", muscle: "Legs" }]);
  eq(a, b, "input order does not affect the result");
}
{
  const original: Item[] = [{ name: "Squat", muscle: "Legs" }, { name: "Row", muscle: "Back" }];
  sortByMuscleThenName(original, i => i.muscle, i => i.name);
  eq(original.map(i => i.name), ["Squat", "Row"], "sort does not mutate its input");
}
eq(sort([]), [], "empty list sorts to empty");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("exercise-favourite invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ exercise-favourite invariants hold");
