import { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "avenas_streak_data";

interface StreakData {
  count: number;
  startDate: string;       // ISO date string (YYYY-MM-DD)
  highestStreak: number;
  lastOpenedDate: string;  // ISO date string (YYYY-MM-DD)
}

interface StreakContextValue {
  streakDays: number;
  startDate: string;
  highestStreak: number;
  isLoaded: boolean;
}

const StreakContext = createContext<StreakContextValue>({
  streakDays: 0,
  startDate: "",
  highestStreak: 0,
  isLoaded: false,
});

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

function isValidStreakData(parsed: unknown): parsed is StreakData {
  if (!parsed || typeof parsed !== "object") return false;
  const d = parsed as Record<string, unknown>;
  return (
    typeof d.count === "number" &&
    typeof d.startDate === "string" &&
    typeof d.highestStreak === "number" &&
    typeof d.lastOpenedDate === "string"
  );
}

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<StreakData | null>(null);

  useEffect(() => {
    (async (): Promise<void> => {
      const today = toDateStr(new Date());

      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEY);
      } catch (e) {
        console.error("[StreakContext] Failed to read storage:", e);
      }

      if (!raw) {
        // First ever launch or storage unreadable — start streak at 1
        const initial: StreakData = {
          count: 1,
          startDate: today,
          highestStreak: 1,
          lastOpenedDate: today,
        };
        try {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        } catch (e) {
          console.error("[StreakContext] Failed to write initial data:", e);
        }
        setData(initial);
        return;
      }

      let saved: StreakData | null = null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isValidStreakData(parsed)) {
          saved = parsed;
        } else {
          console.warn("[StreakContext] Corrupt streak data, resetting");
        }
      } catch {
        console.warn("[StreakContext] Invalid JSON in storage, resetting");
      }

      if (!saved) {
        // Corrupt data — reset cleanly
        const initial: StreakData = { count: 1, startDate: today, highestStreak: 1, lastOpenedDate: today };
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch { /* best effort */ }
        setData(initial);
        return;
      }

      const diff = daysBetween(saved.lastOpenedDate, today);

      if (diff === 0) {
        // Already opened today — no change
        setData(saved);
        return;
      }

      let next: StreakData;

      if (diff === 1) {
        // Opened yesterday — keep streak going
        next = {
          count: saved.count + 1,
          startDate: saved.startDate,
          highestStreak: Math.max(saved.highestStreak, saved.count + 1),
          lastOpenedDate: today,
        };
      } else {
        // Missed 2+ days — reset streak but preserve highest
        next = {
          count: 1,
          startDate: today,
          highestStreak: saved.highestStreak,
          lastOpenedDate: today,
        };
      }

      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error("[StreakContext] Failed to write updated streak:", e);
      }
      setData(next);
    })();
  }, []);

  const value = useMemo(() => ({
    streakDays: __DEV__ ? 50 : (data?.count ?? 0),
    startDate: data?.startDate ?? "",
    highestStreak: __DEV__ ? 50 : (data?.highestStreak ?? 0),
    isLoaded: data !== null,
  }), [data]);

  return (
    <StreakContext.Provider value={value}>
      {children}
    </StreakContext.Provider>
  );
}

export function useStreak() {
  return useContext(StreakContext);
}
