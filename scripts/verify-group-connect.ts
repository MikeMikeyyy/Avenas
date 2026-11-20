// Adding someone from a group (utils/groupConnect.ts, migration 0063): what a
// member's sheet offers, and what it says after.
//
//   * who may ask whom goes by ACCOUNT TYPE: a trainer anyone, a gym user
//     trainers only; the label says what they'll be;
//   * nothing for me, someone I've blocked, someone only invited, an account
//     type not known yet (a copy saved before 0063), or someone I'm
//     connected with;
//   * "Accept request" when they've asked me, "Request sent" once I have (a
//     decline reads the same, since asking again sends nothing);
//   * each answer in words; two trainers connecting are asked how to file
//     each other instead; the roster takes the answer, or reads again;
//   * "Make a trainer" on a gym user: the prompt;
//   * no em dashes in any of it.
//
// The server's half (who may, the decline, the limit) is scripts/verify-db.ts.
//
// Run:  npx tsx scripts/verify-group-connect.ts

import {
  canAddFromGroup,
  connectionAfter,
  groupAddAction,
  groupConnectOutcome,
  NOT_TRAINER_ACCOUNT_TITLE,
  notTrainerAccountMessage,
} from "../utils/groupConnect";
import type { GroupConnectResult } from "../lib/groups";
import type { GroupMember } from "../constants/groups";

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failed += 1;
  console.log(`✗ ${what}\n    expected: ${b}\n    actual:   ${a}`);
}

type Them = Pick<GroupMember, "accountType" | "connection" | "accepted">;
const trainer = (over: Partial<Them> = {}): Them => ({ accountType: "pt", accepted: true, ...over });
const gymUser = (over: Partial<Them> = {}): Them => ({ accountType: "gym_user", accepted: true, ...over });
const anyone = { isMe: false, blocked: false };
const offered = (a: ReturnType<typeof groupAddAction>) => (a ? `${a.kind}:${a.label}` : null);

// ─── Who may ask whom ────────────────────────────────────────────────────────
eq([canAddFromGroup("pt", "gym_user"), canAddFromGroup("pt", "pt"), canAddFromGroup("gym_user", "pt"), canAddFromGroup("gym_user", "gym_user")],
  [true, true, true, false], "rule: a trainer anyone, a gym user trainers only");
eq(offered(groupAddAction("pt", gymUser(), anyone)), "add:Add as client", "offer: a trainer adds a gym user as a client");
eq(offered(groupAddAction("gym_user", trainer(), anyone)), "add:Add as trainer", "offer: a gym user adds a trainer as their trainer");
eq(offered(groupAddAction("pt", trainer(), anyone)), "add:Connect", "offer: two trainers connect, and choose after");
eq(offered(groupAddAction("gym_user", gymUser(), anyone)), null, "offer: nothing between two gym users");

// ─── Nothing to offer ────────────────────────────────────────────────────────
eq(offered(groupAddAction("pt", gymUser(), { isMe: true, blocked: false })), null, "nothing: on my own row");
eq(offered(groupAddAction("pt", gymUser(), { isMe: false, blocked: true })), null, "nothing: for someone I've blocked");
eq(offered(groupAddAction("pt", gymUser({ accepted: false }), anyone)), null, "nothing: for someone only invited");
eq(offered(groupAddAction("pt", { accepted: true }, anyone)), null, "nothing: while their account type isn't known");
eq(offered(groupAddAction(undefined, gymUser(), anyone)), null, "nothing: while mine isn't");
eq(offered(groupAddAction("pt", gymUser({ connection: "connected" }), anyone)), null, "nothing: once we're connected");

// ─── Where it stands ─────────────────────────────────────────────────────────
eq(offered(groupAddAction("pt", gymUser({ connection: "incoming" }), anyone)), "accept:Accept request", "state: they've asked me");
eq(offered(groupAddAction("gym_user", trainer({ connection: "incoming" }), anyone)), "accept:Accept request",
  "state: ...whichever way round");
