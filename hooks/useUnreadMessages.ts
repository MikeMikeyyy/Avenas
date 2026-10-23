// Unread messages across this account's conversations: the total, for the badge
// on the trainer hub's Messages button, and each person's own count, for a gym
// user's hub (its Message button shows its trainer's, the My Trainers pill
// everyone else's, and the My Trainers page each trainer's). Refreshes on screen
// focus, so it updates after you read a thread (markThreadRead) and return.
//
// Mirrors app/trainer/messages.tsx's load (same thread source + blocked/hidden
// filter), so the total always equals the sum of the per-row badges in the list.
//
// A hub mounting later in the launch starts on the last counts for this account
// rather than on 0, so the badges are there with the page instead of popping in
// a second after it. hooks/useTrainerHubPrefetch.ts counts once shortly after
// startup; every recount keeps it current.

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAccountType, type AccountType } from "../contexts/AccountTypeContext";
import { useAuth } from "../contexts/AuthContext";
import { loadChatContacts, loadAllThreads, loadReads, countUnreadInThread } from "../utils/chatStore";
import { loadGroupRows, sumGroupUnread } from "../utils/groupStore";
import { makeInitials } from "../utils/trainerStore";
import { getMyConnections } from "../lib/connections";
import { loadBlockedIds, loadHiddenMessageIds } from "../utils/moderation";
import type { ChatContact } from "../constants/chat";

/** The total, groups included, and each person's own count (only people with
 *  something unread are in it). */
type UnreadCounts = { total: number; byPerson: Record<string, number> };

const NONE: UnreadCounts = { total: 0, byPerson: {} };

/** The last counts, and whose they were: account id + role, since the role
 *  decides how contacts are labelled and a different account's count means
 *  nothing. */
let lastCounts: { key: string; counts: UnreadCounts } | null = null;
const countsKey = (owner: string, accountType: AccountType) => `${owner}|${accountType}`;

async function countUnread(accountType: AccountType): Promise<UnreadCounts> {
  // Mirror app/trainer/messages.tsx:gatherContacts so the badge counts the
  // same set of threads as the list — local roster merged with every real
  // accepted connection. Without this merge, unreads from a real connected
  // trainer (who has no local entry) would never reach the header badge.
  const local = await loadChatContacts(accountType);
  let contacts: ChatContact[] = local;
  try {
    const conns = await getMyConnections();
    const real: ChatContact[] = conns
      .filter(c => c.status === "accepted")
      .map(c => ({
        id: c.otherId,
        name: c.name || "User",
        initials: makeInitials(c.name || "User"),
        subtitle: accountType === "pt" ? (c.accountType === "pt" ? "Coach" : "Client") : "Trainer",
        photoUri: c.photoUri,
      }));
    const realIds = new Set(real.map(c => c.id));
    contacts = [...real, ...local.filter(l => !realIds.has(l.id))];
  } catch { /* offline → fall back to local roster */ }

  const [threads, reads, blocked, hidden, groups] = await Promise.all([
    loadAllThreads(),
    loadReads(),
    loadBlockedIds(),
    loadHiddenMessageIds(),
    loadGroupRows(),
  ]);
  let sum = 0;
  const byPerson: Record<string, number> = {};
  for (const c of contacts) {
    if (blocked.has(c.id)) continue; // blocked people don't surface in chat
    const msgs = (threads[c.id] ?? []).filter(m => !hidden.has(m.id));
    const n = countUnreadInThread(msgs, reads[c.id]);
    if (n > 0) byPerson[c.id] = n;
    sum += n;
  }
  return { total: sum + sumGroupUnread(groups), byPerson };
}

/** Count now, for a hub that hasn't mounted yet (the startup prefetch). */
export async function warmUnreadMessages(accountType: AccountType, owner: string): Promise<void> {
  const counts = await countUnread(accountType);
  lastCounts = { key: countsKey(owner, accountType), counts };
}

export function useUnreadMessages(): {
  unread: number;
  /** Person id → their unread messages; absent when there are none. */
  byPerson: Record<string, number>;
  refresh: () => Promise<void>;
} {
  const { accountType } = useAccountType();
  const { userId } = useAuth();
  const key = countsKey(userId ?? "", accountType);
  const [counts, setCounts] = useState<UnreadCounts>(() => (lastCounts?.key === key ? lastCounts.counts : NONE));

  /** The counts, recomputed. Exposed so a hub's pull-to-refresh updates its
   *  badges in the same gesture as everything else on the page — focus alone
   *  can't, since you never left. */
  const recount = useCallback(async (isCancelled: () => boolean = () => false) => {
    const next = await countUnread(accountType);
    lastCounts = { key, counts: next };
    if (isCancelled()) return;
    setCounts(next);
  }, [accountType, key]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void recount(() => cancelled);
      return () => { cancelled = true; };
    }, [recount]),
  );

  return { unread: counts.total, byPerson: counts.byPerson, refresh: () => recount() };
}
