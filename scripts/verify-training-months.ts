// Months of training, logged the way people really log it, and every screen
// that shows it checked against what was really done.
//
// Each run is one simulated lifter (scripts/harness/training/lifter.ts) on a
// phone of their own, training through a rotation of programs for months:
// real sets and weights, missed days, moves, late nights, Journal logs,
// swaps, custom workouts, holidays, a switch to lbs, programs finished and run
// again. Sydney time, starting on dates spread through August and September
// 2026, so runs cross the October daylight-saving change and New Year.
//
// After every week (Sunday night), what the lifter would see is held to the
// ledger of what they did (scripts/harness/training/checks.ts): the Progress
// page's bars, day list, charts, records and Exercise History; the exercise
// chart's layout on every phone width; each program's page; Home's week and
// Recent Activity. Every session logged is checked as it's saved (weights read
// back as typed, the PR card), and before it's started (the Workout tab's
// "Previous" sets and notes).
//
// Run:  npx tsx scripts/verify-training-months.ts          (--deep: more lifters, longer)
//       npx tsx scripts/verify-training-months.ts --seed 7  (one lifter, with its story)

import "./harness/training/env";
import { warnings } from "./harness/app";
import { crossesDst } from "./harness/solo/env";
import { Lifter } from "./harness/training/lifter";
import {
  checkChartLayout, checkHints, checkHome, checkProgramPages, checkProgressBars, checkProgressDays, checkSave,
  newChartMemory, snapshot, type Problem,
} from "./harness/training/checks";
import { addDaysYMD } from "../utils/dates";

declare const process: { argv: string[]; exitCode?: number };
declare const performance: { now(): number };

const DEEP = process.argv.includes("--deep");
const SEED_ARG = process.argv.indexOf("--seed");
const ONLY = SEED_ARG >= 0 ? Number(process.argv[SEED_ARG + 1]) : null;
const LIFTERS = ONLY !== null ? [ONLY] : Array.from({ length: DEEP ? 60 : 16 }, (_, i) => i + 1);
const WEEKS = DEEP ? 40 : 30;
// --show <kind>: every distinct problem of that kind (e.g. --show progress/),
// rather than the first two.
const SHOW_ARG = process.argv.indexOf("--show");
const SHOW_CODE = SHOW_ARG >= 0 ? process.argv[SHOW_ARG + 1] : null;
const SHOW_PER_CODE = 2;

type Found = { code: string; what: string; seed: number; story: string[]; count: number; seeds: Set<number> };
const found = new Map<string, Found>();
let weeksChecked = 0;
let sessionsLogged = 0;

function record(l: Lifter, problems: Problem[]) {
  for (const p of problems) {
    // One report per distinct problem: the same bug in many weeks and lifters
    // is one entry, with the first story that shows it.
    const signature = `${p.code}|${p.what.replace(/\d{4}-\d\d-\d\d/g, "<date>").replace(/workout_\d+_\d+/g, "<id>").replace(/\d+(\.\d+)?/g, "<n>")}`;
    const seen = found.get(signature);
    if (seen) {
      seen.count += 1;
      seen.seeds.add(l.seed);
      continue;
    }
    found.set(signature, { code: p.code, what: p.what, seed: l.seed, story: l.story.slice(-10), count: 1, seeds: new Set([l.seed]) });
  }
}

function startFor(seed: number): string {
  // Mondays through August and September, so every run crosses 4 October.
  return addDaysYMD("2026-08-03", ((seed * 5) % 9) * 7 + (seed % 3));
}

async function runLifter(seed: number) {
  const memory = newChartMemory();
  const lifter: Lifter = new Lifter(seed, {
    beforeLog: b => record(lifter, checkHints(b)),
    afterSave: a => { sessionsLogged += 1; record(lifter, checkSave(a)); },
  });
  const start = startFor(seed);
  await lifter.start(start);
  for (let d = 0; d < WEEKS * 7; d++) {
    const date = addDaysYMD(start, d);
    try {
      await lifter.day(date);
    } catch (e) {
      record(lifter, [{ code: "sim/threw", what: `${date}: ${(e as Error).stack ?? (e as Error).message}` }]);
      return;
    }
    const [y, m, dd] = date.split("-").map(Number);
    if (new Date(y, m - 1, dd).getDay() !== 0) continue;
    // Sunday night: everything the lifter could look at.
    const sundayNight = new Date(y, m - 1, dd, 22, 0);
    if (new Date().getTime() < sundayNight.getTime()) lifter.at(date, 22, 0);
    const snap = await snapshot(lifter);
    weeksChecked += 1;
    record(lifter, checkProgressBars(lifter, snap));
    const { problems, charts } = checkProgressDays(lifter, snap);
    record(lifter, problems);
    record(lifter, checkChartLayout(charts, memory));
    record(lifter, checkProgramPages(lifter, snap));
    record(lifter, checkHome(lifter, snap));
    record(lifter, warnings.splice(0, warnings.length).map(w => ({ code: "app/swallowed-error", what: w.text })));
  }
  if (ONLY !== null) console.log(lifter.story.join("\n"));
}

async function main() {
  const started = performance.now();
  if (!crossesDst()) console.log("(this machine couldn't be set to Sydney time: runs won't cross a daylight-saving change)");
  for (const seed of LIFTERS) await runLifter(seed);
  const secs = Math.round((performance.now() - started) / 1000);
  const summary = `${LIFTERS.length} lifters, ${WEEKS} weeks each, ${sessionsLogged} sessions logged, ${weeksChecked} weekly checks`;
  if (found.size === 0) {
    console.log(`${summary}: 0 problems (${secs}s)`);
    return;
  }
  const byCode = new Map<string, Found[]>();
  for (const f of found.values()) (byCode.get(f.code) ?? byCode.set(f.code, []).get(f.code)!).push(f);
  for (const [code, list] of [...byCode].sort()) {
    const total = list.reduce((n, f) => n + f.count, 0);
    const seeds = new Set(list.flatMap(f => [...f.seeds]));
    console.log(`\n✗ ${code}  (${total} times, ${seeds.size} of ${LIFTERS.length} lifters)`);
    const all = SHOW_CODE !== null && code.startsWith(SHOW_CODE);
    for (const f of list.slice(0, all ? list.length : SHOW_PER_CODE)) {
      console.log(`    ${f.what}`);
      if (!all) console.log(`      lifter ${f.seed}, leading up to it:\n${f.story.map(s => `        ${s}`).join("\n")}`);
    }
    if (!all && list.length > SHOW_PER_CODE) console.log(`    …and ${list.length - SHOW_PER_CODE} more like it`);
  }
  console.log(`\n${summary}: ${found.size} distinct problems in ${byCode.size} kinds (${secs}s)`);
  process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
