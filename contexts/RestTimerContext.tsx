import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";
import { AppState } from "react-native";

type RestTimerCtx = {
  restDisplay: number;
  restBannerActive: boolean;
  startRestTimer: (seconds: number) => void;
  dismissRestTimer: () => void;
  adjustRestTimer: (delta: number) => void;
};

const RestTimerContext = createContext<RestTimerCtx | null>(null);

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const restTimerEndRef = useRef<number | null>(null);
  const [restBannerActive, setRestBannerActive] = useState(false);
  const [restDisplay, setRestDisplay] = useState(0);

  const dismissRestTimer = useCallback(() => {
    restTimerEndRef.current = null;
    setRestBannerActive(false);
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
      restTimerEndRef.current = Date.now() + seconds * 1000;
      setRestDisplay(seconds);
      setRestBannerActive(true);
    } else {
      dismissRestTimer();
    }
  }, [dismissRestTimer]);

  const adjustRestTimer = useCallback((delta: number) => {
    if (!restTimerEndRef.current) return;
    const newEnd = restTimerEndRef.current + delta * 1000;
    if (newEnd <= Date.now()) { dismissRestTimer(); return; }
    restTimerEndRef.current = newEnd;
    setRestDisplay(Math.ceil((newEnd - Date.now()) / 1000));
  }, [dismissRestTimer]);

  return (
    <RestTimerContext.Provider value={{ restDisplay, restBannerActive, startRestTimer, dismissRestTimer, adjustRestTimer }}>
      {children}
    </RestTimerContext.Provider>
  );
}

export function useRestTimer() {
  const ctx = useContext(RestTimerContext);
  if (!ctx) throw new Error("useRestTimer must be used within RestTimerProvider");
  return ctx;
}
