import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";
import { AppState } from "react-native";
import { scheduleRestTimerAlert, cancelRestTimerAlert } from "../utils/notificationScheduler";

type RestTimerCtx = {
  restDisplay: number;
  restTotal: number;
  restBannerActive: boolean;
  /** Epoch ms when the running rest ends; null when no rest is active. Mirrors
   *  the internal end ref so consumers (the Live Activity payload) can render
   *  a wall-clock countdown instead of re-deriving it from restDisplay. */
  restEndsAt: number | null;
  startRestTimer: (seconds: number) => void;
  dismissRestTimer: () => void;
  adjustRestTimer: (delta: number) => void;
};

const RestTimerContext = createContext<RestTimerCtx | null>(null);

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const restTimerEndRef = useRef<number | null>(null);
  const [restBannerActive, setRestBannerActive] = useState(false);
  const [restDisplay, setRestDisplay] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);

  const dismissRestTimer = useCallback(() => {
    restTimerEndRef.current = null;
    setRestEndsAt(null);
    setRestBannerActive(false);
    // Covers user dismissal AND natural in-app expiry; the OS alert is only
    // wanted when the app is backgrounded at t=0 (foreground fire is suppressed
    // by the handler anyway, this just keeps the pending queue clean).
    cancelRestTimerAlert();
  }, []);

  useEffect(() => {
    if (!restBannerActive) return;
    const tick = () => {
      if (!restTimerEndRef.current) return;
      const remaining = Math.ceil((restTimerEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        dismissRestTimer();
      } else {
        setRestDisplay(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    const sub = AppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [restBannerActive, dismissRestTimer]);

  const startRestTimer = useCallback((seconds: number) => {
    if (seconds > 0) {
      const end = Date.now() + seconds * 1000;
      restTimerEndRef.current = end;
      setRestEndsAt(end);
      setRestDisplay(seconds);
      setRestTotal(seconds);
      setRestBannerActive(true);
      // Fires only if the app is backgrounded when the rest ends (prefs-gated,
      // foreground-suppressed). Replaces any previous pending alert.
      scheduleRestTimerAlert(end);
    } else {
      dismissRestTimer();
    }
  }, [dismissRestTimer]);

  const adjustRestTimer = useCallback((delta: number) => {
    if (!restTimerEndRef.current) return;
    const newEnd = restTimerEndRef.current + delta * 1000;
    if (newEnd <= Date.now()) { dismissRestTimer(); return; }
    restTimerEndRef.current = newEnd;
    setRestEndsAt(newEnd);
    setRestDisplay(Math.ceil((newEnd - Date.now()) / 1000));
    scheduleRestTimerAlert(newEnd);
  }, [dismissRestTimer]);

  return (
    <RestTimerContext.Provider value={{ restDisplay, restTotal, restBannerActive, restEndsAt, startRestTimer, dismissRestTimer, adjustRestTimer }}>
      {children}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used within RestTimerProvider");
  return ctx;
}
