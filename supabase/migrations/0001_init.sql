-- Avenas — Phase 1 (single-user) schema.
-- Maps the synced AsyncStorage keys (see CLAUDE.md / supabase/schema-design.md)
-- onto Postgres with owner-only RLS. Nested workout/program data is stored as
-- jsonb to match the existing TS shapes 1:1. Trainer mode is Phase 2.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles  (one row per auth user)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  name                text,
  email               text,
  account_type        text    not null default 'user' check (account_type in ('user','pt')),
  unit                text    not null default 'kg'    check (unit in ('kg','lb')),
  theme               text    not null default 'system',
  flame_preference    text,
  streak              jsonb   not null default '{}'::jsonb,  -- { current, longest, lastActive }
  onboarding_complete boolean not null default false,
  terms_accepted      integer,                               -- accepted TERMS_VERSION
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Auto-create a profile when a new auth user is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- programs  (@avenas/programs — SavedProgram[])
-- ─────────────────────────────────────────────────────────────────────────────
create table public.programs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid    not null references auth.users(id) on delete cascade,
  name           text    not null,
  total_weeks    integer not null,
  current_week   integer not null default 0,
  status         text    not null check (status in ('active','completed','paused','created')),
  start_date     date,                 -- parsed from "DD Mon YYYY"; null when unset
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

-- The "at most one active program per user" invariant (CLAUDE.md).
create unique index programs_one_active_per_user
  on public.programs (user_id) where (status = 'active');
create index programs_user on public.programs (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- workouts  (@avenas/workout_history — CompletedWorkout[]; workout_dates derived)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.workouts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid    not null references auth.users(id) on delete cascade,
  program_id       uuid    references public.programs(id) on delete set null,  -- null = free workout
  date             date    not null,
  completed_at     timestamptz not null,
  workout_name     text    not null,
  duration_seconds integer not null default 0,
  exercises        jsonb   not null default '[]'::jsonb,  -- CompletedExercise[]
  session_notes    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index workouts_user_completed on public.workouts (user_id, completed_at desc);
create index workouts_user_date      on public.workouts (user_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- journal_entries  (@avenas_journal_entries — JournalEntry[])
-- ─────────────────────────────────────────────────────────────────────────────
create table public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default '',
  body       text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index journal_user_created on public.journal_entries (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- custom_exercises  (live key TBD: "@avenas_custom_exercises" vs "@avenas/custom_exercises")
-- ─────────────────────────────────────────────────────────────────────────────
create table public.custom_exercises (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  muscles     text[] not null default '{}',
  image_uri   text,
  video_uri   text,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index custom_ex_user on public.custom_exercises (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function public.set_updated_at();
create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();
create trigger journal_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();
create trigger custom_ex_set_updated_at
  before update on public.custom_exercises
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — owner-only (Phase 1)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.programs         enable row level security;
alter table public.workouts         enable row level security;
alter table public.journal_entries  enable row level security;
alter table public.custom_exercises enable row level security;

create policy profiles_self on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy programs_owner on public.programs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy workouts_owner on public.workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy journal_owner on public.journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy custom_ex_owner on public.custom_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
