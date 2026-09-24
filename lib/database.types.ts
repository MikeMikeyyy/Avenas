// Row shapes for the Phase 1 tables, hand-written to match
// supabase/migrations/0001_init.sql. If the schema changes, regenerate with
// `supabase gen types typescript --project-id <ref>` and reconcile.
//
// `*Insert` = the payload we send on create (id + created_at/updated_at are
// database-managed and omitted).

export type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  /** Where the user wants to be reached, when that differs from the login
   *  identifier — set by Apple "Hide My Email" accounts, whose auth email is an
   *  unreachable relay address (migration 0017). Null when unset. */
  contact_email: string | null;
  account_type: "user" | "pt";
  unit: "kg" | "lb";
  theme: string;
  avatar_url: string | null;
  connect_code: string | null;
  last_active_at: string | null;
  /** Whether connections may see last_active_at (migration 0009). When false,
   *  get_my_connections returns this account's last_active_at as NULL. */
  share_activity: boolean;
  flame_preference: string | null;
  streak: Record<string, unknown>;
  onboarding_complete: boolean;
  terms_accepted: number | null;
  created_at: string;
  updated_at: string;
};

// ── connections (account-to-account; migration 0006) ──────────────────────────
export type ConnectionRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  responded_at: string | null;
};

// Row shape returned by the get_my_connections() RPC — the counterpart's SAFE
// profile fields plus the relationship direction (see 0006).
export type ConnectionWithProfile = {
  connection_id: string;
  other_id: string;
  name: string | null;
  avatar_url: string | null;
  account_type: "user" | "pt";
  last_active_at: string | null;
  status: "pending" | "accepted" | "declined";
  direction: "accepted" | "incoming" | "outgoing";
};

// ── chat (account-to-account messages; migration 0011) ────────────────────────
export type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  /** Empty once deleted (migration 0031). */
  body: string;
  created_at: string;
  /** The sender deleted it (migration 0031, via delete_message). Null = live.
   *  Optional because a row from before 0031 is applied has no such column. */
  deleted_at?: string | null;
};

/** Per-peer "last read" stamp for the caller — drives the unread badges. */
export type ChatReadRow = {
  user_id: string;
  peer_id: string;
  last_read_at: string;
};

// ── groups + group chat (migration 0016) ──────────────────────────────────────
export type GroupRow = {
  id: string;
  owner_id: string;
  name: string;
  /** Public URL of the group photo (migration 0030). Null = no photo; screens
   *  fall back to the people icon. Owner-writable, like the name. */
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupMemberRow = {
  group_id: string;
  user_id: string;
  added_at: string;
  /** Owner-only writable (migration 0022). The OWNER is not represented here —
   *  they're groups.owner_id. */
  role: "member" | "trainer";
  /** When the invitee accepted (migration 0027). Null means invited but not yet
   *  in the group: is_group_member() returns false for them, so they're out of
   *  the thread, the roster and the read stamps until they answer. */
  accepted_at: string | null;
};

export type GroupMessageRow = {
  id: string;
  group_id: string;
  sender_id: string;
  /** Empty once deleted (migration 0031). */
  body: string;
  created_at: string;
  /** The sender deleted it (migration 0031, via delete_group_message). */
  deleted_at?: string | null;
};

/** Per-group "last read" stamp for the caller — drives the group unread badge. */
export type GroupReadRow = {
  user_id: string;
  group_id: string;
  last_read_at: string;
};

/** Row shape returned by get_group_members() — SAFE display fields only. Group
 *  members are generally not connected to each other, so this RPC is the only
 *  way they can resolve one another's name + photo. */
export type GroupMemberWithProfile = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  is_owner: boolean;
  role: "member" | "trainer";
  /** False while an invite is outstanding (migration 0027). Pending members are
   *  still listed: the owner needs to see who hasn't answered, and a group
   *  program send reads this roster — it goes to everyone invited. */
  accepted: boolean;
};

/** Row shape returned by get_my_group_invites() — the ONLY thing a pending
 *  invitee can read about a group they haven't joined, and exactly what the
 *  invite card renders (migration 0027). */
export type GroupInviteRow = {
  group_id: string;
  name: string;
  /** The group's photo (migration 0030) — the invite card shows the group, so
   *  it travels with the rest of what an invitee may know about it. */
  avatar_url: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_avatar: string | null;
  /** Accepted members only, so the card doesn't count other pending invitees. */
  member_count: number;
  invited_at: string;
};

