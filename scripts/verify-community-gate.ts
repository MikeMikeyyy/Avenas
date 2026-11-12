// The community guidelines can't be got round (user request, 2026-11-12:
// "make sure they have to agree and can't bypass it"):
//
//   1. which screens wait for them (utils/communityRoutes.ts): everything with
//      other people in it, a screen that's mine only when it's opened on mine,
//      and any screen nobody has placed;
//   2. every screen in app/ is placed, no list names a screen that's gone, a
//      screen that's mine reads none of the params that open someone else's,
//      and there's no navigator but the root Stack and the tabs (a new one's
//      screens would be outside the gate);
//   3. the gate is wired in: the root Stack lays out every screen through it,
//      and the Trainer tab asks for itself;
//   4. what's agreed, on the real utils/agreements.ts on simulated phones,
//      against a stand-in for the server's record (scripts/verify-db.ts runs
//      the real record_agreement): each account agrees for itself, so a
//      second account on the phone is asked; the phone-wide agreement from
//      before no longer counts (everyone agrees once more, so there's a
//      record); a new version of the guidelines is asked again; a read
//      landing after "I agree" can't take it back; every agreement, the
//      Terms at sign-up too, reaches the server, and one made with no signal
//      still holds and goes when there is one, once, as made.
//
// Run:  npx tsx scripts/verify-community-gate.ts

import { freshApp, on, stubModule, type Phone } from "./harness/app";
import { getJSON, setJSON } from "../utils/storage";
import {
  COMMUNITY_SCREENS,
  COMMUNITY_WHEN,
  OWN_SCREENS,
  needsCommunityAgreement,
  screenKind,
} from "../utils/communityRoutes";
import { COMMUNITY_TERMS_BY_ACCOUNT_KEY, COMMUNITY_TERMS_KEY, COMMUNITY_TERMS_VERSION } from "../constants/community";
import { TERMS_BY_ACCOUNT_KEY, TERMS_VERSION } from "../constants/onboarding";
import type * as Agreements from "../utils/agreements";

type AgreementRecord = Agreements.AgreementRecord;

/* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, no @types/node (see ./harness/db.ts) */
const fs = require("node:fs") as {
  readdirSync(dir: string, opts: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: string, enc: "utf8"): string;
};
const path = require("node:path") as { join(...parts: string[]): string; resolve(...parts: string[]): string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;
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
const ok = (cond: boolean, what: string) => eq(cond, true, what);

// ─── 1. Which screens wait ───────────────────────────────────────────────────

for (const name of ["connect", "my-trainers", "trainer/chat/[id]", "trainer/client/[id]", "trainer/coaches",
  "trainer/group/[id]/index", "trainer/group/[id]/chat", "trainer/group/[id]/programs", "trainer/group-edit",
  "trainer/messages", "trainer/programs", "trainer/received", "trainer/review/[id]", "trainer/sent-reviews"]) {
  ok(needsCommunityAgreement(name, undefined), `${name}: waits for the guidelines`);
}
ok(needsCommunityAgreement("trainer/some-page-added-later", {}), "a screen added under trainer/ later waits too");
ok(needsCommunityAgreement("connect", { code: "ABC123" }), "Connect opened by a QR code's link waits, code and all");

eq(needsCommunityAgreement("program-view", { programId: "p1" }), false, "program-view: my own program doesn't wait");
for (const p of ["sharedId", "sentId", "groupId", "clientId"]) {
  ok(needsCommunityAgreement("program-view", { [p]: "x" }), `program-view: opened by ${p}, someone else's, waits`);
}
ok(needsCommunityAgreement("program-view", { clientId: "c1", programId: "p1" }), "program-view: a client's program waits");
for (const name of ["workout-detail", "exercise-history", "exercise-summary", "program-history", "program-history-detail"]) {
  eq(needsCommunityAgreement(name, { id: "w1", exerciseName: "Bench Press", programId: "p1" }), false, `${name}: mine doesn't wait`);
  ok(needsCommunityAgreement(name, { clientId: "c1" }), `${name}: a client's waits`);
}
eq(needsCommunityAgreement("program-archive", { scope: "programs" }), false, "program-archive: my archive doesn't wait");
eq(needsCommunityAgreement("program-archive", { groupId: "g1" }), false, "program-archive: a group id with no group scope is still mine");
ok(needsCommunityAgreement("program-archive", { scope: "trainer" }), "program-archive: what a trainer sent waits");
ok(needsCommunityAgreement("program-archive", { scope: "group", groupId: "g1" }), "program-archive: a group's waits");
eq(needsCommunityAgreement("new-program", {}), false, "new-program: a new program doesn't wait");
eq(needsCommunityAgreement("new-program", { id: "p1" }), false, "new-program: editing mine doesn't wait");
for (const p of ["reviewId", "sharedId", "groupId"]) {
  ok(needsCommunityAgreement("new-program", { [p]: "x" }), `new-program: opened by ${p} waits`);
}
ok(needsCommunityAgreement("workout-detail", { clientId: ["c1"] }), "a param given twice (an array) still counts");
eq(needsCommunityAgreement("workout-detail", { clientId: "" }), false, "an empty param is no param");

for (const name of ["(tabs)", "index", "login", "signup", "onboarding", "accept-terms", "settings", "programs",
  "journal", "community-guidelines", "blocked-accounts", "_sitemap", "+not-found"]) {
  eq(needsCommunityAgreement(name, undefined), false, `${name}: has nobody else in it`);
}
ok(needsCommunityAgreement("a-screen-nobody-placed", undefined), "a screen nobody has placed waits (fails closed)");

// ─── 2. Every screen in app/ is placed ───────────────────────────────────────

const APP = path.resolve(__dirname, "..", "app");
type RouteFile = { file: string; name: string };
const routeFiles: RouteFile[] = [];
const layouts: string[] = [];
function walk(dir: string, rel: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { walk(path.join(dir, entry.name), relPath); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (entry.name.startsWith("_layout.")) { layouts.push(relPath); continue; }
    // The router's own special files, which aren't screens.
    if (entry.name.startsWith("+")) continue;
    routeFiles.push({ file: relPath, name: relPath.replace(/\.tsx?$/, "") });
  }
}
walk(APP, "");

eq(layouts.sort(), ["(tabs)/_layout.tsx", "_layout.tsx"],
  "no navigator but the root Stack and the tabs (a new one's screens would be outside the gate: give it the same screenLayout)");

// A tab is a screen of the tabs, not of the root Stack: the Stack sees "(tabs)".
const stackScreens = routeFiles.filter(r => !r.name.startsWith("(tabs)/"));
for (const r of stackScreens) {
  ok(screenKind(r.name) !== null, `app/${r.file} is placed in utils/communityRoutes.ts (community, COMMUNITY_WHEN or OWN_SCREENS)`);
}
const files = new Set(stackScreens.map(r => r.name));
const ROUTER_OWN = new Set(["(tabs)", "_sitemap", "+not-found"]);
for (const name of [...COMMUNITY_SCREENS, ...Object.keys(COMMUNITY_WHEN), ...OWN_SCREENS]) {
  if (ROUTER_OWN.has(name)) continue;
  ok(files.has(name), `utils/communityRoutes.ts names "${name}", which is a screen in app/`);
}
const placedTwice = OWN_SCREENS.filter(n => COMMUNITY_SCREENS.includes(n) || n in COMMUNITY_WHEN);
eq(placedTwice, [], "no screen is both mine and someone else's");

// A screen that's mine can't be opened on someone else's: none of the params
// that do that are in what it reads.
const SOMEONE_ELSES = ["clientId", "sharedId", "sentId", "reviewId", "groupId"];
for (const r of stackScreens) {
  if (screenKind(r.name) !== "own") continue;
  const source = fs.readFileSync(path.join(APP, r.file), "utf8");
  const reads = [...source.matchAll(/use(?:Local|Global)SearchParams\s*<\s*\{([^}]*)\}/g)].map(m => m[1]).join(" ");
  const found = SOMEONE_ELSES.filter(p => new RegExp(`\\b${p}\\b`).test(reads));
  eq(found, [], `app/${r.file} is mine alone, so it reads none of ${SOMEONE_ELSES.join(", ")} (one that does goes in COMMUNITY_WHEN)`);
}

// ─── 3. Wired in ─────────────────────────────────────────────────────────────

const rootLayout = fs.readFileSync(path.join(APP, "_layout.tsx"), "utf8");
ok(/<Stack\b[^>]*screenLayout=\{communityScreenLayout\}/.test(rootLayout), "the root Stack lays out every screen through the gate");
ok(/const communityScreenLayout\b[\s\S]{0,300}<CommunityGate\b/.test(rootLayout), "and that layout is the community gate");
const hub = fs.readFileSync(path.join(APP, "(tabs)", "trainer-hub.tsx"), "utf8");
ok(/useCommunityTermsAccepted\(owner\)/.test(hub) && /<CommunityGuidelinesGate\b/.test(hub), "the Trainer tab asks for itself");

// ─── 4. What's agreed, and the server's record of it ─────────────────────────

