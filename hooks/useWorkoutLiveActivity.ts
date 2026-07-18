// hooks/useWorkoutLiveActivity.ts
//
// Owns the workout Live Activity lifecycle for the Workout screen:
//   - pushes the payload to ActivityKit whenever it meaningfully changes
//     (debounced + JSON-diffed, so typing a weight coalesces into one update
//     and the running elapsed/rest timers never cause pushes — the card counts
//     natively on its own),
//   - ends the card when the session ends (finish / discard / toggle off),
//   - on foreground, drains the lock-screen actions (set ticks, rest skip/±15s)
//     and replays them into the screen via the callbacks.
//
// Everything no-ops when the native module is unavailable (Expo Go, Android,
// iOS < 17) — see modules/avenas-live-activity.

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import {
  consumeLiveActivityActions,
  endWorkoutActivity,
  isLiveActivityAvailable,
  startOrUpdateWorkoutActivity,
  type LiveActivityPayload,
  type LiveActivityTickAction,
} from "../modules/avenas-live-activity";

// Coalesce bursts (typing, cascade fills) into a single ActivityKit update —
// the OS rate-limits Live Activity updates, so we must not push per keystroke.
const PUSH_DEBOUNCE_MS = 400;

export function useWorkoutLiveActivity(opts: {
  /** Settings toggle (LIVE_ACTIVITY_KEY, default on). */
  enabled: boolean;
  /** The draft has been restored — before this, `active: false` means
   *  "unknown", not "no session", so no stale-card cleanup runs. */
  ready: boolean;
  /** An in-progress session exists (same gate as the draft autosave). */
  active: boolean;
  /** Built by the screen via buildLiveActivityPayload; null when no session. */
  payload: LiveActivityPayload | null;
  /** Current JS rest end (epoch ms) — the idempotence baseline for rest sync. */
  restEndsAt: number | null;
  onRemoteTicks: (actions: LiveActivityTickAction[]) => void;
  /** endMs > now → start/adjust rest to end then; 0 → dismiss. */
  onRemoteRest: (endMs: number) => void;
}) {
  const { enabled, ready, active, payload, restEndsAt, onRemoteTicks, onRemoteRest } = opts;

  // Refs so the consume path (mount + AppState listener) always sees current
  // values without re-subscribing.
  const enabledRef = useRef(enabled);
  const activeRef = useRef(active);
  const restEndsAtRef = useRef(restEndsAt);
  const onRemoteTicksRef = useRef(onRemoteTicks);
  const onRemoteRestRef = useRef(onRemoteRest);
  enabledRef.current = enabled;
  activeRef.current = active;
  restEndsAtRef.current = restEndsAt;
  onRemoteTicksRef.current = onRemoteTicks;
  onRemoteRestRef.current = onRemoteRest;

  const lastPushed = useRef<string | null>(null);

  // ── push / end ──────────────────────────────────────────────────────────────
  const payloadJson = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    if (!enabled || !active || !payloadJson) {
      // End the card when the session ends or the toggle flips off. Also runs
      // once after the draft restore resolves to "no session" — that clears a
      // stale card left behind by an app kill whose draft was discarded.
      if (ready && (lastPushed.current !== null || !active)) {
        lastPushed.current = null;
        void endWorkoutActivity();
      }
      return;
    }
    if (!isLiveActivityAvailable()) return;
    if (payloadJson === lastPushed.current) return;
    const id = setTimeout(() => {
      lastPushed.current = payloadJson;
      void startOrUpdateWorkoutActivity(JSON.parse(payloadJson) as LiveActivityPayload);
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [payloadJson, enabled, active, ready]);

  // ── consume lock-screen actions ─────────────────────────────────────────────
  const consume = useCallback(() => {
    if (!enabledRef.current || !activeRef.current) return;
    void consumeLiveActivityActions().then(res => {
      if (res.actions.length > 0) {
        onRemoteTicksRef.current(res.actions.filter(a => a.kind === "tick"));
      }
      // Rest sync, idempotent: compare effective ends (past ends count as
      // "none" on both sides) and only touch the JS timer on a real drift —
      // otherwise every foreground would reset the banner's progress bar.
      const now = Date.now();
      const nativeEnd = res.restEndMs > now + 1000 ? res.restEndMs : 0;
      const jsRaw = restEndsAtRef.current ?? 0;
      const jsEnd = jsRaw > now + 1000 ? jsRaw : 0;
      if (Math.abs(nativeEnd - jsEnd) > 1500) {
        onRemoteRestRef.current(nativeEnd);
      }
    });
  }, []);

  // When the session becomes available (draft restored / workout starts),
  // drain anything that queued up — covers the cold-start-after-kill path,
  // where no AppState transition ever fires.
  useEffect(() => {
    if (active) consume();
  }, [active, consume]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") consume();
    });
    return () => sub.remove();
  }, [consume]);
}
