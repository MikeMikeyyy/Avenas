// Whether the phone can reach the internet, for the pages whose actions need
// the server: sending, accepting, asking for and sending back reviews, and a
// trainer's archive / restore / delete. Those buttons dim while offline
// (BounceButton's `needsConnection`) and say why when tapped, and the pages
// say they're showing what was there last time (components/OfflineBanner.tsx).
// The Workout page says so too, while you log: the session saves on the phone.
//
// Only a phone that KNOWS it's offline counts: no network, or a network the
// OS has found has no internet. The other way round (gym wifi that says it's
// connected and isn't) is why every action still fails honestly on its own and
// says so: this is the courtesy, not the guarantee.
//
// And only once "offline" has held for a few seconds with the app open
// (utils/offlineGate.ts): the phone locking froze NetInfo's internet check
// mid-request, it failed as the app came back, and the Trainer tab said
// "offline" on a phone that was online throughout. While a check is still
// running the pages keep what they last said, which at launch is online: a
// false "offline" would block a phone that's fine.
//
// One subscription for the app, at the root. Nothing waits on it at launch.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { readingOf, startOfflineGate } from "../utils/offlineGate";

// A failed internet check is retried after 2s instead of NetInfo's 5s, so one
// that failed on a blip is put right well inside the gate's wait. Set before
// anything subscribes: this is the only file that uses NetInfo.
NetInfo.configure({ reachabilityShortTimeout: 2000 });

const ConnectivityContext = createContext<{ offline: boolean }>({ offline: false });

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => startOfflineGate({
    onReading: listener => NetInfo.addEventListener(state => listener(readingOf(state))),
    onForeground: listener => {
      const sub = AppState.addEventListener("change", state => { if (state === "active") listener(); });
      return () => sub.remove();
    },
    isForeground: () => AppState.currentState === "active",
    // Throws away a check the freeze caught and starts a fresh one.
    recheck: () => { void NetInfo.refresh(); },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }, setOffline), []);

  const value = useMemo(() => ({ offline }), [offline]);
  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

/** True once the phone has known it has no internet for a few seconds. */
export function useOffline(): boolean {
  return useContext(ConnectivityContext).offline;
}

/** What a button that needs the server says when tapped offline. */
export function alertOffline(): void {
  Alert.alert("You're offline", "This needs a connection. Try again when you have signal.");
}
