// Every back-and-forth a program can go through between a trainer, a second
// trainer of their group and two clients, run on simulated phones against the
// real database, with every person's view checked after every step.
//
// Four flows (scripts/harness/flows/):
//
//   direct send    Tara sends a program to Cara and Cody
//   group send     Tara sends it into the group (Cole is its other trainer)
//   direct review  Cara asks Tara to review her program
//   group review   Cara asks the group (Tara and Cole can both act on it)
//
// In each, every action a person can take from what's on their screen:
// accept, remove, archive, restore, delete, send an update, send back, take
// back, withdraw, and a client deleting / archiving / restoring their own copy.
// scripts/harness/explore.ts plays each flow out every way it can go:
//
//   every sequence of actions up to DEPTH long, checked at its end against a
//   model of what EVERY person should see (their cards and what they say,
//   their copies in My Programs, the trainer's lists, archives and badges);
//
//   from every state within CONCURRENT_DEPTH, every pair of actions pressed
//   AT THE SAME TIME, after both screens were drawn (two phones at once, a
//   double tap, a tap on something just removed elsewhere), which must end as
//   one order or the other would have;
//
//   and seeded random walks, checked after every step.
//
// It's the app's own code throughout (utils/trainerStore.ts and the lists'
// filters), each person on a phone of their own with their own copy of the
// app (scripts/harness/app.ts), against every migration in an in-memory
// Postgres, each person's queries run AS them under Row Level Security.
// Anything the app logged as a swallowed error fails the run too.
//
// Run:  npx tsx scripts/verify-program-flows.ts         (--deep: longer and wider)

import { explore, type Budget, type Report } from "./harness/explore";
import { closeWorld, setupWorld } from "./harness/world";
import { sendFlow } from "./harness/flows/sends";
import { reviewFlow } from "./harness/flows/reviews";

declare const process: { argv: string[]; exitCode?: number };
const DEEP = process.argv.includes("--deep");
const BUDGET: Budget = DEEP
  ? { depth: 4, concurrentDepth: 2, walks: 300, walkLength: 16 }
  : { depth: 3, concurrentDepth: 1, walks: 60, walkLength: 14 };

async function main() {
  const started = Date.now();
  await setupWorld();
  // Each flow's state is its own shape, so each is run by a function of its own.
  const runs: [string, (seed: number) => Promise<Report>][] = [
    ["direct send", seed => explore(sendFlow("direct"), BUDGET, seed)],
    ["group send", seed => explore(sendFlow("group"), BUDGET, seed)],
    ["direct review", seed => explore(reviewFlow("direct"), BUDGET, seed)],
    ["group review", seed => explore(reviewFlow("group"), BUDGET, seed)],
  ];
  // --only=review runs just the flows whose name has "review" in it.
  const only = process.argv.find(a => a.startsWith("--only="))?.slice("--only=".length);
  let checks = 0;
  const failures: string[] = [];
  for (const [i, [name, run]] of runs.entries()) {
    if (only && !name.includes(only)) continue;
    const report = await run(i * 10_000);
    checks += report.checks;
    failures.push(...report.failures);
    console.log(`${name}: ${report.checks} checked, ${report.failures.length} problems`);
  }
  await closeWorld();
  const secs = Math.round((Date.now() - started) / 1000);
  if (failures.length) {
    console.log(`\n${failures.join("\n\n")}`);
    console.log(`\n${checks} states checked, ${failures.length} distinct problems (${secs}s)`);
    process.exitCode = 1;
  } else {
    console.log(`${checks} states checked, 0 problems (${secs}s)`);
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
