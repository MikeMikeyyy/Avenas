// Total unread message count across all of this account's conversations, for the
// badge on the Trainer hub's Messages button. Refreshes on screen focus, so it
// updates after you read a thread (markThreadRead) and return to the hub.
//
// Mirrors app/trainer/messages.tsx's load (same thread source + blocked/hidden
// filter), so this total always equals the sum of the per-row badges in the list.
//
// A hub mounting later in the launch starts on the last total counted for this
// account rather than on 0, so the badge is there with the page instead of
// popping in a second after it. hooks/useTrainerHubPrefetch.ts counts it once
// shortly after startup; every recount keeps it current.

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

/** The last total, and whose it was: account id + role, since the role decides
 *  how contacts are labelled and a different account's count means nothing. */
let lastTotal: { key: string; total: number } | null = null;
const totalKey = (owner: string, accountType: AccountType) => `${owner}|${accountType}`;

async function countUnread(accountType: AccountType): Promise<number> {
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
  for (const c of contacts) {
    if (blocked.has(c.id)) continue; // blocked people don't surface in chat
    const msgs = (threads[c.id] ?? []).filter(m => !hidden.has(m.id));
    sum += countUnreadInThread(msgs, reads[c.id]);
  }
  return sum + sumGroupUnread(groups);
}

/** Count now, for a hub that hasn't mounted yet (the startup prefetch). */
export async function warmUnreadMessages(accountType: AccountType, owner: string): Promise<void> {
  const total = await countUnread(accountType);
  lastTotal = { key: totalKey(owner, accountType), total };
}

export function useUnreadMessages(): { unread: number; refresh: () => Promise<void> } {
  const { accountType } = useAccountType();
  const { userId } = useAuth();
  const key = totalKey(userId ?? "", accountType);
  const [total, setTotal] = useState(() => (lastTotal?.key === key ? lastTotal.total : 0));

  /** The count, recomputed. Exposed so a hub's pull-to-refresh updates the
   *  Messages badge in the same gesture as everything else on the page —
   *  focus alone can't, since you never left. */
  const recount = useCallback(async (isCancelled: () => boolean = () => false) => {
    const sum = await countUnread(accountType);
    lastTotal = { key, total: sum };
    if (isCancelled()) return;
    setTotal(sum);
  }, [accountType, key]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void recount(() => cancelled);
      return () => { cancelled = true; };
    }, [recount]),
  );

  return { unread: total, refresh: () => recount() };
}
