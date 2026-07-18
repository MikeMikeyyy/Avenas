// utils/presence.ts
//
// Display helpers for connection presence ("Active now" / "Last active 5m ago").
// The writer side is the heartbeat in app/_layout.tsx: every signed-in device
// bumps profiles.last_active_at to server-now on launch, on foreground, and
// every 2 minutes while foregrounded — so presence is inherently
// minute-resolution. Pure + RN-free so it can be unit-tested.

/** Activity within this window renders as "on the app right now". Comfortably
 *  covers the 2-minute heartbeat of an actively-used session. */
export const ACTIVE_NOW_MS = 3 * 60 * 1000;

/** How often a focused screen re-pulls connection presence. 30s tracks the
 *  2-minute writer heartbeat as closely as the data allows. */
export const PRESENCE_REFRESH_MS = 30000;

export function isActiveNow(iso: string | undefined): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < ACTIVE_NOW_MS;
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  return `${wks}w ago`;
}

/** The full presence line for a known last-active timestamp. Accounts WITHOUT
 *  a timestamp get no presence row at all (never render a fallback label):
 *  since migration 0009 a NULL can mean "sharing turned off" just as well as
 *  "never active", and the two must stay indistinguishable. */
export function presenceLabel(iso: string): string {
  return isActiveNow(iso) ? "Active now" : `Last active ${timeAgo(iso)}`;
}
