// utils/notifications.ts
//
// Pure read/write for notification preferences, plus the single gate every
// notification delivery site MUST call before firing. Kept outside app/ and
// components/ (like trainerStore / chatStore / storage) so non-React callers
// (e.g. a future local-notification scheduler) can reach it too.
//
// contexts/NotificationPrefsContext wraps these for reactive UI; it does not
// duplicate the merge/persist logic.

import { getJSON, setJSON } from "./storage";
import {
  NOTIF_PREFS_KEY,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type NotificationCategory,
} from "../constants/notifications";

/** Merge a stored (possibly older / partial) blob over the current defaults so
 *  newly-added categories appear as their default rather than `undefined`. */
function withDefaults(stored: Partial<NotificationPrefs> | null): NotificationPrefs {
  return {
    master: stored?.master ?? DEFAULT_NOTIFICATION_PREFS.master,
    categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, ...(stored?.categories ?? {}) },
  };
}

/** Load prefs, forward-compatibly merged with defaults. Never throws. */
export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const stored = await getJSON<Partial<NotificationPrefs> | null>(NOTIF_PREFS_KEY, null);
  return withDefaults(stored);
}

/** Persist a full prefs object. */
export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  await setJSON(NOTIF_PREFS_KEY, prefs);
}

/** THE gate. A category may fire only when the master switch is on AND the
 *  category itself is on. Call this from any delivery site before scheduling or
 *  sending a notification. */
export async function isCategoryEnabled(category: NotificationCategory): Promise<boolean> {
  const prefs = await loadNotificationPrefs();
  return prefs.master && prefs.categories[category];
}
