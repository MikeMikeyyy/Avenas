// Home's Connect card (utils/connectPrompt.ts):
//
//   * "no connections" is none accepted, for a gym user and a trainer alike;
//     a request either way doesn't count until it's accepted, and blocked
//     people count for nothing;
//   * what the card says: someone asking first, then a request I've sent, then
//     each account type's own words; nothing once there's anyone;
//   * no em dashes in any of it.
//
// Run:  npx tsx scripts/verify-connect-prompt.ts

import type { Connection } from "../lib/connections";
import { connectPrompt, summarizeConnections, type ConnectionSummary } from "../utils/connectPrompt";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

type Row = Pick<Connection, "otherId" | "status" | "direction">;
const accepted = (otherId: string): Row => ({ otherId, status: "accepted", direction: "accepted" });
const asking = (otherId: string): Row => ({ otherId, status: "pending", direction: "incoming" });
const asked = (otherId: string): Row => ({ otherId, status: "pending", direction: "outgoing" });
const declined = (otherId: string): Row => ({ otherId, status: "declined", direction: "outgoing" });
const none = new Set<string>();
const summary = (connected: number, incoming: number, outgoing: number): ConnectionSummary => ({ connected, incoming, outgoing });

// ─── Counting a read ─────────────────────────────────────────────────────────
eq(summarizeConnections([], none), summary(0, 0, 0), "count: nobody");
eq(summarizeConnections([accepted("a"), accepted("b"), asking("c"), asked("d"), asked("e")], none), summary(2, 1, 2),
  "count: accepted, asking me and asked by me, each on its own");
eq(summarizeConnections([declined("a")], none), summary(0, 0, 0), "count: a declined request is nothing");
eq(summarizeConnections([accepted("a"), asking("b"), asked("c")], new Set(["a", "b", "c"])), summary(0, 0, 0),
  "count: blocked people count for nothing, connected or asking or asked");
eq(summarizeConnections([accepted("a"), accepted("b")], new Set(["a"])), summary(1, 0, 0),
  "count: blocking one connection leaves the others");

// ─── What the card says ──────────────────────────────────────────────────────
for (const type of ["gym_user", "pt"] as const) {
  eq(connectPrompt(type, summary(1, 0, 0)), null, `${type}: one connection and the card is gone`);
  eq(connectPrompt(type, summary(1, 2, 1)), null, `${type}: connected, so requests waiting don't bring it back`);
}
eq(connectPrompt("gym_user", summary(0, 0, 0))?.title, "Connect with a trainer", "gym user, nobody: about a trainer");
eq(connectPrompt("pt", summary(0, 0, 0))?.title, "Add your first client", "trainer, nobody: about a first client");
eq(connectPrompt("gym_user", summary(0, 0, 0))?.button, "Connect", "nobody: the button says Connect");
eq(connectPrompt("pt", summary(0, 0, 0))?.waiting, 0, "nobody: no red count");

const one = connectPrompt("pt", summary(0, 1, 0));
eq([one?.title, one?.button, one?.waiting], ["Someone wants to connect", "View Request", 1],
  "one request waiting on me: says so, with the red count");
const three = connectPrompt("gym_user", summary(0, 3, 0));
eq([three?.title, three?.button, three?.waiting], ["3 people want to connect", "View Requests", 3],
  "three requests waiting: how many, in the plural");
eq(connectPrompt("gym_user", summary(0, 1, 2))?.title, "Someone wants to connect",
  "a request waiting on me comes before the ones I've sent");

const sent = connectPrompt("gym_user", summary(0, 0, 1));
eq([sent?.title, sent?.body, sent?.waiting], ["Request sent", "You'll be connected once they accept.", 0],
  "a request I've sent: the card says it's on its way, not to connect again");
eq(connectPrompt("pt", summary(0, 0, 2))?.body, "You'll be connected as each of them accepts.",
  "two requests sent: each of them");

// The whole read, end to end: a blocked person's request leaves the card asking.
eq(connectPrompt("gym_user", summarizeConnections([asking("x")], new Set(["x"])))?.title, "Connect with a trainer",
  "a blocked person's request never shows on the card");

// ─── Copy ────────────────────────────────────────────────────────────────────
const everything = [
  ...(["gym_user", "pt"] as const).flatMap(type =>
    [summary(0, 0, 0), summary(0, 1, 0), summary(0, 4, 0), summary(0, 0, 1), summary(0, 0, 3)].map(s => connectPrompt(type, s))),
];
for (const p of everything) {
  if (!p) { eq(p, "a card", "every unconnected state has a card"); continue; }
  for (const words of [p.title, p.body, p.button]) {
    eq(words.includes("—"), false, `no em dash: "${words}"`);
  }
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
