// utils/connectionRolePrompt.ts
//
// Asking a TRAINER how they work with a fellow trainer they're connected with:
// as their trainer, their client, or both (lib/connectionRoles.ts).
//
// Asked in two ways:
//   - askConnectionRole: straight after I accept a request on the Connect
//     screen (or type the code of someone who'd already asked me).
//   - promptUndecidedConnectionRoles: any trainer connection I haven't filed
//     yet, which covers a request I SENT that was accepted while I wasn't
//     looking. Run a moment after launch (hooks/useTrainerHubPrefetch.ts) and
//     whenever the Connect screen comes into view.
//
// Every question goes through one queue and re-reads the filings first, so the
// two can't ask about the same person twice. A connection with no filing reads
// as a trainer (utils/roster.ts), which is how every one read before 0041, so
// an unanswered question moves nobody. The answer is saved on the server; if
// that fails it says so, and the person is asked again on the next launch.
//
// Native alerts rather than a sheet: this can come up over any screen, and a
// second RN Modal mounted beside a screen's own never presents again. Each
// alert waits for the one before it to close.

import { Alert } from "react-native";
import { getMyConnections } from "../lib/connections";
import { fetchConnectionRoles, setConnectionRole, type ConnectionRole } from "../lib/connectionRoles";
import { loadBlockedIds } from "./moderation";
import { alertMessage } from "./errors";
import type { AccountType } from "../contexts/AccountTypeContext";

/** One question at a time, across every caller. */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/** Asked this launch and the answer couldn't be saved: not again until the
 *  next launch, so a failing server can't turn into a loop of alerts. */
const failedThisSession = new Set<string>();

function choose(name: string): Promise<ConnectionRole> {
  return new Promise(resolve => {
    Alert.alert(
      `How do you work with ${name}?`,
      `${name} has a trainer account. Add them as your trainer, as one of your clients, or both. You can change this later from their card.`,
      [
        { text: "My Trainer", onPress: () => resolve("trainer") },
        { text: "My Client", onPress: () => resolve("client") },
        { text: "Both", onPress: () => resolve("both") },
      ],
      // Android can dismiss an alert; that leaves them where they read now.
      { cancelable: true, onDismiss: () => resolve("trainer") },
    );
  });
}

/** An OK-only alert that resolves once it's gone. */
function tell(title: string, body: string): Promise<void> {
  return new Promise(resolve => {
    Alert.alert(title, body, [{ text: "OK", onPress: () => resolve() }], { cancelable: true, onDismiss: () => resolve() });
  });
}

const WHERE: Record<ConnectionRole, string> = {
  trainer: "is in My Trainers",
  client: "is in My Clients",
  both: "is in My Trainers and My Clients",
};

async function askAndSave(otherId: string, name: string): Promise<ConnectionRole | null> {
  const who = name.trim() || "This trainer";
  const role = await choose(who);
  try {
    await setConnectionRole(otherId, role);
  } catch (e) {
    failedThisSession.add(otherId);
    await tell("Couldn't save that", alertMessage(e, "Check your connection. You'll be asked again next time."));
    return null;
  }
  failedThisSession.delete(otherId);
  await tell("Saved", `${who} ${WHERE[role]}.`);
  return role;
}

/** Ask how to file one trainer I've just connected with, unless that's already
 *  been answered. Returns their filing, or null when it couldn't be saved. */
export function askConnectionRole(otherId: string, name: string): Promise<ConnectionRole | null> {
  return exclusive(async () => {
    try {
      const existing = (await fetchConnectionRoles()).get(otherId);
      if (existing) return existing;
    } catch { /* can't tell: ask, and the save will say if it can't go */ }
    return askAndSave(otherId, name);
  });
}

/** Ask about every trainer connection not yet filed, one after another.
 *  Resolves true when anything was saved, so a caller can refresh its lists.
 *  Trainers only (a gym user's trainers are simply their trainer connections),
 *  and silent when the server can't be asked. */
export function promptUndecidedConnectionRoles(accountType: AccountType): Promise<boolean> {
  if (accountType !== "pt") return Promise.resolve(false);
  return exclusive(async () => {
    let conns: Awaited<ReturnType<typeof getMyConnections>>;
    let roles: Map<string, ConnectionRole>;
    let blocked: Set<string>;
    try {
      [conns, roles, blocked] = await Promise.all([getMyConnections(), fetchConnectionRoles(), loadBlockedIds()]);
    } catch {
      return false; // offline, or a server without 0041: nothing to ask about yet
    }
    let saved = false;
    for (const c of conns) {
      if (c.status !== "accepted" || c.accountType !== "pt") continue;
      if (roles.has(c.otherId) || blocked.has(c.otherId) || failedThisSession.has(c.otherId)) continue;
      if ((await askAndSave(c.otherId, c.name)) !== null) saved = true;
    }
    return saved;
  });
}
