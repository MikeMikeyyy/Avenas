# Avenas — Supabase Backend: Schema Design (v1)

Status: **design / not yet applied**. This maps the existing AsyncStorage data
contract (see `CLAUDE.md`) onto Postgres + Row Level Security. It exists so we
agree on the model before writing the migration and wiring auth/sync.

## Recommended foundational decisions

These shape everything below. Each has a recommended default; override before we build.

1. **Auth: email/password (+ magic link).** Pure-JS, so you keep developing in
   Expo Go, and you already have signup/onboarding UI. Apple/Google Sign-In need
   a dev build — add later. A DB trigger creates a `profiles` row per new user.
2. **Sync: online-first with an AsyncStorage cache.** Reads hydrate from Supabase
   and cache locally; writes go to Supabase then update the cache. Simpler than
   full offline-first conflict resolution, still usable when the network blips.
   (True offline-first with a sync queue is a later upgrade.)
3. **Nested data as `jsonb`.** `programs.workouts` and `workouts.exercises` stay
   as JSON, matching the current TS shapes 1:1. The app already computes previous
   values / progress client-side over downloaded history, so we don't need a
   normalized sets table yet. (Alternative: fully normalized `workout_exercises`
   / `workout_sets` tables — better for server-side analytics, much bigger lift.)
4. **Trainer mode is Phase 2.** Ship single-user sync first (profiles, programs,
   workouts, journal, custom exercises). The real multi-user trainer/coach graph
   replaces the local mock and is designed separately (outline at the bottom).

## What stays device-local (never synced)

In-progress, device-specific state — keep in AsyncStorage:
`@avenas/workout_draft`, `@avenas/log_draft:*`, `@avenas/new_program_draft`,
`@avenas/workout_timer_start`, `@avenas/today_workout_override`.

## ID strategy

Local ids are strings like `program_1717…`. New tables use `uuid` PKs. On first
sync the migration inserts local rows and rewrites local ids to the returned
uuids (kept in a local id-map until confirmed). `workout_dates` is **derived**
(`select distinct date`) — no table.

---

## Core tables (Phase 1)

```sql
-- Every authenticated user has exactly one profile row.
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  name                 text,
  email                text,
  account_type         text not null default 'user' check (account_type in ('user','pt')),
  unit                 text not null default 'kg'   check (unit in ('kg','lb')),
  theme                text not null default 'system',
  flame_preference     text,
  streak               jsonb not null default '{}'::jsonb,  -- { current, longest, lastActive }
  onboarding_complete  boolean not null default false,
  terms_accepted       integer,                              -- accepted TERMS_VERSION
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- SavedProgram[]  (@avenas/programs)
create table public.programs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  total_weeks    integer not null,
  current_week   integer not null default 0,
  status         text not null check (status in ('active','completed','paused','created')),
  start_date     date,                 -- parsed from "DD Mon YYYY"; null if unset
  completed_date date,
  cycle_offset   integer,
  training_days  integer not null,
  cycle_days     integer not null,
  cycle_pattern  text[]  not null default '{}',
  workouts       jsonb   not null default '{}'::jsonb,  -- WorkoutMap: { "0:Push": Exercise[] }
  extra_workouts text[]  not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- "At most one active program per user" (the invariant from CLAUDE.md):
create unique index programs_one_active_per_user
  on public.programs (user_id) where (status = 'active');

-- CompletedWorkout[]  (@avenas/workout_history, newest-first)
create table public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  program_id      uuid references public.programs(id) on delete set null,  -- null = free workout
  date            date not null,
  completed_at    timestamptz not null,
  workout_name    text not null,
  duration_seconds integer not null default 0,
  exercises       jsonb not null default '[]'::jsonb,  -- CompletedExercise[]
  session_notes   text,
  created_at      timestamptz not null default now()
);
create index workouts_user_completed on public.workouts (user_id, completed_at desc);
create index workouts_user_date      on public.workouts (user_id, date);

-- JournalEntry[]  (@avenas_journal_entries)
create table public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '',
  body       text not null default '',
  created_at timestamptz not null
);
create index journal_user_created on public.journal_entries (user_id, created_at desc);

-- CustomExercise[]  (live key: confirm "@avenas_custom_exercises" vs "@avenas/custom_exercises")
create table public.custom_exercises (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  muscles     text[] not null default '{}',
  image_uri   text,
  video_uri   text,
  description text,
  created_at  timestamptz not null default now()
);
```

## Row Level Security (owner-only, Phase 1)

```sql
alter table public.profiles         enable row level security;
alter table public.programs         enable row level security;
alter table public.workouts         enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.custom_exercises enable row level security;

-- profiles: a user sees/edits only their own row
create policy profiles_self on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- owner-only template applied to each user-owned table:
create policy programs_owner on public.programs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy workouts_owner on public.workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy journal_owner on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy custom_ex_owner on public.custom_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

```sql
-- Auto-create a profile when a new auth user signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

(An `updated_at` BEFORE-UPDATE trigger on the mutable tables will be added with the migration.)

---

## Phase 2 — trainer / coach graph (outline only)

The current trainer feature is a local single-device mock (`utils/trainerStore.ts`,
`utils/mockClientSeed.ts`). The real model makes trainers and clients both
`profiles` linked by relationships, which also drives cross-user RLS:

- `connections` — `(trainer_id, member_id, status)`; covers PT→client, and the
  symmetric trainer↔trainer link (the connected trainer also appears as a client).
- `program_shares` — a program sent from one user to another (snapshot in `jsonb`,
  `accepted_at`, `received_from_coach` flag we just added locally).
- `program_reviews` — a client sends a program to their trainer, returned with edits.
- `messages` / `message_threads` — trainer ↔ client chat.
- Moderation: `blocks`, `reports` (Apple UGC compliance — already gated client-side).

Cross-user RLS example: a trainer may `select` a client's `workouts`/`programs`
only when an **accepted** `connections` row exists. These policies are the main
new complexity and are designed once Phase 1 is live.

## Open questions for the migration/sync step

- Confirm the four foundational decisions above (auth, sync, jsonb, trainer phasing).
- Resolve the `custom_exercises` storage-key mismatch so we migrate the right data.
- Your Supabase **project URL + anon key** (and whether the project exists yet).

## What I can do without any of that
Write the migration SQL file (`supabase/migrations/0001_init.sql`) for Phase 1
exactly as above, plus a typed Supabase client + a thin data-access layer that
mirrors the current `utils/storage.ts` API so screens change as little as possible.
