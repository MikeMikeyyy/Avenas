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
  /** The effective start epoch (ms) while running — `elapsed = now − startEpochMs`
   *  (pauses already folded in). null when stopped or paused. Consumed by the
   *  Live Activity so the lock screen can count up natively. */
  startEpochMs: number | null;
  discardCount: number;
  startTimer: () => void;
  /** Start the timer as if it began at `epochMs` (a past moment). Used when
   *  replaying a lock-screen tick that happened while the app was suspended,
   *  so the first tick's timestamp — not the reconciliation moment — anchors
   *  the elapsed time, matching what the Live Activity showed. No-op when the
   *  timer is already running or paused. */
  startTimerAt: (epochMs: number) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => void;
  discardWorkout: () => void;
}

const WorkoutTimerContext = createContext<WorkoutTimerContextValue>({
  isRunning: false,
  isPaused: false,
  elapsedSeconds: 0,
  startEpochMs: null,
  discardCount: 0,
  startTimer: () => {},
  startTimerAt: () => {},
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

  const startTimerAt = useCallback((epochMs: number) => {
    // Same persistence contract as startTimer, but anchored to a past moment.
    // A paused timer is deliberately left paused (mirrors the Live Activity
    // intent, which never unpauses).
    if (startEpochRef.current !== null || pausedMsRef.current > 0) return;
    if (!Number.isFinite(epochMs) || epochMs <= 0 || epochMs > Date.now()) {
      epochMs = Date.now();
    }
    setPausedMs(0);
    setIsPaused(false);
    setStartEpochMs(epochMs);
    AsyncStorage.setItem(TIMER_KEY, String(epochMs)).catch(() => {});
    AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
  }, []);

  const pauseTimer = useCallback(() => {
    if (startEpochRef.current === null) return;
    const accumulated = pausedMsRef.current + (Date.now() - startEpochRef.current);
    setPausedMs(accumulated);
    setElapsedSeconds(Math.floor(accumulated / 1000));
    setStartEpochMs(null);
    setIsPaused(true);
    // Write the new key BEFORE removing the old one (AsyncStorage serialises
    // ops in call order). A kill between the two then leaves BOTH keys — and
    // hydration prefers PAUSE_KEY — instead of neither, which would reset the
    // timer to 0 on relaunch.
    AsyncStorage.setItem(PAUSE_KEY, String(accumulated)).catch(() => {});
    AsyncStorage.removeItem(TIMER_KEY).catch(() => {});
  }, []);

  const resumeTimer = useCallback(() => {
    if (!isPaused) return;
    // Persist the EFFECTIVE start (now − accumulated) so TIMER_KEY alone fully
    // encodes the elapsed time. Persisting the raw resume moment would drop the
    // pre-pause time if the app is killed after a resume: hydration only reads
    // TIMER_KEY, and the accumulated ms would exist nowhere on disk.
    const effectiveStart = Date.now() - pausedMsRef.current;
    setIsPaused(false);
    setPausedMs(0);
    setStartEpochMs(effectiveStart);
    AsyncStorage.setItem(TIMER_KEY, String(effectiveStart)).catch(() => {});
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
    startEpochMs,
    discardCount,
    startTimer,
    startTimerAt,
    pauseTimer,
    resumeTimer,
    stopTimer,
    discardWorkout,
  }), [startEpochMs, isPaused, elapsedSeconds, discardCount, startTimer, startTimerAt, pauseTimer, resumeTimer, stopTimer, discardWorkout]);

  return (
    <WorkoutTimerContext.Provider value={value}>
      {children}
    </WorkoutTimerContext.Provider>
  );
}

export function useWorkoutTimer() {
  return useContext(WorkoutTimerContext);
}
