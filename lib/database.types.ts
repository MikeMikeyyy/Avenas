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
  account_type: "user" | "pt";
  unit: "kg" | "lb";
  theme: string;
  avatar_url: string | null;
  connect_code: string | null;
  last_active_at: string | null;
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
  training_days: number;
  cycle_days: number;
  cycle_pattern: string[];
  workouts: Record<string, unknown>;  // WorkoutMap — Exercise[] per "idx:Name" key
  extra_workouts: string[];
  created_at: string;
  updated_at: string;
};

export type WorkoutRow = {
  id: string;
  user_id: string;
  program_id: string | null;      // program uuid, or null for a free workout
  date: string;                   // YYYY-MM-DD
  completed_at: string;           // ISO timestamp
  workout_name: string;
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

type Insert<T> = Omit<T, "id" | "created_at" | "updated_at">;

export type ProgramInsert = Insert<ProgramRow>;
export type WorkoutInsert = Insert<WorkoutRow>;
// Journal keeps created_at — it's the entry's real creation time (app data), not
// a DB-managed timestamp.
export type JournalInsert = Omit<JournalRow, "id" | "updated_at">;
export type CustomExerciseInsert = Insert<CustomExerciseRow>;
