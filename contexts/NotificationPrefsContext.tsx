import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type NotificationCategory,
  type ReminderTime,
} from "../constants/notifications";
import { loadNotificationPrefs, saveNotificationPrefs } from "../utils/notifications";
import { resyncScheduledNotifications } from "../utils/notificationScheduler";
import { syncPushCategories } from "../lib/push";

interface NotificationPrefsContextValue {
  prefs: NotificationPrefs;
  loaded: boolean;
  setMaster: (val: boolean) => void;
  setCategory: (category: NotificationCategory, val: boolean) => void;
  setWorkoutReminderTime: (time: ReminderTime) => void;
  /** master AND category — what the UI should show as the effective state. */
  isEnabled: (category: NotificationCategory) => boolean;
}

const NotificationPrefsContext = createContext<NotificationPrefsContextValue>({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  loaded: false,
  setMaster: () => {},
  setCategory: () => {},
  setWorkoutReminderTime: () => {},
  isEnabled: () => false,
});

// Every prefs write re-syncs both delivery paths: the on-device schedule
// (cancel + rebuild, so a toggled-off category's pending notifications die
// immediately) and the push_tokens.categories column the server checks before
// sending push. Both are fire-and-forget and swallow their own errors.
function persistAndSync(next: NotificationPrefs) {
  saveNotificationPrefs(next);
  resyncScheduledNotifications();
  void syncPushCategories(next);
}

export function NotificationPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadNotificationPrefs().then(p => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  const setMaster = useCallback((val: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, master: val };
      persistAndSync(next);
      return next;
    });
  }, []);

  const setCategory = useCallback((category: NotificationCategory, val: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, categories: { ...prev.categories, [category]: val } };
      persistAndSync(next);
      return next;
    });
  }, []);

  const setWorkoutReminderTime = useCallback((time: ReminderTime) => {
    setPrefs(prev => {
      const next = { ...prev, workoutReminderTime: time };
      persistAndSync(next);
      return next;
    });
  }, []);

  const isEnabled = useCallback(
    (category: NotificationCategory) => prefs.master && prefs.categories[category],
    [prefs],
  );

  const value = useMemo(
    () => ({ prefs, loaded, setMaster, setCategory, setWorkoutReminderTime, isEnabled }),
    [prefs, loaded, setMaster, setCategory, setWorkoutReminderTime, isEnabled],
  );

  return (
    <NotificationPrefsContext.Provider value={value}>
      {children}
    </NotificationPrefsContext.Provider>
  );
}

export function useNotificationPrefs() {
  return useContext(NotificationPrefsContext);
}
