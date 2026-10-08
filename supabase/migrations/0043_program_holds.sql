-- A program's holds, kept: the program page reads its past through them.
--
-- Resuming a hold (utils/programPause.ts resumeProgram) moves the program's
-- start date forward by the days held, so the cycle and the finish date carry
-- on from where the hold began. That re-dates every day before the hold, and
-- the program page the Journal opens took the run's first day from start_date:
-- after a holiday, every session before it fell off the page, and the hold's
-- own days showed as missed. programs.holds keeps each hold the run came back
-- from, oldest first, as {from, to, shift, offsetShift} (dates "YYYY-MM-DD",
-- the days start_date and cycle_offset moved), so a past date can be read as
-- it was (utils/programHolds.ts). Found by scripts/verify-training-months.ts.
--
-- Rides the backup, so replace_user_data is recreated below with the column in
-- its list (see 0023, 0032, 0037: a column missing from that list is silently
-- blanked by every backup). get_client_training returns whole rows (to_jsonb),
-- so a trainer's read of a client's programs carries it with no change.
--
-- Apply with `supabase db push` or paste into the SQL editor, AFTER 0042.
-- Idempotent and non-destructive (one nullable column, one replaced function).
-- Apply it BEFORE shipping the build that uses it: that build's backups send
-- holds, which an older replace_user_data drops.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.programs
  add column if not exists holds jsonb;

comment on column public.programs.holds is
  'Holds this run of the program came back from, oldest first: [{from, to, shift, offsetShift}]. Resuming moves start_date (and for "Today" cycle_offset) on by the days held; these let a past date be read as it was. Null = none.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The backup carries a program's holds
--
--    Body unchanged from 0037 but for the one column.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_user_data(
  p_programs jsonb default '[]'::jsonb,
  p_workouts jsonb default '[]'::jsonb,
  p_journal  jsonb default '[]'::jsonb,
  p_custom   jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'replace_user_data: not authenticated';
  end if;

  delete from public.workouts        where user_id = v_uid;
  delete from public.programs        where user_id = v_uid;
  delete from public.journal_entries where user_id = v_uid;
  delete from public.custom_exercises where user_id = v_uid;

  with prog_input as materialized (
    select
      ord,
      gen_random_uuid() as new_id,
      elem
    from jsonb_array_elements(p_programs) with ordinality as t(elem, ord)
  ),
  ins_prog as (
    insert into public.programs (
      id, user_id, name, total_weeks, current_week, status,
      start_date, completed_date, cycle_offset, paused_at, archived_at, training_days, cycle_days,
      cycle_pattern, day_ids, skipped_dates, pushed_dates, pulled_dates, holds,
      workouts, extra_workouts
    )
    select
      pi.new_id,
      v_uid,
      pi.elem->>'name',
      (pi.elem->>'total_weeks')::integer,
      coalesce((pi.elem->>'current_week')::integer, 0),
      pi.elem->>'status',
      nullif(pi.elem->>'start_date', '')::date,
      nullif(pi.elem->>'completed_date', '')::date,
      nullif(pi.elem->>'cycle_offset', '')::integer,
      nullif(pi.elem->>'paused_at', ''),
      -- Absent from an older app's backup: not archived, which is what every
      -- program was before this column.
      nullif(pi.elem->>'archived_at', '')::date,
      (pi.elem->>'training_days')::integer,
      (pi.elem->>'cycle_days')::integer,
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'cycle_pattern') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'day_ids') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'skipped_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pushed_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pulled_dates') as x), '{}'),
      -- A list, or nothing: absent from an older app's backup (no holds kept),
      -- and a JSON null or an empty list both mean none.
      case when jsonb_typeof(pi.elem->'holds') = 'array' and jsonb_array_length(pi.elem->'holds') > 0
        then pi.elem->'holds' end,
      coalesce(pi.elem->'workouts', '{}'::jsonb),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'extra_workouts') as x), '{}')
    from prog_input pi
    returning id
  )
  insert into public.workouts (
    id, user_id, program_id, program_unknown, date, completed_at, workout_name, day_id,
    duration_seconds, exercises, session_notes
  )
  select
    gen_random_uuid(),
    v_uid,
    (select pi.new_id from prog_input pi
       where pi.ord = (w.elem->>'program_index')::integer + 1),
    -- Absent from an older app's backup, which is exactly "not known to be
    -- legacy": the free-workout reading every row had before this column.
    coalesce((w.elem->>'program_unknown')::boolean, false),
    (w.elem->>'date')::date,
    (w.elem->>'completed_at')::timestamptz,
    w.elem->>'workout_name',
    w.elem->>'day_id',
    coalesce((w.elem->>'duration_seconds')::integer, 0),
    coalesce(w.elem->'exercises', '[]'::jsonb),
    w.elem->>'session_notes'
  from jsonb_array_elements(p_workouts) as w(elem);

  insert into public.journal_entries (id, user_id, title, body, created_at)
  select
    gen_random_uuid(),
    v_uid,
    coalesce(j.elem->>'title', ''),
    coalesce(j.elem->>'body', ''),
    (j.elem->>'created_at')::timestamptz
  from jsonb_array_elements(p_journal) as j(elem);

  insert into public.custom_exercises (
    id, user_id, name, muscles, image_uri, video_uri, description, steps, muted
  )
  select
    gen_random_uuid(),
    v_uid,
    c.elem->>'name',
    coalesce((select array_agg(x) from jsonb_array_elements_text(c.elem->'muscles') as x), '{}'),
    c.elem->>'image_uri',
    c.elem->>'video_uri',
    c.elem->>'description',
    -- A JSON null raises in jsonb_array_elements_text() (see 0032).
    (select array_agg(x) from jsonb_array_elements_text(
      case when jsonb_typeof(c.elem->'steps') = 'array' then c.elem->'steps' end
    ) as x),
    coalesce((c.elem->>'muted')::boolean, false)
  from jsonb_array_elements(p_custom) as c(elem);
end;
$$;
grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Make the API see the new function straight away (see 0028's note).
notify pgrst, 'reload schema';
