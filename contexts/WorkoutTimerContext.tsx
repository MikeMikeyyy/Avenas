import { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WORKOUT_DRAFT_KEY } from "../constants/programs";

const TIMER_KEY = "@avenas/workout_timer_start";
const PAUSE_KEY = "@avenas/workout_timer_paused_ms";

interface WorkoutTimerContextValue {
  isRunning: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  discardCount: number;
  startTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => void;
  discardWorkout: () => void;
}

const WorkoutTimerContext = createContext<WorkoutTimerContextValue>({
  isRunning: false,
  isPaused: false,
  elapsedSeconds: 0,
  discardCount: 0,
  startTimer: () => {},
  pauseTimer: () => {},
  resumeTimer: () => {},
  stopTimer: () => {},
  discardWorkout: () => {},
});

export function WorkoutTimerProvider({ children }: { children: React.ReactNode }) {
  const [startEpochMs, setStartEpochMs] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [discardCount, setDiscardCount] = useState(0);

  const startEpochRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);

  useEffect(() => { startEpochRef.current = startEpochMs; }, [startEpochMs]);
  useEffect(() => { pausedMsRef.current = pausedMs; }, [pausedMs]);

  // Hydrate from storage on mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(TIMER_KEY),
      AsyncStorage.getItem(PAUSE_KEY),
    ]).then(([rawStart, rawPause]) => {
      if (rawPause) {
        const ms = parseInt(rawPause, 10);
        if (!isNaN(ms) && ms > 0) {
          setPausedMs(ms);
          setElapsedSeconds(Math.floor(ms / 1000));
          setIsPaused(true);
        }
      } else if (rawStart) {
        const ts = parseInt(rawStart, 10);
        if (!isNaN(ts) && ts > 0) setStartEpochMs(ts);
      }
    }).catch(() => {});
  }, []);

  // Tick — wall-clock based to avoid drift
  useEffect(() => {
    if (startEpochMs === null) return;

    const compute = () => {
      if (startEpochRef.current !== null) {
        setElapsedSeconds(Math.floor((pausedMsRef.current + Date.now() - startEpochRef.current) / 1000));
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
    setPausedMs(0);
    setIsPaused(false);
    setStartEpochMs(now);
    AsyncStorage.setItem(TIMER_KEY, String(now)).catch(() => {});
    AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
  }, []);

  const pauseTimer = useCallback(() => {
    if (startEpochRef.current === null) return;
    const accumulated = pausedMsRef.current + (Date.now() - startEpochRef.current);
    setPausedMs(accumulated);
    setElapsedSeconds(Math.floor(accumulated / 1000));
    setStartEpochMs(null);
    setIsPaused(true);
    AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
    AsyncStorage.setItem(PAUSE_KEY, String(accumulated)).catch(() => {});
  }, []);

  const resumeTimer = useCallback(() => {
    if (!isPaused) return;
    const now = Date.now();
    setIsPaused(false);
    setStartEpochMs(now);
    AsyncStorage.setItem(TIMER_KEY, String(now)).catch(() => {});
    AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
  }, [isPaused]);

  const stopTimer = useCallback(() => {
    setPausedMs(0);
    setStartEpochMs(null);
    setIsPaused(false);
    setElapsedSeconds(0);
    AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
    AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
  }, []);

  const discardWorkout = useCallback(() => {
    setPausedMs(0);
    setStartEpochMs(null);
    setIsPaused(false);
    setElapsedSeconds(0);
    setDiscardCount(c => c + 1);
    AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
    AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
    AsyncStorage.removeItem(WORKOUT_DRAFT_KEY).catch(() => {});
  }, []);

  const value = useMemo(() => ({
    isRunning: startEpochMs !== null,
    isPaused,
    elapsedSeconds,
    discardCount,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    discardWorkout,
  }), [startEpochMs, isPaused, elapsedSeconds, discardCount, startTimer, pauseTimer, resumeTimer, stopTimer, discardWorkout]);

  return (
    <WorkoutTimerContext.Provider value={value}>
      {children}
    </WorkoutTimerContext.Provider>
  );
}

export function useWorkoutTimer() {
  return useContext(WorkoutTimerContext);
}
