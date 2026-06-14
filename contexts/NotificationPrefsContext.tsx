import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type NotificationCategory,
} from "../constants/notifications";
import { loadNotificationPrefs, saveNotificationPrefs } from "../utils/notifications";

interface NotificationPrefsContextValue {
  prefs: NotificationPrefs;
  loaded: boolean;
  setMaster: (val: boolean) => void;
  setCategory: (category: NotificationCategory, val: boolean) => void;
  /** master AND category — what the UI should show as the effective state. */
  isEnabled: (category: NotificationCategory) => boolean;
}

const NotificationPrefsContext = createContext<NotificationPrefsContextValue>({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  loaded: false,
  setMaster: () => {},
  setCategory: () => {},
  isEnabled: () => false,
});

export function NotificationPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadNotificationPrefs().then(p => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  // Optimistic update + persist (fire-and-forget). Persisting the whole blob
  // each time keeps the on-disk shape canonical; saveNotificationPrefs swallows
  // its own errors so a failed write never surfaces to the user.
  const setMaster = useCallback((val: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, master: val };
      saveNotificationPrefs(next);
      return next;
    });
  }, []);

  const setCategory = useCallback((category: NotificationCategory, val: boolean) => {
    setPrefs(prev => {
      const next = { ...prev, categories: { ...prev.categories, [category]: val } };
      saveNotificationPrefs(next);
      return next;
    });
  }, []);

  const isEnabled = useCallback(
    (category: NotificationCategory) => prefs.master && prefs.categories[category],
    [prefs],
  );

  const value = useMemo(
    () => ({ prefs, loaded, setMaster, setCategory, isEnabled }),
    [prefs, loaded, setMaster, setCategory, isEnabled],
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