// The server's record_agreement (0059), stood in for: what reached it, whether
// it can be reached at all, and one request held open to land late.
type Recorded = { document: string; version: number; agreedAtISO: string };
const server = { reached: [] as Recorded[], down: false, holdNext: false, release: null as (() => void) | null };
stubModule({ file: "lib/agreements.ts" }, {
  recordAgreement: async (document: string, version: number, agreedAtISO: string) => {
    if (server.holdNext) {
      server.holdNext = false;
      await new Promise<void>(resolve => { server.release = resolve; });
    }
    if (server.down) throw new Error("no signal");
    server.reached.push({ document, version, agreedAtISO });
  },
});
const reachedNow = () => server.reached.splice(0).map(r => [r.document, r.version]);

type Device = Phone & { m: typeof Agreements };
/* eslint-disable @typescript-eslint/no-require-imports -- a fresh copy per phone, see freshApp */
const device = (name: string, store: [string, unknown][] = []): Device => ({
  uid: "",
  name,
  store: new Map(store.map(([k, v]) => [k, JSON.stringify(v)])),
  offline: false,
  m: freshApp(() => require("../utils/agreements") as typeof Agreements),
});
/* eslint-enable @typescript-eslint/no-require-imports */
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const agreed = (version = COMMUNITY_TERMS_VERSION): AgreementRecord => ({ version, acceptedAtISO: "2026-07-01T10:00:00.000Z" });
const kept = (p: Device, key = COMMUNITY_TERMS_BY_ACCOUNT_KEY) => on(p, () => getJSON<Record<string, AgreementRecord>>(key, {}));
const oldOne = (p: Device) => on(p, () => getJSON<AgreementRecord | null>(COMMUNITY_TERMS_KEY, null));
/* eslint-disable @typescript-eslint/no-require-imports -- Node's timers, no @types/node */
const { setTimeout: wait } = require("node:timers/promises") as { setTimeout(ms: number): Promise<void> };
/* eslint-enable @typescript-eslint/no-require-imports */