eq(offered(groupAddAction("gym_user", gymUser({ connection: "incoming" }), anyone)), null,
  "state: a gym user's request to a gym user (by code) isn't taken up from a group");
eq(offered(groupAddAction("pt", gymUser({ connection: "requested" }), anyone)), "sent:Request sent",
  "state: I've asked (or they declined, which reads the same)");
eq(offered(groupAddAction("pt", gymUser({ connection: "requested" }), { isMe: false, blocked: true })), null,
  "state: blocked outranks it");

// ─── After asking ────────────────────────────────────────────────────────────
const said = (r: GroupConnectResult, mine: "pt" | "gym_user", theirs: "pt" | "gym_user" | undefined) =>
  groupConnectOutcome(r, mine, theirs, "Sam");
eq(said("requested", "pt", "gym_user"), { title: "Request sent", body: "Once Sam accepts, they'll be one of your clients." },
  "words: a client asked");
eq(said("requested", "gym_user", "pt"), { title: "Request sent", body: "Once Sam accepts, they'll be one of your trainers." },
  "words: a trainer asked");
eq(said("requested", "pt", "pt"), { title: "Request sent", body: "Once Sam accepts, you'll choose whether they're your trainer, your client or both." },
  "words: a fellow trainer asked");
eq(said("connected", "pt", "gym_user"), { title: "Connected", body: "Sam is one of your clients now." }, "words: their request taken up, a client");
eq(said("connected", "gym_user", "pt"), { title: "Connected", body: "Sam is one of your trainers now." }, "words: ...a trainer");
eq(said("connected", "pt", "pt"), null, "words: two trainers are asked how to file each other instead");
eq(said("connected", "pt", undefined), { title: "Connected", body: "You're now connected with Sam." },
  "words: an account type not known yet is never taken for a trainer's");
eq(said("already", "pt", "gym_user"), { title: "Already connected", body: "You're already connected with Sam." }, "words: connected already");
eq(said("not_member", "pt", "gym_user"), { title: "Not in this group", body: "Sam isn't in this group any more." }, "words: they've left");
eq(said("not_allowed", "gym_user", "gym_user"),
  { title: "Not a trainer account", body: "Sam has a gym user account. Gym users can only add trainers." },
  "words: two gym users, after an account changed under the sheet");
eq(said("self", "pt", "pt"), { title: "Couldn't send the request", body: "Please try again." }, "words: anything else");
eq(groupConnectOutcome("requested", "pt", "gym_user", "  ")?.body, "Once User accepts, they'll be one of your clients.",
  "words: a blank name reads as the roster's own fallback");

eq((["requested", "connected", "already", "not_member", "not_allowed", "self"] as GroupConnectResult[]).map(connectionAfter),
  ["requested", "connected", "connected", null, null, null], "roster: the answer on their row, or read it again");

// ─── Make a trainer ──────────────────────────────────────────────────────────
eq([NOT_TRAINER_ACCOUNT_TITLE, notTrainerAccountMessage("Sam")],
  ["Not a trainer account", "Sam has a gym user account. Only trainer accounts can be trainers in a group."],
  "trainer: the owner's prompt for a gym user");

// ─── Copy ────────────────────────────────────────────────────────────────────
const copy: string[] = [NOT_TRAINER_ACCOUNT_TITLE, notTrainerAccountMessage("Sam")];
for (const mine of ["pt", "gym_user"] as const) {
  for (const theirs of ["pt", "gym_user", undefined] as const) {
    for (const r of ["requested", "connected", "already", "not_member", "not_allowed", "self"] as GroupConnectResult[]) {
      const s = groupConnectOutcome(r, mine, theirs, "Sam");
      if (s) copy.push(s.title, s.body);
    }
    for (const connection of [undefined, "incoming", "requested"] as const) {
      const a = groupAddAction(mine, { accountType: theirs, connection, accepted: true }, anyone);
      if (a) copy.push(a.label);
    }
  }
}
eq(copy.filter(s => s.includes("—")), [], "copy: no em dashes");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
