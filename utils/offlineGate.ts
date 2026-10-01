// utils/offlineGate.ts
//
// When the app may say it's offline (contexts/ConnectivityContext.tsx wires it
// to NetInfo and AppState; scripts/verify-offline-gate.ts plays it through).
//
// "Offline" has to HOLD, for OFFLINE_CONFIRM_MS with the app open, before it's
// said. iOS reports only whether there's a network; NetInfo finds out whether
// it reaches the internet with a request of its own, once a minute. The phone
// locking (or a switch to another app) freezes the app mid-request, and that
// request failed or timed out the moment the app came back, so the Trainer tab
// said "offline" until NetInfo's next try, seconds later, on a phone that was
// online the whole time. So:
//  - coming back to the foreground asks for a fresh check at once, and the
//    wait starts over: nothing read across the freeze counts;
//  - a timer that fell due during the freeze fires as the app comes back, so
//    it also checks the app is open and has been for the whole wait;
//  - "unknown" (a check still running) keeps what's shown, and a wait that was
//    counting starts again from the next "offline";
//  - back online is said at once.

export type Reading = "online" | "offline" | "unknown";

/** What NetInfo says right now: offline when there's no network or the OS has
 *  found it has no internet, "unknown" while it's still finding out. */
export function readingOf(net: { isConnected: boolean | null; isInternetReachable?: boolean | null }): Reading {
  if (net.isConnected === false || net.isInternetReachable === false) return "offline";
  if (net.isConnected === true && net.isInternetReachable === true) return "online";
  return "unknown";
}

/** How long the phone must stay offline, with the app open, before it's said. */
export const OFFLINE_CONFIRM_MS = 5000;

export type OfflineGateEnv = {
  /** Every change in what the connection looks like. Returns an unsubscribe. */
  onReading: (listener: (reading: Reading) => void) => () => void;
  /** The app coming back to the foreground. Returns an unsubscribe. */
  onForeground: (listener: () => void) => () => void;
  /** Whether the app is in the foreground right now. */
  isForeground: () => boolean;
  /** Ask for a fresh reading now. */
  recheck: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/** Runs the gate, calling `onChange` with each change in whether to say
 *  "offline" (it starts at false). Returns a stop function. */
export function startOfflineGate(env: OfflineGateEnv, onChange: (offline: boolean) => void): () => void {
  let reading: Reading = "unknown";
  let shown = false;
  let lastReturn = 0; // when the app last came back to the foreground
  let wait: unknown = null;

  const show = (next: boolean) => {
    if (next === shown) return;
    shown = next;
    onChange(next);
  };
  const stopWaiting = () => {
    if (wait !== null) { env.clearTimer(wait); wait = null; }
  };
  const startWaiting = () => {
    stopWaiting();
    wait = env.setTimer(() => {
      wait = null;
      const openFor = env.now() - lastReturn;
      if (reading === "offline" && env.isForeground() && openFor >= OFFLINE_CONFIRM_MS) show(true);
    }, OFFLINE_CONFIRM_MS);
  };

  const stopReadings = env.onReading(next => {
    if (next === reading) return;
    reading = next;
    if (next === "online") { stopWaiting(); show(false); }
    else if (next === "offline") { if (!shown) startWaiting(); }
    else stopWaiting();
  });
  const stopForeground = env.onForeground(() => {
    lastReturn = env.now();
    env.recheck();
    if (reading === "offline" && !shown) startWaiting();
  });

  return () => { stopReadings(); stopForeground(); stopWaiting(); };
}
