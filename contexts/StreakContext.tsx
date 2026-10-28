import { createContext, useContext, useEffect, useState, useMemo } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { toYMD } from "../utils/dates";
import { getJSON } from "../utils/storage";
import { awardStreakAchievement } from "../utils/achievementStore";
import { isStreakRecord, streakOnOpen, type StreakRecord } from "../utils/streak";
import { PROGRAMS_KEY, type SavedProgram } from "../constants/programs";

const STORAGE_KEY = "avenas_streak_data";

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

/**
 * Records the app being opened today (utils/streak.ts streakOnOpen) and returns
 * the streak to show. Null when the stored streak couldn't be read: nothing is
 * written then, and the next open tries again. Read as a first open, a failed
 * read started the streak over at 1, which mattered little while this ran once
 * per launch and would on every return to the app.
 */
async function openToday(): Promise<StreakRecord | null> {
  const today = toYMD(new Date());

  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    if (__DEV__) console.warn("[avenas]", "getItem", STORAGE_KEY, e);
    return null;
  }

  // No record yet (a first open), or one that isn't a streak: start at 1.
  let saved: StreakRecord | null = null;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isStreakRecord(parsed)) saved = parsed;
      else if (__DEV__) console.warn("[avenas]", "parse", STORAGE_KEY, "not a streak record, starting over");
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "parse", STORAGE_KEY, e);
    }
  }

  // A gap only costs the streak if SCHEDULED WORKOUT days went by unopened.
  // Rest days, a held program and the one free missed workout day all leave
  // it standing (utils/streak.ts). The active program is read as the app
  // opens, not held in state.
  const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
  const activeProgram = programs.find(p => p.status === "active") ?? null;
  const { record, write, grew } = streakOnOpen(saved, today, activeProgram);

  if (write) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "setItem", STORAGE_KEY, e);
    }
  }
  // Milestone lengths (constants/achievements.ts) earn a Home card and the
  // achievement notification; anything else is a no-op inside.
  if (grew) void awardStreakAchievement(record.count);
  return record;
}

export function StreakProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<StreakRecord | null>(null);

  // Every open counts: the launch, and each return to the app from the
  // background. Only the launch did, and iOS keeps the app in memory for days,
  // so a week away came back to the old number, and a day the app was only
  // brought back on went uncounted (user report, 2026-10-28). One open at a
  // time, so two never read the same record and both write it.
  useEffect(() => {
    let queue: Promise<void> = Promise.resolve();
    const open = () => {
      queue = queue.then(async () => {
        const record = await openToday();
        if (record) setData(record);
      }).catch(e => {
        if (__DEV__) console.warn("[avenas]", "streak open", STORAGE_KEY, e);
      });
    };
    open();
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") open();
    });
    return () => sub.remove();
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