export type ProgramRow = {
  id: string;
  user_id: string;
  name: string;
  total_weeks: number;
  current_week: number;
  status: "active" | "completed" | "paused" | "created";
  start_date: string | null;      // YYYY-MM-DD
  completed_date: string | null;  // YYYY-MM-DD
  cycle_offset: number | null;
  /** Date an ACTIVE program was put on hold ("YYYY-MM-DD"), or null when
   *  running. Unrelated to status = 'paused', which means not active at all
   *  (migration 0019). */
  paused_at: string | null;
  training_days: number;
  cycle_days: number;
  cycle_pattern: string[];
  /** Stable per-slot ids, parallel to cycle_pattern (migration 0023). Empty for
   *  a program written before the column existed; the client's positional
   *  fallback covers those. See SavedProgram.dayIds. */
  day_ids: string[];
  /** Dates ("YYYY-MM-DD") marked as rest, overriding the cycle (migration
   *  0025). Empty for a program written before the column existed, which is
   *  also what "nothing skipped" looks like. See SavedProgram.skippedDates. */
  skipped_dates: string[];
  /** The subset of skipped_dates that also delays the cycle by a day from that
   *  date onward (migration 0025). See SavedProgram.pushedDates. */
  pushed_dates: string[];
  /** Rest days spent to bring the schedule forward a day — the mirror of
   *  pushed_dates, and how a push is paid back (migration 0029). Not a subset
   *  of skipped_dates: a pulled date still schedules something. Empty for a
   *  program written before the column existed, which is also what "nothing
   *  spent" looks like. See SavedProgram.pulledDates. */
  pulled_dates: string[];
  workouts: Record<string, unknown>;  // WorkoutMap — Exercise[] per "idx:Name" key
  extra_workouts: string[];
  created_at: string;
  updated_at: string;
};

export type WorkoutRow = {
  id: string;
  user_id: string;
  program_id: string | null;      // program uuid, or null for a free workout
  /** With program_id null: true for a LEGACY record (programId absent, the
   *  program is inferred from day name + dates), false for a free workout
   *  (programId ""). The cloud stored those identically before migration 0033.
   *  See CompletedWorkout.programId. */
  program_unknown: boolean;
  date: string;                   // YYYY-MM-DD
  completed_at: string;           // ISO timestamp
  workout_name: string;
  /** Which cycle slot of program_id this session was performed on (migration
   *  0023). Null for a free workout and for records logged before the column
   *  existed. See CompletedWorkout.dayId. */
  day_id: string | null;
  duration_seconds: number;
  exercises: unknown[];           // CompletedExercise[]
  session_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;             // ISO timestamp
  updated_at: string;
};

export type CustomExerciseRow = {
  id: string;
  user_id: string;
  name: string;
  muscles: string[];
  image_uri: string | null;
  video_uri: string | null;
  description: string | null;
  steps: string[] | null;
  muted: boolean;
  created_at: string;
  updated_at: string;
};

// ── shared programs (cross-account sharing; migration 0013) ───────────────────
export type SharedProgramRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  kind: "share" | "review";
  /** The sender's local @avenas/programs id — round-trips so batch grouping
   *  (programId|sentAtISO) and review apply-in-place keep working. */
  sender_program_id: string;
  program_name: string;
  snapshot: Record<string, unknown>;          // SavedProgram (canonical kg)
  sent_key: string;                           // sender's client-side sentAtISO
  /** Group this share was sent to, or null for a direct send (migration 0026).
   *  A group send writes one row per member; this is what ties them together.
   *  Nulled rather than cascaded when a group is deleted — the shares stay
   *  valid, they just stop being attributed. See SharedProgram.groupId. */
  group_id: string | null;
  sent_at: string;
  last_edited_at: string | null;
  accepted_at: string | null;
  deleted_by_recipient_at: string | null;
  returned_at: string | null;
  trainer_comments: string | null;
  returned_snapshot: Record<string, unknown> | null;
  /** A group coach marked this review dealt with (migration 0028). Null = still
   *  in the group's queue. Only meaningful with a group_id; written through the
   *  set_group_review_completed RPC, never as a column patch, so the sender
   *  can't close their own review. */
  completed_at: string | null;
};

// ── push tokens (server-sent notifications; migration 0012) ───────────────────
// Written only through the register_push_token RPC (see lib/push.ts); the row
// shape here is for reads/deletes.
export type PushTokenRow = {
  user_id: string;
  token: string;
  platform: string;
  /** Effective push-category switches, e.g. { coachMessages: boolean }. A
   *  missing key counts as enabled server-side. */
  categories: Record<string, boolean>;
  updated_at: string;
};

type Insert<T> = Omit<T, "id" | "created_at" | "updated_at">;

export type ProgramInsert = Insert<ProgramRow>;
export type WorkoutInsert = Insert<WorkoutRow>;
// Journal keeps created_at — it's the entry's real creation time (app data), not
// a DB-managed timestamp.
export type JournalInsert = Omit<JournalRow, "id" | "updated_at">;
export type CustomExerciseInsert = Insert<CustomExerciseRow>;
