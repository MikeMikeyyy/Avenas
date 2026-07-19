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
  type ReminderTime,
} from "../constants/notifications";

/** A stored reminder time, validated (records written before the field existed,
 *  or corrupted ones, fall back to the default). */
function validTime(t: Partial<ReminderTime> | undefined): ReminderTime {
  const d = DEFAULT_NOTIFICATION_PREFS.workoutReminderTime;
  if (!t || typeof t.hour !== "number" || typeof t.minute !== "number") return d;
  if (t.hour < 0 || t.hour > 23 || t.minute < 0 || t.minute > 59) return d;
  return { hour: Math.floor(t.hour), minute: Math.floor(t.minute) };
}

/** Merge a stored (possibly older / partial) blob over the current defaults so
 *  newly-added categories appear as their default rather than `undefined`. */
function withDefaults(stored: Partial<NotificationPrefs> | null): NotificationPrefs {
  return {
    master: stored?.master ?? DEFAULT_NOTIFICATION_PREFS.master,
    categories: { ...DEFAULT_NOTIFICATION_PREFS.categories, ...(stored?.categories ?? {}) },
    workoutReminderTime: validTime(stored?.workoutReminderTime),
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
