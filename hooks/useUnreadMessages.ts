// Total unread message count across all of this account's conversations, for the
// badge on the Trainer hub's Messages button. Refreshes on screen focus, so it
// updates after you read a thread (markThreadRead) and return to the hub.
//
// Mirrors app/trainer/messages.tsx's load (same seeding + blocked/hidden filter),
// so this total always equals the sum of the per-row badges in the list.

import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAccountType } from "../contexts/AccountTypeContext";
import { loadChatContacts, ensureSeededContacts, loadReads, countUnreadInThread } from "../utils/chatStore";
import { makeInitials } from "../utils/trainerStore";
import { getMyConnections } from "../lib/connections";
import { loadBlockedIds, loadHiddenMessageIds } from "../utils/moderation";
import type { ChatContact } from "../constants/chat";

export function useUnreadMessages(): number {
  const { accountType } = useAccountType();
  const [total, setTotal] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
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
            }));
          const realIds = new Set(real.map(c => c.id));
          contacts = [...real, ...local.filter(l => !realIds.has(l.id))];
        } catch { /* offline → fall back to local roster */ }

        const [threads, reads, blocked, hidden] = await Promise.all([
          ensureSeededContacts(contacts),
          loadReads(),
          loadBlockedIds(),
          loadHiddenMessageIds(),
        ]);
        if (cancelled) return;
        let sum = 0;
        for (const c of contacts) {
          if (blocked.has(c.id)) continue; // blocked people don't surface in chat
          const msgs = (threads[c.id] ?? []).filter(m => !hidden.has(m.id));
          sum += countUnreadInThread(msgs, reads[c.id]);
        }
        setTotal(sum);
      })();
      return () => { cancelled = true; };
    }, [accountType]),
  );

  return total;
}
