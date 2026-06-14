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
import { loadBlockedIds, loadHiddenMessageIds } from "../utils/moderation";

export function useUnreadMessages(): number {
  const { accountType } = useAccountType();
  const [total, setTotal] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const contacts = await loadChatContacts(accountType);
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
