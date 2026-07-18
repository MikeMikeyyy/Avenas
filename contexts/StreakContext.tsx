import { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { toYMD } from "../utils/dates";

const STORAGE_KEY = "avenas_streak_data";

interface StreakData {
  count: number;
  startDate: string;       // local date string (YYYY-MM-DD)
  highestStreak: number;
  lastOpenedDate: string;  // local date string (YYYY-MM-DD)
  openedDates: string[];   // every distinct day the user opened the app (YYYY-MM-DD)
  /** "local" once dates use local-midnight day boundaries (toYMD), like every
   *  other date in the app. Absent on legacy records, whose dates were UTC-based
   *  (toISOString) — see the one-shot migration in the load effect. */
  dayBasis?: "local";
}

interface StreakContextValue {
  streakDays: number;
  startDate: string;
  highestStreak: number;
  openedDates: string[];
  isLoaded: boolean;
}

const StreakContext = createContext<StreakContextValue>({
  streakDays: 0,
  startDate: "",
  highestStreak: 0,
  openedDates: [],
  isLoaded: false,
});

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
  // openedDates is optional for migration from older records — handled at load time.
}

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<StreakData | null>(null);

  useEffect(() => {
    (async (): Promise<void> => {
      const today = toYMD(new Date());

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
          openedDates: [today],
          dayBasis: "local",
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
        const initial: StreakData = { count: 1, startDate: today, highestStreak: 1, lastOpenedDate: today, openedDates: [today], dayBasis: "local" };
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch { /* best effort */ }
        setData(initial);
        return;
      }

      // Migrate older records that don't have openedDates yet
      const existingOpenedDates: string[] = Array.isArray((saved as StreakData).openedDates)
        ? (saved as StreakData).openedDates
        : [saved.lastOpenedDate];
      const nextOpenedDates = existingOpenedDates.includes(today)
        ? existingOpenedDates
        : [...existingOpenedDates, today];

      // Day boundaries are LOCAL calendar days (toYMD) — the same basis as every
      // other date in the app. Records written before `dayBasis` existed used UTC
      // days (toISOString), which lag local by one in positive-UTC timezones (an
      // 8am AEST open recorded yesterday's UTC date). Bridge that once: a legacy
      // gap of exactly 2 is almost always yesterday's UTC-shifted open, so credit
      // it instead of resetting an honest streak. Legacy openedDates entries may
      // sit a day off — display-only, and fades as new local-based opens accrue.
      const isLegacy = saved.dayBasis !== "local";
      let diff = daysBetween(saved.lastOpenedDate, today);
      if (isLegacy && diff === 2) diff = 1;

      if (diff <= 0) {
        // Same local day — or a legacy UTC date from a negative-UTC timezone
        // that ran a day AHEAD of local (diff < 0). Either way: already opened.
        const merged: StreakData = { ...saved, lastOpenedDate: today, openedDates: nextOpenedDates, dayBasis: "local" };
        if (isLegacy || saved.lastOpenedDate !== today || !existingOpenedDates.includes(today)) {
          try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* best effort */ }
        }
        setData(merged);
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
          openedDates: nextOpenedDates,
          dayBasis: "local",
        };
      } else {
        // Missed 2+ days — reset streak but preserve highest
        next = {
          count: 1,
          startDate: today,
          highestStreak: saved.highestStreak,
          lastOpenedDate: today,
          openedDates: nextOpenedDates,
          dayBasis: "local",
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
    streakDays: data?.count ?? 0,
    startDate: data?.startDate ?? "",
    highestStreak: data?.highestStreak ?? 0,
    openedDates: data?.openedDates ?? [],
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
