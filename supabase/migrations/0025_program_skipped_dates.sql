-- Dates the user has marked as rest, overriding the cycle.
--
-- Two columns, because "I'm not training today" means one of two things:
--   skipped_dates — the date schedules nothing; the cycle keeps its alignment.
--   pushed_dates  — the date schedules nothing AND the cycle waits a day here,
--                   so every LATER date resolves one cycle-day earlier.
--
-- pushed_dates is always a subset of skipped_dates. It is a list of dates and
-- not a single offset on purpose: an offset is a phase shift over the whole
-- timeline, so pushing one day also re-labels days before it and can swallow a
-- workout the user already completed. Dates keep the past fixed, and make undo
-- a removal rather than a second compensating shift.
--
-- Stored on the program rather than in their own table: small bounded lists
-- only ever read alongside the program, so the existing snapshot push/pull
-- carries them with no new query.
--
-- Empty arrays (not null) for existing rows, which is also exactly what
-- "nothing marked" looks like, so a pre-migration program needs no special
-- handling. See SavedProgram.skippedDates / .pushedDates.
--
-- Safe to run more than once.

alter table public.programs
  add column if not exists skipped_dates text[] not null default '{}'::text[];

alter table public.programs
  add column if not exists pushed_dates text[] not null default '{}'::text[];

comment on column public.programs.skipped_dates is
  'Dates ("YYYY-MM-DD") marked as rest, overriding the cycle.';

comment on column public.programs.pushed_dates is
  'Subset of skipped_dates that also delays the cycle by a day from that date onward.';
