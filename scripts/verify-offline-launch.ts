// Opening the app with no signal, and the backup owed after it (user report,
// 2026-10-14: a phone with no signal sat loading and never got into the app).
//
//   1. The launch's rules (utils/savedSession.ts), then the same rules against
//      the REAL auth library offline: a sign-in over an hour old, a fetch that
//      always fails, and a fake clock fast enough that its half minute of
//      renewal retries passes in moments. The app opens on the saved session,
//      keeps it through supabase-js's "no session", moves to the renewed one
//      when the signal comes back, signs out when the server ends the sign-in,
//      and can sign itself out with no signal.
//   2. The update gate's decision from a saved minimum (utils/version.ts).
//   3. The real lib/syncManager.ts on an in-memory phone: a backup that can't
//      go is still owed after the app restarts, goes on the next launch, and a
//      change made during a backup stays owed.
//
// Run:  npx tsx scripts/verify-offline-launch.ts
// Exits non-zero (throws) if any assertion fails.

import { createClient, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import {
  authStorageKey, endSession, sessionAfterEvent, sessionFromStorage, signedOutElsewhere,
} from "../utils/savedSession";
import { isBelowMinimum } from "../utils/version";

/* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, no @types/node (see ./harness/db.ts) */
type NodeModule = {
  _load(request: string, parent: { filename?: string } | null, isMain: boolean): unknown;
};
const Module = require("node:module") as NodeModule;
const path = require("node:path") as {
  resolve(...parts: string[]): string;
  dirname(p: string): string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;
/** A few trips round the event loop on the real clock. */
async function settle(turns = 20) {
  for (let i = 0; i < turns; i++) await new Promise<void>(r => realSetTimeout(() => r(), 0));
}

// ─── 1a. The rules ───────────────────────────────────────────────────────────

const URL_ = "https://abcdefghijklmnop.supabase.co";
const KEY = authStorageKey(URL_);
{
  // The key must be supabase-js's own default: named differently, every phone
  // signed in before this build would read as signed out.
  const probe = createClient(URL_, "anon", { auth: { persistSession: false, autoRefreshToken: false } });
  eq(KEY, (probe.auth as unknown as { storageKey: string }).storageKey, "the saved sign-in's key is supabase-js's own default");
  eq(authStorageKey("https://api.example.com"), "sb-api-auth-token", "a custom domain keys on its first label, as supabase-js does");
}

const USER = { id: "user-1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const nowSec = () => Math.round(Date.now() / 1000);
/** A sign-in whose access token ran out an hour ago. */
const oldSignIn = (refresh: string) => ({
  access_token: `access-for-${refresh}`, refresh_token: refresh, expires_in: 3600,
  expires_at: nowSec() - 3600, token_type: "bearer", user: USER,
});

eq(sessionFromStorage(JSON.stringify(oldSignIn("refresh-1")))?.user.id, "user-1", "a saved sign-in counts however old its token");
eq(sessionFromStorage(null), null, "nothing saved: nobody signed in");
eq(sessionFromStorage("{not json"), null, "an unreadable copy: nobody signed in");
eq(sessionFromStorage(JSON.stringify({ ...oldSignIn("refresh-1"), refresh_token: "" })), null, "no refresh token: nothing to renew it with");
eq(sessionFromStorage(JSON.stringify({ ...oldSignIn("refresh-1"), user: {} })), null, "no user id: nothing to key the data on");
{
  const { expires_at: _drop, ...noExpiry } = oldSignIn("refresh-1");
  eq(sessionFromStorage(JSON.stringify(noExpiry)), null, "no expiry: supabase-js would throw it away too");
}

const saved = sessionFromStorage(JSON.stringify(oldSignIn("refresh-1")));
const renewed = { ...oldSignIn("refresh-2"), access_token: "access-2" } as Session;
eq(sessionAfterEvent(saved, "INITIAL_SESSION", null)?.user.id, "user-1", "an empty INITIAL_SESSION (no signal) keeps the saved sign-in");
eq(sessionAfterEvent(saved, "TOKEN_REFRESHED", renewed)?.access_token, "access-2", "a renewal replaces the session");
eq(sessionAfterEvent(saved, "SIGNED_OUT", null), null, "SIGNED_OUT ends it");
eq(sessionAfterEvent(null, "INITIAL_SESSION", null), null, "nobody signed in stays nobody");
eq(signedOutElsewhere(saved, "SIGNED_OUT", false), true, "a SIGNED_OUT this phone didn't ask for was the server's");
eq(signedOutElsewhere(saved, "SIGNED_OUT", true), false, "this phone's own sign-out isn't");
eq(signedOutElsewhere(null, "SIGNED_OUT", false), false, "nobody was signed in: nothing ended");
eq(signedOutElsewhere(saved, "INITIAL_SESSION", false), false, "only SIGNED_OUT ends a sign-in");

// ─── 1b. The real auth library, offline ──────────────────────────────────────

let network: "down" | "up" | "revoked" = "down";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeFetch = (async (input: unknown) => {
  if (network === "down") throw new TypeError("Network request failed");
  const url = String(input);
  if (url.includes("grant_type=refresh_token")) {
    if (network === "revoked") {
      return json(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
    }
    return json(200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600, token_type: "bearer", user: USER });
  }
  if (url.includes("/logout")) return new Response(null, { status: 204 });
  return json(200, {});
}) as unknown as typeof fetch;

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

// supabase-js retries a renewal with backoff for up to 30 seconds. The fake
// clock moves time on by each wait instead of waiting it.
let skew = 0;
const fastSetTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  skew += ms ?? 0;
  return realSetTimeout(fn, 0, ...args);
}) as unknown as typeof setTimeout;
const quiet = { error: console.error, warn: console.warn, log: console.log };

async function offlineLaunch() {
  globalThis.setTimeout = fastSetTimeout;
  Date.now = () => realNow() + skew;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    store.set(KEY, JSON.stringify(oldSignIn("refresh-1")));
    const client = createClient(URL_, "anon", {
      auth: { storage: memoryStorage, storageKey: KEY, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: "pkce" },
      global: { fetch: fakeFetch },
    });

    // What AuthContext does: open on the saved copy, then follow the events.
    let app = sessionFromStorage(store.get(KEY) ?? null);
    let ownSignOut = false;
    let elsewhere = 0;
    const events: string[] = [];
    client.auth.onAuthStateChange((event: AuthChangeEvent, s: Session | null) => {
      events.push(`${event}:${s ? "session" : "none"}`);
      if (signedOutElsewhere(app, event, ownSignOut)) elsewhere += 1;
      app = sessionAfterEvent(app, event, s);
    });
    eq(app?.user.id, "user-1", "offline launch: opens on the saved sign-in, its token an hour old");

    const offline = await client.auth.getSession();
    eq(offline.data.session, null, "offline: getSession() answers no session (why the launch mustn't wait on it)");
    eq(offline.error?.name, "AuthRetryableFetchError", "offline: because the renewal couldn't reach the server");
    eq(sessionFromStorage(store.get(KEY) ?? null)?.refresh_token, "refresh-1", "offline: the sign-in stays saved");
    for (let i = 0; i < 50 && !events.some(e => e.startsWith("INITIAL_SESSION")); i++) await settle();
    eq(events.includes("INITIAL_SESSION:none"), true, "offline: supabase-js reports an empty INITIAL_SESSION");
    eq(app?.user.id, "user-1", "offline: the app stays signed in through it");

    // The signal comes back: the next renewal goes through.
    await settle();
    network = "up";
    const back = await client.auth.getSession();
    await settle();
    eq(back.data.session?.access_token, "access-2", "back online: the token renews");
    eq(events.includes("TOKEN_REFRESHED:session"), true, "back online: the renewal is announced");
    eq(app?.access_token, "access-2", "back online: the app moves to the renewed session");
    eq(elsewhere, 0, "back online: nothing read as signed out elsewhere");

    // Signed out on another phone: this phone's next renewal is refused.
    store.set(KEY, JSON.stringify({ ...oldSignIn("refresh-2"), access_token: "access-2" }));
    network = "revoked";
    await client.auth.getSession();
    await settle();
    eq(store.has(KEY), false, "ended by the server: supabase-js drops the sign-in");
    eq(app, null, "ended by the server: the app is signed out");
    eq(elsewhere, 1, "ended by the server: read as ended elsewhere, so the app goes to sign in");

    // Signed in again, then Sign Out Anyway with no signal (Settings).
    store.set(KEY, JSON.stringify(oldSignIn("refresh-3")));
    app = sessionFromStorage(store.get(KEY) ?? null);
    network = "down";
    ownSignOut = true;
    await endSession(client.auth, async () => { store.delete(KEY); });
    ownSignOut = false;
    await settle();
    eq(store.has(KEY), false, "offline sign-out: nothing left for the next launch to open on");
    eq(app, null, "offline sign-out: the app is signed out");
    eq(elsewhere, 1, "offline sign-out: not taken for one ended elsewhere");

    // And with the server there, the plain sign-out.
    store.set(KEY, JSON.stringify({ ...oldSignIn("refresh-4"), expires_at: nowSec() + 3600 }));
    app = sessionFromStorage(store.get(KEY) ?? null);
    network = "up";
    ownSignOut = true;
    await endSession(client.auth, async () => { store.delete(KEY); });
    ownSignOut = false;
    await settle();
    eq([store.has(KEY), app], [false, null], "online sign-out: signed out through the server");
    eq(elsewhere, 1, "online sign-out: not taken for one ended elsewhere");

    await client.auth.stopAutoRefresh();
  } finally {
    globalThis.setTimeout = realSetTimeout;
    Date.now = realNow;
    console.error = quiet.error;
    console.warn = quiet.warn;
    console.log = quiet.log;
  }
}

