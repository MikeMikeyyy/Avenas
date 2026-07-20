// utils/notificationScheduler.ts
//
// The single delivery site for LOCAL notifications (workout reminders, streak
// reminders, weekly summary, rest-timer alerts, achievement banners). Every
// schedule goes through the prefs gate in utils/notifications.ts, so a toggle
// on the Settings > Notifications page really silences its category.
//
// Model: resyncScheduledNotifications() is idempotent — it cancels everything
// this module scheduled ahead of time (kind: "scheduled") and rebuilds the next
// 7 days from current local state (active program, override, workout_dates,
// prefs). app/_layout.tsx calls it on launch and on every background/inactive
// transition, and NotificationPrefsContext calls it on every prefs change, so
// the pending schedule always reflects the state the user last left the app in.
// Rest-timer one-shots use kind: "restTimer" and are deliberately NOT touched
// by a resync — a backgrounding user mid-rest keeps their alert.
//
// Server push (messages, requests, shares) is NOT handled here — see lib/push.ts
// and supabase/migrations/0012_push_notifications.sql.
//
// Expo Go note: local notifications work in Expo Go on a device; only remote
// push needs a dev/EAS build. Everything here no-ops on web and fails soft.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";

import { getJSON } from "./storage";
import { toYMD, todayYMD, fmtDuration } from "./dates";
import { getWorkoutForDate, resolveWorkoutForDate, type DayOverride } from "./workout";
import {
  PROGRAMS_KEY,
  WORKOUT_DATES_KEY,
  WORKOUT_DAY_OVERRIDE_KEY,
  WORKOUT_HISTORY_KEY,
  type CompletedWorkout,
  type SavedProgram,
} from "../constants/programs";
import { loadNotificationPrefs, isCategoryEnabled } from "./notifications";
import type { NotificationCategory } from "../constants/notifications";

/** How many days of one-shot reminders to keep queued. Refilled on every app
 *  open/background, so it only runs dry if the app isn't opened for a week —
 *  at which point a stale nudge would be noise anyway. */
const HORIZON_DAYS = 7;

/** Streak reminders fire at a fixed evening time — late enough to matter, early
 *  enough to act on. (The workout reminder time is the user-configurable one.) */
const STREAK_REMINDER = { hour: 20, minute: 30 };

/** Weekly summary: Sunday evening. Scheduled as a ONE-SHOT (not a repeating
 *  trigger) so the body can carry real stats — content is baked at schedule
 *  time, and the resync on every app open/background keeps it fresh. */
const WEEKLY_SUMMARY = { hour: 18, minute: 0 };

const warn = (op: string, err: unknown) => {
  if (__DEV__) console.warn("[avenas] notifications", op, err);
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

// ── init: foreground presentation policy + Android channel ────────────────────

/** Categories whose banner is suppressed while the app is foregrounded, because
 *  the app itself already surfaces the event there (in-app rest banner, live
 *  chat + unread badges, the home screen itself for workout/streak nudges). */
const SILENT_IN_FOREGROUND: ReadonlySet<string> = new Set<NotificationCategory>([
  "workoutReminders",
  "streakReminders",
  "restTimerAlerts",
  "coachMessages",
]);

let initialized = false;

/** Install the foreground handler + Android channel. Safe to call repeatedly;
 *  app/_layout.tsx calls it once on mount before the first resync. */
export function initNotifications(): void {
  if (!isNative || initialized) return;
  initialized = true;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const category = notification.request.content.data?.category;
      const show = !(typeof category === "string" && SILENT_IN_FOREGROUND.has(category));
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch((e) => warn("channel", e));
  }
}

// ── permissions ───────────────────────────────────────────────────────────────

/** True when OS-level permission is granted. When `interactive`, asks the user
 *  if they haven't been asked yet (call from a toggle tap, never from startup). */
export async function ensureNotificationPermissions(interactive: boolean): Promise<boolean> {
  if (!isNative) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!interactive || !current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch (e) {
    warn("permissions", e);
    return false;
  }
}

// ── the resync pipeline ───────────────────────────────────────────────────────

type Kind = "scheduled" | "restTimer";

async function cancelByKind(kind: Kind): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((r) => r.content.data?.kind === kind)
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
  );
}

function at(daysFromToday: number, hour: number, minute: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hour, minute, 0);
}

async function schedule(
  category: NotificationCategory,
  title: string,
  body: string,
  trigger: Notifications.SchedulableNotificationTriggerInput,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", data: { kind: "scheduled", category } },
    trigger,
  });
}

