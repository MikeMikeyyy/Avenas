// constants/notifications.ts
//
// Notification preferences — the single source of truth for which categories of
// notification Avenas is allowed to send. Read by app/notifications.tsx (the
// Settings > Notifications page) and by utils/notifications.ts, which any future
// delivery site (local schedule or push) MUST consult before firing.
//
// Storage: a single JSON blob at NOTIF_PREFS_KEY, written through utils/storage
// (getJSON/setJSON) and surfaced reactively by contexts/NotificationPrefsContext.
//
// Delivery note: toggling these does NOT itself fire or silence OS notifications
// (that needs a dev/EAS build + expo-notifications). The toggles gate whether the
// app will request a given notification once delivery is wired.

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

export type NotificationPrefs = {
  /** Master switch. When false, EVERY category is suppressed regardless of its
   *  own value (the per-category values are preserved so they restore on re-enable). */
  master: boolean;
  categories: Record<NotificationCategory, boolean>;
};

/** Sensible defaults on first launch. The two the user explicitly asked about
 *  (coach messages, workout reminders) plus the high-signal ones default ON;
 *  the noisier ones (rest timer, weekly summary) default OFF. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  master: true,
  categories: {
    coachMessages: true,
    workoutReminders: true,
    streakReminders: true,
    restTimerAlerts: false,
    programShared: true,
    coachingRequests: true,
    achievements: true,
    weeklySummary: false,
  },
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
        description: "A daily nudge when today's workout is scheduled.",
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
