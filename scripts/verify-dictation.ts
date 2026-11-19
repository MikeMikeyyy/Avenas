// Voice typing's text (utils/dictation.ts): how what the phone hears joins
// what was already typed, whichever way the recognizer reports it.

import { absorb, dictatedText, joinText, loudness, NOTHING_HEARD, phoneLanguage, type Heard } from "../utils/dictation";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`✗ ${label}\n    expected ${e}\n    got      ${a}`);
}

const feed = (events: [string, boolean][], start: Heard = NOTHING_HEARD) =>
  events.reduce((heard, [words, isFinal]) => absorb(heard, words, isFinal), start);

// iPhone: each partial carries everything so far; the final comes at the end.
const iphone = feed([["Bench", false], ["Bench felt", false], ["Bench felt heavy today", false], ["Bench felt heavy today.", true]]);
eq(iphone, { final: "Bench felt heavy today.", partial: "" }, "iPhone: partials replace each other, then the final");
eq(dictatedText("", feed([["Bench", false], ["Bench felt", false]])), "Bench felt", "iPhone: the box shows the words so far as they're heard");

// Phones that finish one stretch of speech, then start afresh.
const stretches = feed([["How many sets", false], ["How many sets", true], ["for", false], ["for legs", false]]);
eq(stretches, { final: "How many sets", partial: "for legs" }, "stretches: a final is kept and the next partial follows it");
eq(dictatedText("", stretches), "How many sets for legs", "stretches: ...shown together");

// A recognizer that repeats what's final at the start of later partials.
const repeats = feed([["Upper day", true], ["Upper day was", false], ["Upper day was good", false]]);
eq(dictatedText("", repeats), "Upper day was good", "repeats: nothing already final is typed twice");
eq(dictatedText("", feed([["upper day", true], ["Upper day tomorrow", false]])), "upper day tomorrow", "repeats: ...whatever its capitals");

// What was typed before listening stays, with one space before what's heard.
eq(dictatedText("Quick one:  ", iphone), "Quick one: Bench felt heavy today.", "typed first: what's heard comes after it, one space between");
eq(dictatedText("Hi", NOTHING_HEARD), "Hi", "typed first: nothing heard leaves it as it was");
eq(dictatedText("", feed([["x".repeat(50), true]]), 20).length, 20, "the box's own limit holds");
eq(joinText(" a ", "", "  b"), "a b", "pieces joined with single spaces, empty ones left out");

// How loud, for the rings.
eq([loudness(-2), loudness(0), loudness(5), loudness(10), loudness(14), loudness(Number.NaN)], [0, 0, 0.5, 1, 1, 0], "loudness: -2 to 10 made 0 to 1");

// The phone's language, or US English.
eq(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(phoneLanguage()), true, "the phone's language comes as a language tag");

if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`${passed} passed, 0 failed`);
}
