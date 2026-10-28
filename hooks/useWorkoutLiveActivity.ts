// hooks/useWorkoutLiveActivity.ts
//
// Owns the workout Live Activity lifecycle for the Workout screen:
//   - pushes the payload to ActivityKit whenever it meaningfully changes
//     (debounced + JSON-diffed, so typing a weight coalesces into one update
//     and the running elapsed/rest timers never cause pushes — the card counts
//     natively on its own), and sends a change still waiting the moment the
//     app leaves the foreground, before iOS suspends it (cardPushes),
//   - ends the card when the session ends (finish / discard / toggle off),
//   - on foreground, drains the lock-screen actions (set ticks, rest skip/±15s)
//     and replays them into the screen via the callbacks.
//
// Everything no-ops when the native module is unavailable (Expo Go, Android,
// iOS < 17) — see modules/avenas-live-activity.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  consumeLiveActivityActions,
  endWorkoutActivity,
  isLiveActivityAvailable,
  startOrUpdateWorkoutActivity,
  type LiveActivityPayload,
  type LiveActivityTickAction,
} from "../modules/avenas-live-activity";
import { cardPushes, restFromCard } from "../utils/liveActivity";

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

  // What the card is sent, and when, and what has reached it
  // (utils/liveActivity.ts cardPushes).
  const [pushes] = useState(() => cardPushes(
    json => startOrUpdateWorkoutActivity(JSON.parse(json) as LiveActivityPayload),
    PUSH_DEBOUNCE_MS,
  ));

  // ── push / end ──────────────────────────────────────────────────────────────
  const payloadJson = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    if (!enabled || !active || !payloadJson) {
      pushes.cancel();
      // End the card when the session ends or the toggle flips off. Also runs
      // once after the draft restore resolves to "no session" — that clears a
      // stale card left behind by an app kill whose draft was discarded.
      if (ready && (pushes.sent() || !active)) {
        pushes.reset();
        void endWorkoutActivity();
      }
      return;
    }
    if (!isLiveActivityAvailable()) {
      pushes.cancel();
      return;
    }
    // Waits out the debounce even with the app in the background: woken there
    // by a lock-screen tick, the draft it restores doesn't have the tick yet,
    // and only the wait lets the replay (consume) land before the card is
    // given the session without it.
    pushes.change(payloadJson);
  }, [payloadJson, enabled, active, ready, pushes]);

  // A change still waiting goes with the screen.
  useEffect(() => () => pushes.cancel(), [pushes]);

  // ── consume lock-screen actions ─────────────────────────────────────────────
  const consume = useCallback(() => {
    if (!enabledRef.current || !activeRef.current) return;
    // No card to read back (Expo Go, Android, iOS < 17, Live Activities off):
    // the bridge answers "no rest running", and taken at its word that
    // dismissed the rest timer every time the app came back to the front, and
    // the moment a session's first tick started one.
    if (!isLiveActivityAvailable()) return;
    void consumeLiveActivityActions().then(res => {
      if (res.actions.length > 0) {
        onRemoteTicksRef.current(res.actions.filter(a => a.kind === "tick"));
      }
      // Only a rest changed ON the card moves the screen's (restFromCard). The
      // card's rest mirror echoes the last push to reach it, null before the
      // card's first.
      const landed = pushes.landed();
      const end = restFromCard({
        cardEnd: res.restEndMs,
        lastPushedEnd: landed ? (JSON.parse(landed) as LiveActivityPayload).restEndMs : null,
        appEnd: restEndsAtRef.current,
        now: Date.now(),
      });
      if (end !== null) onRemoteRestRef.current(end);
    });
  }, [pushes]);

  // When the session becomes available (draft restored / workout starts),
  // drain anything that queued up — covers the cold-start-after-kill path,
  // where no AppState transition ever fires.
  useEffect(() => {
    if (active) consume();
  }, [active, consume]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") consume();
      // Locked, or another app opened: the card is on screen from here, and
      // iOS is about to suspend the app, so a change still waiting goes now.
      else pushes.flush();
    });
    return () => sub.remove();
  }, [consume, pushes]);
}