// ─── 2. The update gate, from the saved minimum ──────────────────────────────

eq(isBelowMinimum("2.11.0", null), false, "update gate: nothing saved, the app opens");
eq(isBelowMinimum("2.11.0", "2.12.0"), true, "update gate: a saved minimum above this build blocks, offline too");
eq(isBelowMinimum("2.11.0", "2.11.0"), false, "update gate: this build at the minimum opens");

// ─── 3. The backup owed, on the real lib/syncManager.ts ──────────────────────

const OWED = "@avenas/backup_owed";
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
const ROOT = path.resolve(__dirname, "..");
const stubs: Record<string, unknown> = {};
const stub = (file: string, exports: Record<string, unknown>) => {
  stubs[norm(path.resolve(ROOT, file))] = { __esModule: true, ...exports };
};
const originalLoad = Module._load;
Module._load = function (this: unknown, request, parent, isMain) {
  if (request.startsWith(".") && parent?.filename) {
    const hit = stubs[norm(path.resolve(path.dirname(parent.filename), request))];
    if (hit) return hit;
  }
  return originalLoad.call(this, request, parent, isMain);
};
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

/** The phone's storage: survives the app restarting. */
const disk = new Map<string, string>();
type Answer = { data: { session: { user: { id: string } } | null }; error: Error | null };
const SIGNED_IN: Answer = { data: { session: { user: { id: "user-1" } } }, error: null };
const NO_SIGNAL: Answer = { data: { session: null }, error: new Error("Network request failed") };
let answer: Answer = SIGNED_IN;
let pushes = 0;
let holdPush: Promise<void> | null = null;

