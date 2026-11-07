// Where a tapped program notification takes you (utils/programPushRoute.ts):
// the program it's about, opened as the page that lists it opens it, over
// that page and the Trainer tab (user request, 2026-11-06). scripts/verify-db.ts
// covers what the database puts in the notification (migration 0056).
//
// Run:  npx tsx scripts/verify-notification-routes.ts

import { programPushOf, programSteps } from "../utils/programPushRoute";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

const ID = "6f1c2a90-0000-4000-8000-000000000001";
const GROUP = "0b7d3e10-0000-4000-8000-000000000002";
const push = (over: Record<string, unknown> = {}) =>
  ({ url: "/trainer-hub", share: ID, kind: "share", event: "sent", group: null, category: "programShared", ...over });
const steps = (over: Record<string, unknown>, accountType: "gym_user" | "pt") => {
  const p = programPushOf(push(over));
  return p ? programSteps(p, accountType) : null;
};

// ── What a notification says it's about ─────────────────────────────────────
eq(programPushOf(push()), { share: ID, kind: "share", event: "sent", group: null }, "read: a program sent to you");
eq(programPushOf(push({ group: GROUP }))?.group, GROUP, "read: ...through a group");
eq(programPushOf({ url: "/trainer-hub", category: "programShared" }), null, "read: one from before 0056 says nothing more");
eq(programPushOf({ url: "/trainer/chat/abc" }), null, "read: a message isn't a program notification");
eq(programPushOf(push({ kind: "other" })), null, "read: an unknown kind isn't guessed at");
eq(programPushOf(push({ event: "accepted" })), null, "read: nor an unknown event");
eq(programPushOf(null), null, "read: no data, nothing");

// ── A program sent to you: where you Accept it ──────────────────────────────
eq(steps({}, "gym_user"), ["/trainer-hub", "/trainer/received", { pathname: "/program-view", params: { sharedId: ID } }],
  "sent: a gym user's opens over their Programs page");
eq(steps({}, "pt"), ["/trainer-hub", "/trainer/programs", { pathname: "/program-view", params: { sharedId: ID } }],
  "sent: a trainer's opens over theirs");
eq(steps({ group: GROUP }, "gym_user"), [
  "/trainer-hub",
  { pathname: "/trainer/group/[id]", params: { id: GROUP } },
  { pathname: "/trainer/group/[id]/programs", params: { id: GROUP } },
  { pathname: "/program-view", params: { sharedId: ID } },
], "sent: through a group, over the group's Programs page and the group");

// ── A review asked of you (a trainer): the review screen ────────────────────
eq(steps({ kind: "review" }, "pt"), ["/trainer-hub", "/trainer/programs", { pathname: "/trainer/review/[id]", params: { id: ID } }],
  "review asked: over the trainer's Programs page");
eq(steps({ kind: "review", group: GROUP }, "pt")?.slice(-1), [{ pathname: "/trainer/review/[id]", params: { id: ID, groupId: GROUP } }],
  "review asked: of a group, with the group, as the group's page opens it");

// ── A review of yours sent back: its changes and comments ───────────────────
eq(steps({ kind: "review", event: "returned" }, "gym_user"),
  ["/trainer-hub", "/trainer/sent-reviews", { pathname: "/program-view", params: { sentId: ID } }],
  "sent back: a gym user's opens over Sent for Review");
eq(steps({ kind: "review", event: "returned" }, "pt"),
  ["/trainer-hub", "/trainer/programs", { pathname: "/program-view", params: { sentId: ID } }],
  "sent back: a trainer's own request opens over their Programs page");
eq(steps({ kind: "review", event: "returned", group: GROUP }, "gym_user")?.slice(-2), [
  { pathname: "/trainer/group/[id]/programs", params: { id: GROUP } },
  { pathname: "/program-view", params: { sentId: ID, groupId: GROUP } },
], "sent back: one asked of a group opens through the group, as its page opens it");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✓ program notifications open their program");
