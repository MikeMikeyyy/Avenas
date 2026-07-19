// constants/notifications.ts
//
// Notification preferences — the single source of truth for which categories of
// notification Avenas is allowed to send. Read by app/notifications.tsx (the
// Settings > Notifications page) and by utils/notifications.ts, which every
// delivery site (utils/notificationScheduler.ts for local, the push_tokens
// categories column for server push) consults before firing.
//
// Storage: a single JSON blob at NOTIF_PREFS_KEY, written through utils/storage
// (getJSON/setJSON) and surfaced reactively by contexts/NotificationPrefsContext.
//
// Delivery: local categories are scheduled on-device by
// utils/notificationScheduler.ts (resynced on launch/background/prefs change);
// PUSH_CATEGORIES are sent server-side (migration 0012) to the Expo push tokens
// registered in lib/push.ts, which mirrors the effective category values to the
// push_tokens row so the server never pushes a silenced category.

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export const NOTIF_PREFS_KEY = "@avenas/notification_prefs";

/** Every category the user can independently silence. Add new keys here AND to
 *  DEFAULT_NOTIFICATION_PREFS.categories + NOTIFICATION_SECTIONS below. */
export type NotificationCategory =
  | "coachMessages"
  | "workoutReminders"
  | "streakReminders"
  | "restTimerAlerts"
  | "programShared"
  | "coachingRequests"
  | "achievements"
  | "weeklySummary";

/** Categories delivered by the SERVER as Expo push (another account triggers
 *  them). Everything else is scheduled locally on-device. lib/push.ts mirrors
 *  the effective value (master && category) of exactly these keys into the
 *  push_tokens.categories column that migration 0012's triggers check. */
export const PUSH_CATEGORIES = ["coachMessages", "programShared", "coachingRequests"] as const;

/** Wall-clock time of day for the daily workout reminder. */
export type ReminderTime = { hour: number; minute: number };

export type NotificationPrefs = {
  /** Master switch. When false, EVERY category is suppressed regardless of its
   *  own value (the per-category values are preserved so they restore on re-enable). */
  master: boolean;
  categories: Record<NotificationCategory, boolean>;
  /** When the daily workout reminder fires on scheduled (non-Rest) days.
   *  Only meaningful while categories.workoutReminders is on. */
  workoutReminderTime: ReminderTime;
};

/** Sensible defaults on first launch. High-signal categories default ON; the
 *  opt-in ones (workout reminders — a per-user time preference, deliberately
 *  OFF for new accounts — rest timer, weekly summary) default OFF. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  master: true,
  categories: {
    coachMessages: true,
    workoutReminders: false,
    streakReminders: true,
    restTimerAlerts: false,
    programShared: true,
    coachingRequests: true,
    achievements: true,
    weeklySummary: false,
  },
  workoutReminderTime: { hour: 17, minute: 0 },
};

/** Render catalog for the page: grouped sections with copy + icon per category.
 *  Domain data (not presentation logic), so it lives beside the type it indexes. */
export const NOTIFICATION_SECTIONS: {
  title: string;
  items: { key: NotificationCategory; label: string; description: string; icon: IoniconName }[];
}[] = [
  {
    title: "Messages",
    items: [
      {
        key: "coachMessages",
        label: "Coach & client messages",
        description: "New messages from your trainer or your clients.",
        icon: "chatbubble-ellipses-outline",
      },
    ],
  },
  {
    title: "Training",
    items: [
      {
        key: "workoutReminders",
        label: "Workout reminders",
        description: "A nudge on training days at a time you choose.",
        icon: "barbell-outline",
      },
      {
        key: "streakReminders",
        label: "Streak reminders",
        description: "A heads-up before your streak resets for the day.",
        icon: "flame-outline",
      },
      {
        key: "restTimerAlerts",
        label: "Rest timer alerts",
        description: "Tells you when a rest timer finishes in the background.",
        icon: "timer-outline",
      },
    ],
  },
  {
    title: "Coaching",
    items: [
      {
        key: "programShared",
        label: "Program shared with you",
        description: "When a coach or trainer sends you a new program.",
        icon: "clipboard-outline",
      },
      {
        key: "coachingRequests",
        label: "New client or coach request",
        description: "When someone asks to connect with you.",
        icon: "person-add-outline",
      },
    ],
  },
  {
    title: "Progress",
    items: [
      {
        key: "achievements",
        label: "Achievements & milestones",
        description: "Personal records and streak milestones.",
        icon: "trophy-outline",
      },
      {
        key: "weeklySummary",
        label: "Weekly summary",
        description: "A recap of your training each week.",
        icon: "stats-chart-outline",
      },
    ],
  },
];
