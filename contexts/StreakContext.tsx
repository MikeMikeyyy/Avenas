import { createContext, useContext, useEffect, useState, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { daysBetweenYMD, toYMD } from "../utils/dates";
import { getJSON } from "../utils/storage";
import { notifyAchievement } from "../utils/notificationScheduler";
import { streakSurvives } from "../utils/streak";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";

const STORAGE_KEY = "avenas_streak_data";

// Streak lengths worth celebrating with an achievement notification (gated on
// the achievements toggle inside notifyAchievement).
const STREAK_MILESTONES = new Set([7, 14, 30, 50, 100, 200, 365]);

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

/** Local calendar days from `a` to `b`. Only used to tell "already opened
 *  today" (<= 0) from "a gap to measure" — the gap itself is measured in
 *  SCHEDULED WORKOUT days by utils/streak.ts, not in calendar days. */
function daysBetween(a: string, b: string): number {
  return daysBetweenYMD(a, b) ?? 0;
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
      // 8am AEST open recorded yesterday's UTC date). That used to need an
      // explicit bridge; the grace day below now absorbs it, since a legacy gap
      // of 2 leaves a single day in between and one missed day is free. Legacy
      // openedDates entries may sit a day off — display-only, and fades as new
      // local-based opens accrue.
      const isLegacy = saved.dayBasis !== "local";
      const diff = daysBetween(saved.lastOpenedDate, today);

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

      // A gap only costs the streak if SCHEDULED WORKOUT days went by unopened.
      // Rest days, a held program and the one free missed workout day all leave
      // it standing — see utils/streak.ts. The active program is read here (not
      // held in state) because this effect runs once, as the app opens.
      const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
      const activeProgram = programs.find(p => p.status === "active") ?? null;
      const survives = streakSurvives(activeProgram, saved.lastOpenedDate, today);

      let next: StreakData;

      if (survives) {
        // Within the allowance — showing up today continues the run.
        next = {
          count: saved.count + 1,
          startDate: saved.startDate,
          highestStreak: Math.max(saved.highestStreak, saved.count + 1),
          lastOpenedDate: today,
          openedDates: nextOpenedDates,
          dayBasis: "local",
        };
        if (STREAK_MILESTONES.has(next.count)) {
          notifyAchievement(
            `${next.count}-day streak!`,
            `You've shown up ${next.count} days in a row. Keep it going.`,
          );
        }
      } else {
        // Two or more scheduled workout days passed unopened — reset, but keep
        // the personal best.
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
