import { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TIMER_KEY = "@avenas/workout_timer_start";

interface WorkoutTimerContextValue {
  isRunning: boolean;
  elapsedSeconds: number;
  startTimer: () => void;
  stopTimer: () => void;
}

const WorkoutTimerContext = createContext<WorkoutTimerContextValue>({
  isRunning: false,
  elapsedSeconds: 0,
  startTimer: () => {},
  stopTimer: () => {},
});

export function WorkoutTimerProvider({ children }: { children: React.ReactNode }) {
  const [startEpochMs, setStartEpochMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startEpochRef = useRef<number | null>(null);

  // Keep ref in sync for use inside interval callbacks
  useEffect(() => {
    startEpochRef.current = startEpochMs;
  }, [startEpochMs]);

  // Hydrate from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(TIMER_KEY).then(raw => {
      if (!raw) return;
      const ts = parseInt(raw, 10);
      if (!isNaN(ts) && ts > 0) setStartEpochMs(ts);
    }).catch(() => {});
  }, []);

  // Tick — wall-clock based to avoid drift
  useEffect(() => {
    if (startEpochMs === null) {
      setElapsedSeconds(0);
      return;
    }

    const compute = () => {
      if (startEpochRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startEpochRef.current) / 1000));
      }
    };

    compute();
    const id = setInterval(compute, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") compute(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [startEpochMs]);

  const startTimer = useCallback(() => {
    if (startEpochRef.current !== null) return;
    const now = Date.now();
    setStartEpochMs(now);
    AsyncStorage.setItem(TIMER_KEY, String(now)).catch(() => {});
  }, []);

  const stopTimer = useCallback(() => {
    setStartEpochMs(null);
    AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
  }, []);

  const value = useMemo(() => ({
    isRunning: startEpochMs !== null,
    elapsedSeconds,
    startTimer,
    stopTimer,
  }), [startEpochMs, elapsedSeconds, startTimer, stopTimer]);

  return (
    <WorkoutTimerContext.Provider value={value}>
      {children}
    </WorkoutTimerContext.Provider>
  );
}

export function useWorkoutTimer() {
  return useContext(WorkoutTimerContext);
}
