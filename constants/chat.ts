// constants/chat.ts
//
// Chat types + storage keys for the Trainer section. Real connections message
// through Supabase (migration 0011, lib/chat.ts); the AsyncStorage blob below
// only holds threads with local mock-roster contacts and pre-0011 leftovers.
// utils/chatStore.ts routes between the two per contact.

export const CHATS_KEY = "@avenas/chats";

/** Read receipts that drive the messages-list unread badges (green dot + bold). */
export const CHAT_READS_KEY = "@avenas/chat_reads";

// ─── Moderation (Apple Guideline 1.2 — Safety / User-Generated Content) ───────

/** Users the current account has blocked — hidden from the conversation list. */
export const BLOCKED_USERS_KEY = "@avenas/blocked_users";
/** On-device log of content/user reports (no backend yet; routed to Support). */
export const REPORTS_KEY = "@avenas/reports";
/** Message ids the user reported/hid — filtered out of every thread on load. */
export const HIDDEN_MESSAGES_KEY = "@avenas/hidden_messages";

export type ChatMessage = {
  id: string;
  /** true = sent by the current account; false = received from the contact. */
  mine: boolean;
  text: string;
  sentAtISO: string;
};

/** All conversations in one blob: contactId → messages, oldest → newest. */
export type ChatThreads = Record<string, ChatMessage[]>;

/** Per-contact read receipts: contactId → ISO time the thread was last opened. */
export type ChatReads = Record<string, string>;

/** A person the user has blocked (kept with name so the Blocked list can render
 *  it even after the contact is gone from the active conversation list). */
export type BlockedUser = {
  id: string;
  name: string;
  initials: string;
  blockedAtISO: string;
};

/** Why something was reported. Mirrors the standard moderation reason set. */
export type ReportReason =
  | "Spam or scam"
  | "Harassment or bullying"
  | "Inappropriate or offensive"
  | "Other";

export const REPORT_REASONS: ReportReason[] = [
  "Spam or scam",
  "Harassment or bullying",
  "Inappropriate or offensive",
  "Other",
];

/** A logged report — either of a whole person or a single message. */
export type Report = {
  id: string;
  kind: "user" | "message";
  /** The reported person's contact id (the message author for message reports). */
  contactId: string;
  contactName: string;
  reason: ReportReason;
  /** Present for message reports. */
  messageId?: string;
  messageText?: string;
  createdAtISO: string;
};

/** A person you can message: clients/coaches for a trainer, trainers for a gym user. */
export type ChatContact = {
  id: string;
  name: string;
  initials: string;
  subtitle?: string;
  /** Profile photo URL (real connected accounts); initials fallback when absent. */
  photoUri?: string;
};

// 2-colour blend for SENT bubbles — on-brand teal → aqua. Close hues give a
// smooth, gradual transition (no hard line), rendered top-left → bottom-right
// with white text. (Tuple so it satisfies expo-linear-gradient's `colors` type.)
export const SENT_BUBBLE_GRADIENT = ["#1DECA0", "#19DCC4"] as const;
