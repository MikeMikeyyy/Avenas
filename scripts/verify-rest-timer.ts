// The rest timer between sets, and the set rows around it.
//
//   - Only a rest changed ON the lock-screen card moves the Workout screen's
//     rest timer (utils/liveActivity.ts restFromCard): in Expo Go the bridge
//     answered "no rest" and dismissed every running rest on returning to the
//     app, and a card read back before its push landed restarted a rest just
//     skipped.
//   - Set rows go by each set's own id (utils/setRows.ts): adding a set while
//     another's row was still closing removed the new set instead, and left the
//     closed one in the log as a set nobody could see.
//
// Run:  npx tsx scripts/verify-rest-timer.ts
// Exits non-zero (throws) if any assertion fails.

import { restFromCard } from "../utils/liveActivity";
import { firstRows, nextRows, setRowKey, withoutSet } from "../utils/setRows";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual instanceof Set ? [...actual] : actual);
  const b = JSON.stringify(expected instanceof Set ? [...expected] : expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// ─── the lock-screen card and the rest timer ─────────────────────────────────

const NOW = 1_800_000_000_000;
const E = NOW + 90_000; // a rest running in the app
const card = (cardEnd: number, lastPushedEnd: number | null, appEnd: number | null) =>
  restFromCard({ cardEnd, lastPushedEnd, appEnd, now: NOW });

// Changes made on the card come through.
eq(card(0, E, E), 0, "card: Skip there dismisses the rest in the app");
eq(card(E + 15_000, E, E), E + 15_000, "card: +15s there moves the app's rest with it");
eq(card(NOW + 60_000, 0, null), NOW + 60_000, "card: a tick there started a rest, and the app runs it");
eq(card(NOW + 60_000, null, null), NOW + 60_000, "card: after a relaunch, a rest still running on the card carries on");

// The card only echoing what the app gave it changes nothing.
eq(card(0, null, E), null, "no card (Expo Go): its \"no rest\" never dismisses the app's rest");
eq(card(0, null, E), null, "a session's first tick, before its first push: the rest it started stays");
eq(card(E, E, null), null, "Skip in the app before the push lands: the card's old rest doesn't come back");
eq(card(0, 0, E), null, "a rest started in the app before its push lands: it isn't dismissed");
eq(card(E, E, E), null, "card and app agree: left alone");
eq(card(NOW - 5_000, null, null), null, "after a relaunch, a rest that ended on the card starts nothing");
eq(card(E + 1_000, E + 2_000, E), null, "within 1.5s of the app's: left alone, so the bar doesn't jump");

// ─── set rows by identity ────────────────────────────────────────────────────

type S = { id?: string; v: string };
const s = (id: string): S => ({ id, v: id });
const keys = (warmup: S[], working: S[]) => [
  ...warmup.map((x, i) => setRowKey(x, "warmup", i)),
  ...working.map((x, i) => setRowKey(x, "working", i)),
];

eq(setRowKey(s("a"), "working", 3), "a", "row key: a set's own id");
const unnamed: S = { v: "x" };
eq(setRowKey(unnamed, "working", 3), "working-3", "row key: where it sits, for a set without one (a completed workout's rows)");

// The race: "−" closes d's row; Add Set lands before it has closed.
{
  const working = [s("a"), s("b"), s("c"), s("d"), s("e")]; // e added while d closed
  const after = withoutSet([], working, "d");
  eq(after?.working.map(x => x.id), ["a", "b", "c", "e"], "the race: the set whose row closed goes, and the one just added stays");
  // What "remove the last set" did with the same taps.
  eq(working.slice(0, -1).map(x => x.id), ["a", "b", "c", "d"], "contrast: removing the last set took the new one, and kept d, its row already closed");
}
eq(withoutSet([s("w")], [s("a")], "w")?.warmup, [], "a warmup goes by its key too");
eq(withoutSet([], [s("a")], "a"), null, "an exercise keeps its only set");
eq(withoutSet([], [s("a"), s("b")], "zz"), null, "a key that isn't there removes nothing");

// Which rows open: only a set just added.
{
  const first = firstRows(["a", "b", "c"]);
  eq(first.added, null, "a card's first rows don't open");
  const added = nextRows(first, ["a", "b", "c", "d"]);
  eq(added.added, new Set(["d"]), "Add Set: the new set's row opens");
  const closing = nextRows(added, ["a", "b", "c", "d", "e"]);
  eq(closing.added, new Set(["e"]), "Add Set while d's row is closing: only e opens");
  eq(nextRows(closing, ["a", "b", "c", "e"]).added, null, "d removed: nothing opens");
  eq(nextRows(first, ["x", "y", "z"]).added, null, "an exercise swapped or reset (all new sets): nothing opens");
  eq(nextRows(first, ["x", "y", "z", "q"]).added, null, "reset to more sets than before: still nothing opens");
  eq(nextRows(first, ["b", "a", "c"]).added, null, "a set turned warmup (the same sets, reordered): nothing opens");
  eq(keys([s("w")], [s("a"), s("b")]), ["w", "a", "b"], "rows run warmups first, by key");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("rest-timer invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ rest-timer invariants hold");
