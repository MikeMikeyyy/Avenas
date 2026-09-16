-- Rest days the user SPENT to bring the schedule forward.
--
-- The mirror of pushed_dates (0025). A push delays everything after it, which
-- makes the program a day longer; a pull deletes the rest day it sits on, so
-- everything from that date resolves one cycle-day LATER and the program comes
-- back to its original length.
--
-- That pairing is the point. Push Tuesday because you're ill, pull a rest day
-- later the same week, and the following week starts on the day you originally
-- planned — the disruption stays inside the week it happened in instead of
-- shifting every week after it.
--
-- NOT a subset of skipped_dates, unlike pushed_dates: a pulled date still
-- schedules something, namely whatever the next day was going to hold. The
-- three lists are kept mutually disjoint by normalizeDriftDates
-- (utils/workout.ts), which every path that persists a program runs.
--
-- Only ever recorded against a date the cycle rests on. That invariant is
-- enforced on write rather than on read: making the READER check it would make
-- the cycle index depend on cycle_pattern and cycle_offset, which breaks the
-- algebraic solve in app/programs.tsx:handleSetWorkoutDay (measured at 4 of 6
-- target days landing on the wrong date).
--
-- Empty array (not null) for existing rows, which is also exactly what "nothing
-- spent" looks like, so a pre-migration program needs no special handling.
-- See SavedProgram.pulledDates.
--
-- Safe to run more than once.

alter table public.programs
  add column if not exists pulled_dates text[] not null default '{}'::text[];

comment on column public.programs.pulled_dates is
  'Rest days spent to bring the schedule forward a day. Mirror of pushed_dates.';
