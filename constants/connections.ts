// constants/connections.ts
//
// What the phone keeps about the account's connections (the request → accept
// links between two accounts, lib/connections.ts) for Home's Connect card
// (components/ConnectCard.tsx).

/** `{ owner, summary }`: the last count of this account's connections and the
 *  requests waiting either way (utils/connectionSummary.ts), so Home knows
 *  whether to show its Connect card without asking the server. */
export const CONNECTION_SUMMARY_KEY = "@avenas/connection_summary";

/** `string[]`: the accounts that hid Home's Connect card on this phone with its
 *  X. It stays hidden for them for good. */
export const CONNECT_CARD_HIDDEN_KEY = "@avenas/connect_card_hidden";