async function run() {
  // A new phone: nobody has agreed, and agreeing is the account's alone.
  const phone = device("phone");
  eq(await on(phone, () => phone.m.hasAcceptedCommunityTerms(A)), false, "a new phone: A hasn't agreed");
  eq(phone.m.peekCommunityTermsAccepted(A), false, "and that's held for A's screens");
  const agreeing = on(phone, () => phone.m.acceptCommunityTerms(A));
  eq(phone.m.peekCommunityTermsAccepted(A), true, "I agree opens A's screens at once, before the phone has written it");
  await agreeing;
  eq(await on(phone, () => phone.m.hasAcceptedCommunityTerms(A)), true, "A has agreed");
  eq(Object.keys(await kept(phone)), [A], "kept as A's");
  const sentAt = server.reached[0]?.agreedAtISO;
  eq(reachedNow(), [["community", COMMUNITY_TERMS_VERSION]], "and recorded on the server");
  eq(sentAt, (await kept(phone))[A]?.acceptedAtISO, "as the moment they agreed");
  eq((await kept(phone))[A]?.onServer, true, "marked on the phone as on the server");
  eq(await on(phone, () => phone.m.hasAcceptedCommunityTerms(B)), false,
    "B signing in on A's phone is asked: A's agreement isn't B's (it was one for the phone, and let B in)");
  eq(phone.m.peekCommunityTermsAccepted(A), null, "what's held is B's now, so A's screens read again rather than trust it");
  eq(await on(phone, () => phone.m.hasAcceptedCommunityTerms(A)), true, "back to A: still agreed");
  await on(phone, () => phone.m.acceptCommunityTerms(B));
  eq(Object.keys(await kept(phone)).sort(), [A, B].sort(), "B agreeing keeps A's");
  eq(reachedNow(), [["community", COMMUNITY_TERMS_VERSION]], "and B's is recorded too");

  // The phone-wide agreement from before: no longer counts, so everyone agrees
  // once more and has a record on the server (user pick, 2026-11-12).
  const updated = device("updated", [[COMMUNITY_TERMS_KEY, agreed()]]);
  eq(await on(updated, () => updated.m.hasAcceptedCommunityTerms(A)), false,
    "after the update, the phone's old agreement doesn't count: A agrees once more");
  eq(reachedNow(), [], "nothing's recorded for an agreement nobody made as this account");
  await on(updated, () => updated.m.acceptCommunityTerms(A));
  eq(await oldOne(updated), null, "agreeing clears the old one away");
  eq(reachedNow(), [["community", COMMUNITY_TERMS_VERSION]], "and this one's on the server");

  // The guidelines changing asks again.
  const bumped = device("bumped", [[COMMUNITY_TERMS_BY_ACCOUNT_KEY, { [A]: agreed(COMMUNITY_TERMS_VERSION - 1) }]]);
  eq(await on(bumped, () => bumped.m.hasAcceptedCommunityTerms(A)), false, "an agreement to older guidelines is asked again");

  // No signal: the guidelines still open, and the record goes when it can.
  const offline = device("no signal");
  server.down = true;
  await on(offline, () => offline.m.acceptCommunityTerms(A));
  eq(offline.m.peekCommunityTermsAccepted(A), true, "with no signal, agreeing still opens the screens: it never waits on the server");
  eq(reachedNow(), [], "nothing reached the server");
  eq((await kept(offline))[A]?.onServer, undefined, "kept as not on the server yet");
  await on(offline, () => offline.m.syncAgreements(A));
  eq((await kept(offline))[A]?.onServer, undefined, "the next launch with still no signal: still kept, still waiting");
  server.down = false;
  await on(offline, () => offline.m.syncAgreements(A));
  const lateAt = server.reached[0]?.agreedAtISO;
  eq(reachedNow(), [["community", COMMUNITY_TERMS_VERSION]], "the signal back, it's recorded");
  eq(lateAt, (await kept(offline))[A]?.acceptedAtISO, "as when they agreed, not when it went");
  eq((await kept(offline))[A]?.onServer, true, "and marked");
  await on(offline, () => offline.m.syncAgreements(A));
  eq(reachedNow(), [], "and never sent again");
  await on(offline, () => offline.m.syncAgreements(B));
  eq(reachedNow(), [], "another account on the phone sends none of A's");

  // The Terms of Service, at sign-up.
  const signup = device("sign-up");
  await on(signup, () => signup.m.acceptTerms(A));
  eq(reachedNow(), [["terms", TERMS_VERSION]], "the Terms accepted at sign-up are recorded on the server");
  eq((await kept(signup, TERMS_BY_ACCOUNT_KEY))[A]?.onServer, true, "kept as A's, marked");
  eq(await on(signup, () => signup.m.hasAcceptedCommunityTerms(A)), false, "accepting the Terms isn't agreeing to the community guidelines");
  const signupOffline = device("sign-up, no signal");
  server.down = true;
  await on(signupOffline, () => signupOffline.m.acceptTerms(A));
  server.down = false;
  eq(reachedNow(), [], "the Terms with no signal: not yet");
  await on(signupOffline, () => signupOffline.m.syncAgreements(A));
  eq(reachedNow(), [["terms", TERMS_VERSION]], "...and at the next launch, they are");

  // Signed out there's no account to record anything for.
  const signedOut = device("signed out");
  await on(signedOut, () => signedOut.m.acceptCommunityTerms(""));
  await on(signedOut, () => signedOut.m.syncAgreements(""));
  eq(reachedNow(), [], "signed out, nothing is sent, ever");

  // A read that started before "I agree" lands after it: the agreement stands.
  const racing = device("racing");
  await on(racing, async () => {
    const reading = racing.m.hasAcceptedCommunityTerms(A);
    const agreeingNow = racing.m.acceptCommunityTerms(A);
    await Promise.all([reading, agreeingNow]);
  });
  eq(racing.m.peekCommunityTermsAccepted(A), true, "a read landing after I agree doesn't put the guidelines back up");
  eq((await kept(racing))[A]?.version, COMMUNITY_TERMS_VERSION, "and the agreement is written");
  reachedNow();

  // Agreed again while the first was still on its way: the first one's answer
  // marks only itself, so the second, which didn't go, still goes.
  const twice = device("twice");
  server.holdNext = true;
  const first = on(twice, () => twice.m.acceptCommunityTerms(A));
  while (!server.release) await wait(1);
  await wait(5); // a moment on, so the second agreement is a different moment
  server.down = true;
  await on(twice, () => twice.m.acceptCommunityTerms(A));
  server.down = false;
  server.release();
  server.release = null;
  await first;
  eq((await kept(twice))[A]?.onServer, undefined, "the first one landing late doesn't mark the second, which never went");
  reachedNow();
  await on(twice, () => twice.m.syncAgreements(A));
  const secondAt = server.reached[0]?.agreedAtISO;
  eq(reachedNow(), [["community", COMMUNITY_TERMS_VERSION]], "so the second goes at the next launch");
  eq(secondAt, (await kept(twice))[A]?.acceptedAtISO, "as itself");

  // Something else on the phone, nothing to do with this, is left alone.
  const other = device("other");
  await on(other, () => setJSON("@avenas/theme", "dark"));
  await on(other, () => other.m.acceptCommunityTerms(A));
  eq(await on(other, () => getJSON<string | null>("@avenas/theme", null)), "dark", "agreeing touches nothing else");
}

run()
  .catch(err => { failed += 1; console.log(`✗ threw: ${err instanceof Error ? err.stack : String(err)}`); })
  .finally(() => {
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
