// Whether the phone can reach the internet, for the pages whose actions need
// the server: sending, accepting, asking for and sending back reviews, and a
// trainer's archive / restore / delete. Those buttons dim while offline
// (BounceButton's `needsConnection`) and say why when tapped, and the pages
// say they're showing what was there last time (components/OfflineBanner.tsx).
//
// Only a phone that KNOWS it's offline counts: no network, or a network the
// OS has found has no internet. While that's still being worked out it counts
// as online, since a false "offline" would block a phone that's fine. The
// other way round (gym wifi that says it's connected and isn't) is why every
// action still fails honestly on its own and says so: this is the courtesy,
// not the guarantee.
//
// One subscription for the app, at the root. Nothing waits on it at launch.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Alert } from "react-native";
import { useNetInfo } from "@react-native-community/netinfo";

const ConnectivityContext = createContext<{ offline: boolean }>({ offline: false });

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const net = useNetInfo();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const value = useMemo(() => ({ offline }), [offline]);
  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

/** True while the phone knows it has no internet. */
export function useOffline(): boolean {
  return useContext(ConnectivityContext).offline;
}

/** What a button that needs the server says when tapped offline. */
export function alertOffline(): void {
  Alert.alert("You're offline", "This needs a connection. Try again when you have signal.");
}
