// utils/connectionSummary.ts
//
// Whether this account is connected with anyone, kept on the phone for Home's
// Connect card (components/ConnectCard.tsx; what it says is
// utils/connectPrompt.ts).
//
// Startup never waits on the server, so Home reads the copy here, which the
// reads the app already makes of the account's connections keep current: the
// Trainer tab's load (utils/roster.ts, which the startup prefetch runs once the
// community guidelines are agreed) and the Connect page (app/connect.tsx), so
// connecting there takes the card away before Home is back. Home asks the
// server itself only while the card could show (`refreshConnectionSummary`):
// nothing known yet (a new account, or one that's never opened the Trainer
// tab, for whom the prefetch doesn't run) or still nobody. A connected
// account's Home never asks.
//
// Stamped with the account it belongs to, as the Trainer tab's copy is
// (utils/pageSnapshot.ts): another account signing in on this phone reads
// nothing and finds out for itself. A screen follows it with
// hooks/useConnectionSummary.ts.

import { CONNECT_CARD_HIDDEN_KEY, CONNECTION_SUMMARY_KEY } from "../constants/connections";
import { getMyUid } from "../lib/chat";
import { getMyConnections, type Connection } from "../lib/connections";
import { summarizeConnections, type ConnectionSummary } from "./connectPrompt";
import { loadBlockedIds } from "./moderation";
import { getJSON, setJSON } from "./storage";

type Saved = { owner: string; summary: ConnectionSummary };

/** This launch's copy, and when a read last confirmed it (0: only off the
 *  device so far). */
let held: (Saved & { readAt: number }) | null = null;
const listeners = new Set<() => void>();

/** How long a read stands before Home asks again, so going back and forth
 *  between the tabs doesn't ask the server every time. */
const FRESH_MS = 60_000;

const sameSummary = (a: ConnectionSummary, b: ConnectionSummary) =>
  a.connected === b.connected && a.incoming === b.incoming && a.outgoing === b.outgoing;

/** This launch's copy for `owner`, or null when it isn't known yet. */
export function peekConnectionSummary(owner: string): ConnectionSummary | null {
  return held && held.owner === owner ? held.summary : null;
}

/** Load the saved copy off the device. A no-op once this launch has one. */
export async function hydrateConnectionSummary(owner: string): Promise<void> {
  if (!owner || peekConnectionSummary(owner)) return;
  const saved = await getJSON<Saved | null>(CONNECTION_SUMMARY_KEY, null);
  if (!saved?.summary || saved.owner !== owner) return;
  // A read that landed while this one was at the disk is newer.
  if (peekConnectionSummary(owner)) return;
  held = { owner, summary: saved.summary, readAt: 0 };
  notify();
}

function record(owner: string, summary: ConnectionSummary): void {
  if (held && held.owner === owner && sameSummary(held.summary, summary)) {
    // The same object stays, so nothing holding it re-renders.
    held = { ...held, readAt: Date.now() };
    return;
  }
  held = { owner, summary, readAt: Date.now() };
  void setJSON<Saved>(CONNECTION_SUMMARY_KEY, { owner, summary });
  notify();
}

/** Record a read of my connections made elsewhere (the Trainer tab's load, the
 *  Connect page), with the blocked ids it was filtered by. Never rejects. */
export async function noteConnections(conns: readonly Connection[], blocked: ReadonlySet<string>): Promise<void> {
  try {
    const owner = await getMyUid();
    if (owner) record(owner, summarizeConnections(conns, blocked));
  } catch (err) {
    if (__DEV__) console.warn("[avenas]", "note connections", err);
  }
}

/** Ask the server, for Home's card, unless a read in the last minute already
 *  has. Never rejects: offline or signed out, what's known stands. */
export async function refreshConnectionSummary(owner: string): Promise<void> {
  if (held && held.owner === owner && Date.now() - held.readAt < FRESH_MS) return;
  let conns: Connection[];
  try {
    conns = await getMyConnections();
  } catch {
    return;
  }
  const blocked = await loadBlockedIds().catch(() => new Set<string>());
  await noteConnections(conns, blocked);
}

/** Whether this account hid the card on this phone. */
export async function isConnectCardHidden(owner: string): Promise<boolean> {
  const ids = await getJSON<string[]>(CONNECT_CARD_HIDDEN_KEY, []);
  return Array.isArray(ids) && ids.includes(owner);
}

/** Hide the card for this account on this phone, for good. */
export async function hideConnectCard(owner: string): Promise<void> {
  const ids = await getJSON<string[]>(CONNECT_CARD_HIDDEN_KEY, []);
  const list = Array.isArray(ids) ? ids : [];
  if (!list.includes(owner)) await setJSON(CONNECT_CARD_HIDDEN_KEY, [...list, owner]);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Be told when the copy changes. Returns the unsubscribe. */
export function subscribeConnectionSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
