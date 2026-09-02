-- Temporarily hold an active program.
--
-- Distinct from the existing status = 'paused', which means "shelved mid-run,
-- no longer the active program" (what Make Inactive produces). A hold keeps the
-- program active and in its slot; it just stops scheduling workouts and freezes
-- the week counter until it's resumed.
--
-- Stored as the "YYYY-MM-DD" the hold began, matching how start_date and
-- completed_date are already kept as text rather than dates. Resuming shifts
-- start_date forward by the elapsed days, which both preserves the remaining
-- weeks and lands the cycle back on the day it was paused (see
-- utils/programPause.ts); null means running.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (one nullable column, no backfill).

alter table public.programs
  add column if not exists paused_at text;

comment on column public.programs.paused_at is
  'Date an ACTIVE program was put on hold (YYYY-MM-DD), or null. Unrelated to status = ''paused'', which means the program is not active at all.';
