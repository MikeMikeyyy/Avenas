// components/UnfinishedWorkoutWatcher.tsx
//
// A workout forgotten, caught (user request, 2026-10-15; the rules are in
// utils/unfinishedSession.ts). Drawn once at the root (app/_layout.tsx), beside
// the in-progress bar, and draws nothing: it asks with native alerts, over
// whatever screen is up, which also keeps it clear of the screens' own sheets.
//
//   - A workout filed to the Journal because its day was over (at launch, or
//     the Workout tab's day ending with the app open): said once, with View in
//     Journal, the workout's own page, where it can be edited.
//   - Back in the app with a workout open and nothing ticked or typed in it for
//     an hour: "Forgot to finish your workout?" Finish Workout opens the
//     Workout tab's Complete Workout sheet ending at the last thing logged (its
//     `finish` param), not at the moment of asking; Keep Going asks again after
//     another quiet hour. With nothing entered there's nothing to save, so it
//     offers Discard Workout instead.
//   - Leaving the app with a workout open: a reminder an hour after the last
//     thing logged (utils/notificationScheduler.ts), cancelled on coming back.
//
// All of it is on the phone, signal or not.

import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "../contexts/AuthContext";
import { useWorkoutTimer } from "../contexts/WorkoutTimerContext";
import { useFloatingBars } from "../hooks/useFloatingBars";
import { fmtClock, todayYMD } from "../utils/dates";
import { cancelForgottenWorkoutReminder, scheduleForgottenWorkoutReminder } from "../utils/notificationScheduler";
import {
  forgottenMessage, forgottenReminderAt, hasEnteredSets, lastActivityAt, looksForgotten,
  noticeMessage, setsDone, setsOfLog,
} from "../utils/unfinishedSession";
import { fileStaleDraft, loadDraft, onUnfinishedFiled, takeUnfinishedNotice } from "../utils/unfinishedSessionStore";

/** The first look after launch waits for Home to draw, and for the launch's
 *  own prompts (a sign-in notice, the update gate). */
const FIRST_LOOK_DELAY_MS = 1500;

/** When "Keep Going" was last pressed: the next ask waits an hour from it. */
let keptGoingAt: number | null = null;

export default function UnfinishedWorkoutWatcher() {
  const router = useRouter();
  const { loaded, userId } = useAuth();
  const { isRunning, isPaused, startEpochMs, discardWorkout, stopTimer } = useWorkoutTimer();
  const { onTabScreen } = useFloatingBars();

  // Read by the AppState handlers, which see the values of the moment.
  const liveRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const onTabRef = useRef(onTabScreen);
  useEffect(() => {
    liveRef.current = isRunning || isPaused;
    startRef.current = startEpochMs;
    onTabRef.current = onTabScreen;
  }, [isRunning, isPaused, startEpochMs, onTabScreen]);

  // One alert at a time: a second look while one is up waits for its answer.
  const asking = useRef(false);
  const done = useCallback(() => { asking.current = false; }, []);

  const look = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      // A workout whose day is over, and isn't still being logged, goes to the
      // Journal first, its clock with it: coming back the next morning to the
      // app left open, it's said to be saved rather than asked about (and a
      // Finish then would have found the new day's session instead). The
      // Workout tab does the same when it's open; whichever comes first files.
      const { stale } = await fileStaleDraft();
      if (stale) stopTimer();

      const notice = await takeUnfinishedNotice();
      if (notice) {
        Alert.alert("You didn't finish your workout", noticeMessage(notice, todayYMD()), [
          { text: "OK", style: "cancel", onPress: done },
          {
            text: "View in Journal",
            onPress: () => {
              done();
              router.navigate({ pathname: "/workout-detail", params: { id: notice.id } });
            },
          },
        ], { onDismiss: done });
        return;
      }

      // Nothing open now, or nothing that was over needed saying: done.
      if (stale || !liveRef.current) { done(); return; }
      const draft = await loadDraft();
      // Opened with Start and nothing since: quiet from the clock's start.
      const last = (draft ? lastActivityAt(draft) : null) ?? startRef.current;
      if (!looksForgotten(liveRef.current, last, keptGoingAt, Date.now()) || last === null) { done(); return; }

      const entered = draft ? hasEnteredSets(draft.log) : false;
      const { done: ticked, total } = setsDone(draft ? setsOfLog(draft.log) : []);
      const name = draft?.workoutInfo.name ?? "Your workout";
      Alert.alert("Forgot to finish your workout?", forgottenMessage(name, fmtClock(new Date(last)), ticked, total, entered), [
        { text: "Keep Going", style: "cancel", onPress: () => { keptGoingAt = Date.now(); done(); } },
        entered
          ? {
              text: "Finish Workout",
              onPress: () => {
                done();
                // New every time, so the Workout tab answers each one. From a
                // screen pushed over the tabs, dismissTo pops back to them
                // (navigate would push a second tab bar), as the in-progress
                // bar does.
                const href = { pathname: "/(tabs)/workout", params: { finish: String(Date.now()) } } as const;
                if (onTabRef.current) router.navigate(href);
                else router.dismissTo(href);
              },
            }
          : { text: "Discard Workout", style: "destructive", onPress: () => { done(); discardWorkout(); } },
      ], { onDismiss: done });
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "UnfinishedWorkoutWatcher", e);
      done();
    }
  }, [router, discardWorkout, stopTimer, done]);

  // Leaving with a workout open: remind at the hour since the last thing logged.
  const remind = useCallback(async () => {
    if (!liveRef.current) return;
    try {
      const draft = await loadDraft();
      const last = (draft ? lastActivityAt(draft) : null) ?? startRef.current;
      if (last === null) return;
      scheduleForgottenWorkoutReminder(forgottenReminderAt(last, Date.now()), draft?.workoutInfo.name ?? null);
    } catch (e) {
      if (__DEV__) console.warn("[avenas]", "UnfinishedWorkoutWatcher remind", e);
    }
  }, []);

  useEffect(() => {
    if (!loaded || !userId) return;
    const first = setTimeout(() => { void look(); }, FIRST_LOOK_DELAY_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        cancelForgottenWorkoutReminder();
        void look();
      } else {
        void remind();
      }
    });
    const off = onUnfinishedFiled(() => { void look(); });
    return () => { clearTimeout(first); sub.remove(); off(); };
  }, [loaded, userId, look, remind]);

  return null;
}
