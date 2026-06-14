import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { LATE_NIGHT_GRACE_HOUR } from "../utils/workout";

// Fires `onRollover` at the moments the "effective training day" can change
// without any user action: when the app returns to the foreground, and when the
// local clock next crosses midnight or the late-night grace cutoff. Workout-day
// screens use this to re-resolve today's scheduled workout / completed state so
// they don't keep showing yesterday after the date rolls over while the screen
// is mounted or while the app is backgrounded.
//
// Why these boundaries: getEffectiveToday only changes value at 00:00 (calendar
// flip) and at LATE_NIGHT_GRACE_HOUR (grace window closes). We schedule a single
// timeout to the next of those rather than polling on an interval.
export function useDayRollover(onRollover: () => void) {
  const cbRef = useRef(onRollover);
  cbRef.current = onRollover;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      const now = new Date();
      const candidates: number[] = [];
      for (const dayOffset of [0, 1]) {
        for (const hour of [0, LATE_NIGHT_GRACE_HOUR]) {
          const d = new Date(now);
          d.setDate(d.getDate() + dayOffset);
          // +1s so the timer fires safely past the boundary, never exactly on it.
          d.setHours(hour, 0, 1, 0);
          if (d.getTime() > now.getTime()) candidates.push(d.getTime());
        }
      }
      // Cap the delay so a long-suspended JS timer still re-checks within a few
      // hours; AppState "active" covers the common foreground-after-sleep case.
      const delay = Math.min(Math.min(...candidates) - now.getTime(), 6 * 60 * 60 * 1000);
      timeout = setTimeout(() => { cbRef.current(); schedule(); }, delay);
    };

    schedule();
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") { cbRef.current(); schedule(); }
    });
    return () => { if (timeout) clearTimeout(timeout); sub.remove(); };
  }, []);
}