async function doResync(): Promise<void> {
  const prefs = await loadNotificationPrefs();

  // Wipe our pending schedule first: it must never outlive a toggle-off or a
  // revoked OS permission. (Rest-timer one-shots are left alone — see header.)
  await cancelByKind("scheduled");

  if (!prefs.master) return;
  if (!(await ensureNotificationPermissions(false))) return;

  const now = new Date();
  const today = todayYMD();

  // Workout reminders: one one-shot per scheduled (non-Rest) day at the user's
  // chosen time. Today is skipped once its workout is already logged, and the
  // change-day override is honored for today only (its only valid day).
  if (prefs.categories.workoutReminders) {
    const programs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
    const active = programs.find((p) => p.status === "active") ?? null;
    if (active) {
      const override = await getJSON<DayOverride | null>(WORKOUT_DAY_OVERRIDE_KEY, null);
      const doneDates = await getJSON<string[]>(WORKOUT_DATES_KEY, []);
      const { hour, minute } = prefs.workoutReminderTime;
      for (let i = 0; i < HORIZON_DAYS; i++) {
        const fireAt = at(i, hour, minute);
        if (fireAt.getTime() <= now.getTime()) continue;
        const ymd = toYMD(fireAt);
        if (ymd === today && doneDates.includes(today)) continue;
        const resolved =
          ymd === today
            ? resolveWorkoutForDate(active, override, ymd, programs)
            : getWorkoutForDate(active, ymd);
        if (!resolved) continue;
        await schedule(
          "workoutReminders",
          "Time to train",
          `${resolved.name} is on the schedule today.`,
          { type: SchedulableTriggerInputTypes.DATE, date: fireAt },
        );
      }
    }
  }

  // Streak reminders: an evening heads-up on days the app hasn't been opened.
  // Today never needs one from this device's point of view (scheduling happens
  // while the app is open, which is exactly what keeps the streak alive), so
  // one-shots start tomorrow and each later open cancels + reschedules.
  if (prefs.categories.streakReminders) {
    for (let i = 1; i <= HORIZON_DAYS; i++) {
      await schedule(
        "streakReminders",
        "Keep your streak alive",
        "Open Avenas before midnight to keep your streak going.",
        { type: SchedulableTriggerInputTypes.DATE, date: at(i, STREAK_REMINDER.hour, STREAK_REMINDER.minute) },
      );
    }
  }

  // Weekly summary: a one-shot for next Sunday evening carrying real numbers
  // for that Monday–Sunday week (workout count + total training time), as of
  // the last time the app was open. Zero-workout weeks fall back to the
  // generic recap line rather than a guilt trip.
  if (prefs.categories.weeklySummary) {
    const daysUntilSunday = (7 - now.getDay()) % 7;
    let fireAt = at(daysUntilSunday, WEEKLY_SUMMARY.hour, WEEKLY_SUMMARY.minute);
    if (fireAt.getTime() <= now.getTime()) {
      fireAt = at(daysUntilSunday + 7, WEEKLY_SUMMARY.hour, WEEKLY_SUMMARY.minute);
    }
    const weekStart = new Date(fireAt);
    weekStart.setDate(fireAt.getDate() - 6);
    const startYMD = toYMD(weekStart);
    const endYMD = toYMD(fireAt);
    const history = await getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []);
    const inWeek = history.filter(w => w.date >= startYMD && w.date <= endYMD);
    const totalSecs = inWeek.reduce((s, w) => s + (w.durationSeconds || 0), 0);
    const body = inWeek.length > 0
      ? `${inWeek.length} workout${inWeek.length === 1 ? "" : "s"} and ${fmtDuration(totalSecs)} of training this week. Tap for the full recap.`
      : "Your weekly training recap is ready in Avenas.";
    await schedule(
      "weeklySummary",
      "Your week in review",
      body,
      { type: SchedulableTriggerInputTypes.DATE, date: fireAt },
    );
  }
}

// Serialize resyncs: a second call while one is running queues exactly one
// follow-up (same discipline as lib/syncManager) so cancel/schedule interleaving
// can't corrupt the pending set.
let chain: Promise<void> = Promise.resolve();

/** Rebuild the pending local-notification schedule from current local state.
 *  Fire-and-forget; never throws. */
export function resyncScheduledNotifications(): void {
  if (!isNative) return;
  chain = chain.then(() => doResync()).catch((e) => warn("resync", e));
}

// ── rest-timer one-shot ───────────────────────────────────────────────────────

let restTimerNotifId: string | null = null;

/** Schedule the "rest complete" alert for `endsAtMs`. Replaces any pending one
 *  (adjusting the timer just calls this again). Foreground-suppressed, so it
 *  only surfaces when the app is backgrounded when the rest ends. */
export function scheduleRestTimerAlert(endsAtMs: number): void {
  if (!isNative) return;
  void (async () => {
    try {
      await cancelRestTimerAlertAsync();
      if (!(await isCategoryEnabled("restTimerAlerts"))) return;
      if (!(await ensureNotificationPermissions(false))) return;
      if (endsAtMs <= Date.now()) return;
      restTimerNotifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Rest complete",
          body: "Time for your next set.",
          sound: "default",
          data: { kind: "restTimer", category: "restTimerAlerts" },
        },
        trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(endsAtMs) },
      });
    } catch (e) {
      warn("restTimer", e);
    }
  })();
}

async function cancelRestTimerAlertAsync(): Promise<void> {
  if (restTimerNotifId) {
    const id = restTimerNotifId;
    restTimerNotifId = null;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
}

/** Cancel the pending rest alert (timer dismissed or finished in-app). */
export function cancelRestTimerAlert(): void {
  if (!isNative) return;
  void cancelRestTimerAlertAsync().catch((e) => warn("restTimerCancel", e));
}

// ── achievements ──────────────────────────────────────────────────────────────

/** Present an achievement banner right now (streak milestones, PRs). Gated on
 *  the achievements toggle; shows even in foreground (that's where PRs happen). */
export function notifyAchievement(title: string, body: string): void {
  if (!isNative) return;
  void (async () => {
    try {
      if (!(await isCategoryEnabled("achievements"))) return;
      if (!(await ensureNotificationPermissions(false))) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: "default", data: { kind: "immediate", category: "achievements" } },
        trigger: null,
      });
    } catch (e) {
      warn("achievement", e);
    }
  })();
}