stub("lib/supabase", { supabase: { auth: { getSession: async () => answer } } });
stub("lib/cloud", {
  BACKUP_OWED_KEY: OWED,
  getCacheOwner: async () => "user-1",
  pushAllLocalDataToCloud: async () => { if (holdPush) await holdPush; pushes += 1; return {}; },
});
stub("utils/storage", {
  getJSON: async (key: string, fallback: unknown) => (disk.has(key) ? JSON.parse(disk.get(key) as string) : fallback),
  setJSON: async (key: string, value: unknown) => { disk.set(key, JSON.stringify(value)); },
  removeKey: async (key: string) => { disk.delete(key); },
});

/** The app (re)starting: lib/syncManager.ts with fresh module state. */
function launch(): typeof import("../lib/syncManager") {
  const cache = (require as unknown as { cache: Record<string, unknown> }).cache;
  for (const file of Object.keys(cache)) if (norm(file).endsWith("/lib/syncmanager.ts")) delete cache[file];
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the stubs, fresh each launch
  return require("../lib/syncManager") as typeof import("../lib/syncManager");
}

async function owedBackups() {
  let sync = launch();
  const state = async () => (await sync.getBackupStatus("user-1")).state;

  // A workout finished with no signal, then the app left.
  answer = NO_SIGNAL;
  sync.scheduleCloudPush();
  await settle();
  eq(disk.get(OWED), "true", "a change is owed the moment it's made");
  sync.flushCloudPush();
  await settle();
  eq(pushes, 0, "no signal: nothing reaches the cloud");
  eq(await state(), "failed", "no signal: the backup reads as failed, not skipped (so it's retried)");
  eq(disk.get(OWED), "true", "no signal: still owed");

  // The app closed and opened again, still without a signal.
  sync = launch();
  eq(await state(), "waiting", "after a restart the owed backup still shows as waiting");
  await sync.pushOwedBackup();
  await settle();
  eq([pushes, disk.get(OWED)], [0, "true"], "relaunched offline: tried, still owed");

  // Opened with a signal: the launch's check sends it.
  sync = launch();
  answer = SIGNED_IN;
  await sync.pushOwedBackup();
  await settle();
  eq(pushes, 1, "next launch with a signal: the owed backup goes");
  eq(disk.has(OWED), false, "and is no longer owed");
  eq(await state(), "idle", "and Data & Sync reads backed up");

  await sync.pushOwedBackup();
  await settle();
  eq(pushes, 1, "nothing owed: no backup");

  // A set ticked while a backup is on its way.
  sync.scheduleCloudPush();
  let release = () => {};
  holdPush = new Promise<void>(r => { release = r; });
  sync.flushCloudPush();
  await settle();
  sync.scheduleCloudPush();
  release();
  holdPush = null;
  await settle();
  eq(disk.get(OWED), "true", "a change made during a backup is still owed after it");
  sync.flushCloudPush();
  await settle();
  eq([pushes, disk.has(OWED)], [3, false], "the next backup carries it and clears the flag");
}

void (async () => {
  await offlineLaunch();
  await owedBackups();
  if (failures.length) {
    console.error(failures.join("\n"));
    throw new Error(`verify-offline-launch: ${failures.length} failed, ${passed} passed`);
  }
  console.log(`verify-offline-launch: all ${passed} checks passed`);
})();
