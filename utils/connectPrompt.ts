// utils/connectPrompt.ts
//
// Home's Connect card (components/ConnectCard.tsx; user request, 2026-11-12:
// with no connections, the way to connect was a few taps into the Trainer
// tab): whether an account is connected with anyone, and what the card says
// while it isn't.
//
// "No connections" is none ACCEPTED, for a gym user and a trainer alike: a
// trainer whose only connection is a coach of their own is connected, and so
// is a gym user whose only one is a training partner. A request either way
// doesn't count until it's accepted, but it changes what the card says:
// someone asking me first (it's waiting on me), then one I've sent, so the card
// doesn't keep asking for what's already been done.
//
// Blocked people count for nothing, as everywhere else (utils/roster.ts): a
// block's sever can fail offline and leave the row on the server, and the
// person is shown nowhere.
//
// Pure (types only), so scripts/verify-connect-prompt.ts can hold it to this.

import type { AccountType } from "../contexts/AccountTypeContext";
import type { Connection } from "../lib/connections";

/** How many people an account is connected with, and the requests waiting. */
export type ConnectionSummary = {
  /** Accepted connections. */
  connected: number;
  /** Requests to connect waiting on me. */
  incoming: number;
  /** Requests I've sent that are still waiting. */
  outgoing: number;
};

/** One read of my connections (lib/connections.ts:getMyConnections), counted. */
export function summarizeConnections(
  conns: readonly Pick<Connection, "otherId" | "status" | "direction">[],
  blocked: ReadonlySet<string>,
): ConnectionSummary {
  const summary: ConnectionSummary = { connected: 0, incoming: 0, outgoing: 0 };
  for (const c of conns) {
    if (blocked.has(c.otherId)) continue;
    if (c.status === "accepted") summary.connected += 1;
    else if (c.status === "pending" && c.direction === "incoming") summary.incoming += 1;
    else if (c.status === "pending" && c.direction === "outgoing") summary.outgoing += 1;
  }
  return summary;
}

/** What the card says. */
export type ConnectPrompt = {
  title: string;
  body: string;
  /** The green button's words. It always opens the Connect page. */
  button: string;
  /** Requests waiting on me: the red count on the button. */
  waiting: number;
};

/** The card for this account, or null once it's connected with anyone. */
export function connectPrompt(accountType: AccountType, s: ConnectionSummary): ConnectPrompt | null {
  if (s.connected > 0) return null;
  if (s.incoming > 0) {
    return {
      title: s.incoming === 1 ? "Someone wants to connect" : `${s.incoming} people want to connect`,
      body: "Accept to share programs and message each other.",
      button: s.incoming === 1 ? "View Request" : "View Requests",
      waiting: s.incoming,
    };
  }
  if (s.outgoing > 0) {
    return {
      title: "Request sent",
      body: s.outgoing === 1 ? "You'll be connected once they accept." : "You'll be connected as each of them accepts.",
      button: "Connect",
      waiting: 0,
    };
  }
  return accountType === "pt"
    ? {
        title: "Add your first client",
        body: "Share your code or scan theirs to send them programs and follow their training.",
        button: "Connect",
        waiting: 0,
      }
    : {
        title: "Connect with a trainer",
        body: "Get programs from them and send yours for review.",
        button: "Connect",
        waiting: 0,
      };
}
