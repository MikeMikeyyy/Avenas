// The solo side of the app played out every way it can go: one person's
// programs, workouts, rest days and moves, and the clock moving on
// (scripts/harness/solo/flows.ts has the steps and what's checked). After
// every step, what they'd see is checked: that Home and the Workout tab agree
// about today, that every saved program keeps the app's rules, that each step
// did what its button says (a rest day empties its day and moves nothing, a
// move lands on the next day, undoing puts every day back, a hold rewrites no
// past day...), and that nothing it shouldn't touch changed.
//
//   sequences  every sequence of steps up to DEPTH long, from Sam's start
//   walks      seeded random runs, the clock moving about one step in three so
//              a run spans weeks, checked after every step
//
// Run:  npx tsx scripts/verify-solo-flows.ts         (--deep: longer and wider)

import { crossesDst } from "./harness/solo/env";
import { warnings } from "./harness/app";
import { STEPS, STORIES, alwaysTrue, describe, play, snap, start, untouched, type Step } from "./harness/solo/flows";

declare const process: { argv: string[]; exitCode?: number };
// The real clock, for how long the run took: Date is the flow's.
declare const performance: { now(): number };
const DEEP = process.argv.includes("--deep");
const DEPTH = DEEP ? 3 : 2;
const WALKS = DEEP ? 2000 : 400;
const WALK_LENGTH = DEEP ? 45 : 30;
const SHOW = 25;

const failures = new Map<string, { story: string[]; what: string }>();
let checks = 0;

function record(story: string[], label: string, what: string, details = "") {
  // One report per distinct problem, the same bug turning up in many runs, and
  // the shortest run that shows it: the easiest one to follow.
  const signature = `${label}|${what.replace(/\d{4}-\d\d-\d\d/g, "<date>").replace(/workout_\d+_\d+/g, "<id>").replace(/\d+/g, "<n>")}`;
  const seen = failures.get(signature);
  if (!seen || story.length < seen.story.length) failures.set(signature, { story: [...story], what: `${what}${details}` });
}

/** Play `step`, check everything after it. False when something was wrong, so
 *  a run stops there rather than reporting what follows from it. */
async function playAndCheck(step: Step, story: string[]): Promise<boolean> {
  let played: Awaited<ReturnType<typeof play>>;
  try {
    played = await play(step);
  } catch (e) {
    story.push(step.label);
    record(story, step.label, `threw: ${(e as Error).stack ?? (e as Error).message}`);
    return false;
  }
  const { before, after, result } = played;
  story.push(`${step.label}  [${before.today}${before.calendarDay !== before.today ? ` (calendar ${before.calendarDay})` : ""} ${before.time}]`);
  checks += 1;
  const problems = [
    ...alwaysTrue(after),
    ...untouched(step, before, after),
    ...(step.check?.(before, after, result) ?? []),
    ...warnings.splice(0, warnings.length).map(w => `the app swallowed an error: ${w.text}`),
  ];
  const state = `\n      before: ${describe(before)}\n      after:  ${describe(after)}`;
  for (const p of problems) record(story, step.label, p, state);
  return problems.length === 0;
}

/** A small seeded PRNG, so a failing walk can be run again. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const started = performance.now();
  if (!crossesDst()) console.log("(this machine couldn't be set to Sydney time: runs won't cross a daylight-saving change)");

  // The pinned stories, step by step.
  for (const labels of STORIES) {
    await start();
    const story: string[] = [];
    for (const label of labels) {
      const step = STEPS.find(s => s.label === label);
      if (!step) { record(story, label, `no step "${label}"`); break; }
      if (!step.enabled(await snap())) { story.push(label); record(story, label, `"${label}" isn't on screen at this point`); break; }
      if (!(await playAndCheck(step, story))) break;
    }
  }

  // Sequences, breadth first.
  let frontier: Step[][] = [[]];
  for (let depth = 0; depth <= DEPTH; depth++) {
    const next: Step[][] = [];
    for (const steps of frontier) {
      await start();
      const story: string[] = [];
      let ok = true;
      for (const s of steps) {
        ok = await playAndCheck(s, story);
        if (!ok) break;
      }
      if (!ok || depth === DEPTH) continue;
      const s = await snap();
      for (const step of STEPS) if (step.enabled(s)) next.push([...steps, step]);
    }
    frontier = next;
  }

  // Walks. The clock is a step in its own right, weighted so time passes.
  const clock = STEPS.slice(0, 3);
  const rest = STEPS.slice(3);
  for (let w = 0; w < WALKS; w++) {
    const rand = rng(w + 1);
    await start();
    const story: string[] = [];
    for (let i = 0; i < WALK_LENGTH; i++) {
      const s = await snap();
      const others = rest.filter(step => step.enabled(s));
      const r = rand();
      const step = r < 0.3 || others.length === 0
        ? clock[r < 0.21 ? 0 : r < 0.27 ? 1 : 2]
        : others[Math.floor(rand() * others.length)];
      if (!(await playAndCheck(step, story))) break;
    }
  }

  const secs = Math.round((performance.now() - started) / 1000);
  if (failures.size === 0) {
    console.log(`${checks} steps checked, 0 problems (${secs}s)`);
    return;
  }
  const shown = [...failures.values()].sort((a, b) => a.story.length - b.story.length).slice(0, SHOW);
  for (const f of shown) {
    console.log(`\n✗ ${f.story.join("\n  → ")}\n    ${f.what}`);
  }
  console.log(`\n${checks} steps checked, ${failures.size} distinct problems${failures.size > SHOW ? ` (first ${SHOW} shown)` : ""} (${secs}s)`);
  process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
