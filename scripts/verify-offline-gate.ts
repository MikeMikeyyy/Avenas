// When the app may say it's offline (utils/offlineGate.ts), played through on
// a fake clock: the app open, iOS freezing it while the phone is locked, and
// the moment it comes back, in both orders the events can arrive in.
//
// Run:  npx tsx scripts/verify-offline-gate.ts
// Exits non-zero (throws) if any assertion fails.

import { OFFLINE_CONFIRM_MS, readingOf, startOfflineGate, type OfflineGateEnv, type Reading } from "../utils/offlineGate";

let passed = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

/** A phone: a clock, the app's foreground state, and NetInfo's readings. */
class Phone {
  now = 0;
  private appState: "active" | "inactive" | "background" = "active";
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;
  private readingListeners = new Set<(r: Reading) => void>();
  private foregroundListeners = new Set<() => void>();
  /** What NetInfo emits the moment it's asked to check again. */
  onRecheck: () => void = () => {};
  rechecks = 0;
  /** Every change the gate reported: true = "offline" shown, false = hidden. */
  readonly changes: boolean[] = [];
  readonly stop: () => void;

  constructor() {
    const env: OfflineGateEnv = {
      onReading: l => { this.readingListeners.add(l); return () => { this.readingListeners.delete(l); }; },
      onForeground: l => { this.foregroundListeners.add(l); return () => { this.foregroundListeners.delete(l); }; },
      isForeground: () => this.appState === "active",
      recheck: () => { this.rechecks += 1; this.onRecheck(); },
      now: () => this.now,
      setTimer: (fn, ms) => { const id = this.nextId++; this.timers.push({ id, at: this.now + ms, fn }); return id; },
      clearTimer: h => { this.timers = this.timers.filter(t => t.id !== h); },
    };
    this.stop = startOfflineGate(env, offline => this.changes.push(offline));
  }

