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
//
// A screen mounting later in the launch starts on the last read for this
// account rather than on nothing, so the Connect badge and the presence lines
// are there with the page instead of arriving after it. The startup prefetch
// (hooks/useTrainerHubPrefetch.ts) takes the first read.

import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { getMyConnections } from "../lib/connections";
import { PRESENCE_REFRESH_MS } from "../utils/presence";

type Presence = { presenceById: Map<string, string | null>; pendingIncoming: number };

/** The last read, and whose account it was. */
let lastPresence: { owner: string; presence: Presence } | null = null;

async function readPresence(owner: string): Promise<Presence> {
  const conns = await getMyConnections();
  const presence: Presence = {
    presenceById: new Map(
      conns.filter(c => c.status === "accepted").map(c => [c.otherId, c.lastActiveAt ?? null])
    ),
    pendingIncoming: conns.filter(c => c.status === "pending" && c.direction === "incoming").length,
  };
  lastPresence = { owner, presence };
  return presence;
}

/** Read now, for a screen that hasn't mounted yet (the startup prefetch). */
export async function warmConnectionPresence(owner: string): Promise<void> {
  try {
    await readPresence(owner);
  } catch { /* offline / signed out — nothing to start from */ }
}

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
  const { userId } = useAuth();
  const owner = userId ?? "";
  const [presence, setPresence] = useState<Presence>(() =>
    lastPresence?.owner === owner ? lastPresence.presence : { presenceById: new Map(), pendingIncoming: 0 }
  );
  const [, setTick] = useState(0);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await readPresence(owner);
        if (cancelled) return;
        setPresence(next);
      } catch { /* offline / signed out — keep the last snapshot */ }
      if (!cancelled) setTick(n => n + 1);
    };
    void refresh();
    const timer = setInterval(refresh, PRESENCE_REFRESH_MS);
    const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [owner]));

  return presence;
}
