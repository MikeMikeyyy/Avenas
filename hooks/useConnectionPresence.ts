// Live-ish presence for connected accounts. While the owning screen is focused,
// re-pulls getMyConnections() every 30s — and immediately when the app returns
// to the foreground — so "Active now" tracks the counterpart's 2-minute
// heartbeat as closely as the data allows. The tick state re-renders consumers
// even when the fetch fails (offline / signed out), so a stale "Active now"
// ages out into "Last active Xm ago" instead of freezing on screen.
//
// Truly instant presence would need Supabase Realtime; profiles rows aren't
// directly selectable under RLS (reads go through the get_my_connections RPC),
// so that would take schema/publication changes for little gain over the
// heartbeat's minute resolution.

import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { getMyConnections } from "../lib/connections";
import { PRESENCE_REFRESH_MS } from "../utils/presence";

export function useConnectionPresence(): {
  /** Accepted-connection account id → last_active_at ISO. Null means "never
   *  active" OR "activity sharing turned off" (migration 0009 nulls the
   *  timestamp server-side) — deliberately indistinguishable; render no
   *  presence row for it. An id NOT in the map is not a real connection
   *  (local/mock roster entries). */
  presenceById: Map<string, string | null>;
  /** Count of pending incoming connection requests (Connect button badge). */
  pendingIncoming: number;
} {
  const [presenceById, setPresenceById] = useState<Map<string, string | null>>(new Map());
  const [pendingIncoming, setPendingIncoming] = useState(0);
  const [, setTick] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const conns = await getMyConnections();
        if (cancelled) return;
        setPresenceById(new Map(
          conns.filter(c => c.status === "accepted").map(c => [c.otherId, c.lastActiveAt ?? null])
        ));
        setPendingIncoming(conns.filter(c => c.status === "pending" && c.direction === "incoming").length);
      } catch { /* offline / signed out — keep the last snapshot */ }
      if (!cancelled) setTick(n => n + 1);
    };
    void refresh();
    const timer = setInterval(refresh, PRESENCE_REFRESH_MS);
    const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, []));

  return { presenceById, pendingIncoming };
}