  get shown(): boolean { return this.changes.length > 0 && this.changes[this.changes.length - 1]; }
  /** NetInfo reports a new reading. */
  reads(r: Reading) { this.readingListeners.forEach(l => l(r)); }
  /** Time passes with the app running: timers fire as they fall due. */
  wait(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter(t => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = end;
  }
  /** Locked (or another app opened): iOS freezes the app, and nothing runs. */
  lockFor(ms: number) { this.appState = "background"; this.now += ms; }
  /** Timers that fell due during the freeze fire as the app comes back. */
  overdueTimersFire() { this.wait(0); }
  /** The app is back in the foreground. */
  unlock() { this.appState = "active"; this.foregroundListeners.forEach(l => l()); }
  /** Control Center or a notification pulled down over the app. */
  pullDownOver() { this.appState = "inactive"; }
}

// ─── the mapping from NetInfo ────────────────────────────────────────────────

eq(readingOf({ isConnected: false, isInternetReachable: null }), "offline", "no network is offline");
eq(readingOf({ isConnected: true, isInternetReachable: false }), "offline", "a network with no internet (gym wifi) is offline");
eq(readingOf({ isConnected: true, isInternetReachable: true }), "online", "network and internet is online");
eq(readingOf({ isConnected: true, isInternetReachable: null }), "unknown", "a check still running is unknown");
eq(readingOf({ isConnected: true }), "unknown", "no answer yet is unknown");
eq(readingOf({ isConnected: null, isInternetReachable: null }), "unknown", "before NetInfo has said anything is unknown");

// ─── the reported bug: locked for a minute, online the whole time ────────────

for (const staleFailureFirst of [true, false]) {
  const order = staleFailureFirst ? "the stale check fails before the app hears it's back" : "the app hears it's back first";
  const p = new Phone();
  p.reads("online");
  p.wait(30_000);
  p.lockFor(70_000);
  // Back: NetInfo's request caught by the freeze fails or times out at once.
  // Asked to check again, NetInfo drops that "false" to "still checking".
  p.onRecheck = () => p.reads("unknown");
  if (staleFailureFirst) { p.reads("offline"); p.overdueTimersFire(); p.unlock(); }
  else { p.overdueTimersFire(); p.unlock(); p.reads("offline"); p.reads("unknown"); }
  p.wait(400);
  p.reads("online"); // the fresh check
  p.wait(20_000);
  eq(p.changes, [], `locked for a minute while online: never says offline (${order})`);
  eq(p.rechecks, 1, `locked for a minute: coming back asks NetInfo to check again (${order})`);
}
{
  // The fresh check fails once too (the radio still waking), and NetInfo's
  // retry 2s later goes through: still inside the wait.
  const p = new Phone();
  p.reads("online");
  p.lockFor(90_000);
  p.onRecheck = () => p.reads("unknown");
  p.reads("offline");
  p.unlock();
  p.wait(600);
  p.reads("offline");
  p.wait(2_300);
  p.reads("online");
  p.wait(20_000);
  eq(p.changes, [], "back from the lock screen, one failed check then a good one: never says offline");
}
{
  // An "offline" that started just before the lock: its wait fell due while
  // the app was frozen, and fires as it comes back.
  const p = new Phone();
  p.reads("online");
  p.reads("offline");
  p.wait(2_000);
  p.lockFor(60_000);
  p.onRecheck = () => p.reads("unknown");
  p.overdueTimersFire();
  eq(p.shown, false, "a wait that fell due during the freeze doesn't count on the way back");
  p.unlock();
  p.wait(300);
  p.reads("online");
  p.wait(20_000);
  eq(p.changes, [], "…and once NetInfo has checked again, nothing was ever shown");
}

// ─── really offline ──────────────────────────────────────────────────────────

{
  const p = new Phone();
  p.reads("online");
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS - 1);
  eq(p.shown, false, "offline with the app open: not said before the wait is up");
  p.wait(1);
  eq(p.shown, true, "offline with the app open: said once it has held for the wait");
  p.reads("unknown");
  eq(p.shown, true, "a check still running keeps saying offline");
  p.reads("online");
  eq(p.changes, [true, false], "back online: said at once");
}
{
  const p = new Phone();
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS);
  eq(p.changes, [true], "opened with no signal: said after the wait");
}
{
  const p = new Phone();
  p.reads("online");
  p.reads("offline");
  p.wait(3_000);
  p.reads("online");
  p.wait(20_000);
  eq(p.changes, [], "a blip shorter than the wait is never said");
}
{
  const p = new Phone();
  p.reads("online");
  p.reads("offline");
  p.wait(3_000);
  p.reads("unknown");
  p.wait(3_000);
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS - 1);
  eq(p.shown, false, "an \"unknown\" in the middle starts the wait over");
  p.wait(1);
  eq(p.shown, true, "…and the new wait says it when it's up");
}
{
  // Airplane mode from Control Center: the app is only inactive meanwhile.
  const p = new Phone();
  p.reads("online");
  p.pullDownOver();
  p.reads("offline");
  p.wait(20_000);
  eq(p.shown, false, "not said while Control Center is over the app");
  p.unlock();
  p.wait(OFFLINE_CONFIRM_MS - 1);
  eq(p.shown, false, "back from Control Center: the wait starts then");
  p.wait(1);
  eq(p.shown, true, "…and it's said once the wait is up");
}
{
  // Lost signal while locked, still none on the way back.
  const p = new Phone();
  p.reads("online");
  p.lockFor(30_000);
  p.reads("offline");
  p.lockFor(60_000);
  p.overdueTimersFire();
  p.unlock();
  p.wait(OFFLINE_CONFIRM_MS - 1);
  eq(p.shown, false, "offline on the way back: not said before the wait is up");
  p.wait(1);
  eq(p.shown, true, "offline on the way back: said once it has held with the app open");
}
{
  // Already saying offline when the phone locked, still offline after.
  const p = new Phone();
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS);
  p.lockFor(120_000);
  p.overdueTimersFire();
  p.unlock();
  p.wait(20_000);
  eq(p.changes, [true], "offline before the lock and after: says so throughout, no flicker");
}
{
  // Offline when locked, signal back while locked.
  const p = new Phone();
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS);
  p.lockFor(120_000);
  p.onRecheck = () => p.reads("unknown");
  p.unlock();
  eq(p.shown, true, "back with the check still running: keeps saying offline until it knows");
  p.wait(300);
  p.reads("online");
  eq(p.changes, [true, false], "…and says online as soon as the check does");
}

// ─── stopping ────────────────────────────────────────────────────────────────

{
  const p = new Phone();
  p.reads("offline");
  p.stop();
  p.wait(OFFLINE_CONFIRM_MS * 2);
  p.reads("online");
  p.reads("offline");
  p.wait(OFFLINE_CONFIRM_MS * 2);
  eq(p.changes, [], "stopped: no timer left running and no readings heard");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  throw new Error("offline-gate invariants violated");
}
console.log(`\n${passed} passed, 0 failed`);
console.log("✓ offline-gate invariants hold");
