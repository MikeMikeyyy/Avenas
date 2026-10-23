-- A session keeps the name of the program it was logged under once that
-- program is deleted.
--
-- Deleting a program used to leave its sessions with nothing to say whose they
-- were: the Journal kept them and Progress's Custom workouts lists them, but a
-- program's name lived only on the program. Now (user request, 2026-10-23) the
-- app puts the name on each of its sessions as it deletes the program
-- (CompletedWorkout.programName, utils/programDelete.ts). It needs a column for
-- the backup, a restore and a trainer's read of a client to carry it
-- (get_client_training reads whole rows, so it needs no change). It matters
-- most after a restore: a backup can't point a session at a program it doesn't
-- have, so the session comes back with no program at all, and this is all
-- that's left of where it was logged. Null on every other row.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.
-- Requires 0048 (whose replace_user_data this recreates with one more column).
-- Until it's applied the app still backs up (the old function ignores the new
-- key), but a deleted program's name doesn't reach the backup.

alter table public.workouts
  add column if not exists program_name text;

comment on column public.workouts.program_name is
  'The name of the deleted program this session was logged under (CompletedWorkout.programName), kept as the program was deleted. Null while its program exists, and on free workouts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The backup carries it. Body unchanged from 0048 but for `program_name` on
-- workouts.
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
      id, user_id, local_id, share_origin, name, total_weeks, current_week, status,
      start_date, completed_date, cycle_offset, paused_at, archived_at, training_days, cycle_days,
      cycle_pattern, day_ids, skipped_dates, pushed_dates, pulled_dates, holds, runs,
      workouts, extra_workouts
    )
    select
      pi.new_id,
      v_uid,
      nullif(pi.elem->>'local_id', ''),
      nullif(pi.elem->>'share_origin', ''),
      pi.elem->>'name',
      (pi.elem->>'total_weeks')::integer,
      coalesce((pi.elem->>'current_week')::integer, 0),
      pi.elem->>'status',
      nullif(pi.elem->>'start_date', '')::date,
      nullif(pi.elem->>'completed_date', '')::date,
      nullif(pi.elem->>'cycle_offset', '')::integer,
      nullif(pi.elem->>'paused_at', ''),
      nullif(pi.elem->>'archived_at', '')::date,
      (pi.elem->>'training_days')::integer,
      (pi.elem->>'cycle_days')::integer,
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'cycle_pattern') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'day_ids') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'skipped_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pushed_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pulled_dates') as x), '{}'),
      case when jsonb_typeof(pi.elem->'holds') = 'array' and jsonb_array_length(pi.elem->'holds') > 0
        then pi.elem->'holds' end,
      -- A list, or nothing: absent from an older app's backup, and a JSON null
      -- means none.
      case when jsonb_typeof(pi.elem->'runs') = 'array' and jsonb_array_length(pi.elem->'runs') > 0
        then pi.elem->'runs' end,
      coalesce(pi.elem->'workouts', '{}'::jsonb),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'extra_workouts') as x), '{}')
    from prog_input pi
    returning id
  )
  insert into public.workouts (
    id, user_id, program_id, program_unknown, date, completed_at, workout_name, day_id,
    duration_seconds, exercises, session_notes, plan, program_name
  )
  select
    gen_random_uuid(),
    v_uid,
    (select pi.new_id from prog_input pi
       where pi.ord = (w.elem->>'program_index')::integer + 1),
    coalesce((w.elem->>'program_unknown')::boolean, false),
    (w.elem->>'date')::date,
    (w.elem->>'completed_at')::timestamptz,
    w.elem->>'workout_name',
    w.elem->>'day_id',
    coalesce((w.elem->>'duration_seconds')::integer, 0),
    coalesce(w.elem->'exercises', '[]'::jsonb),
    w.elem->>'session_notes',
    -- A list, or nothing: absent from an older app's backup, and a JSON null
    -- means none.
    case when jsonb_typeof(w.elem->'plan') = 'array' then w.elem->'plan' end,
    nullif(w.elem->>'program_name', '')
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
    id, user_id, local_id, name, muscles, image_uri, video_uri, description, steps, muted, deleted_at
  )
  select
    gen_random_uuid(),
    v_uid,
    nullif(c.elem->>'local_id', ''),
    c.elem->>'name',
    coalesce((select array_agg(x) from jsonb_array_elements_text(c.elem->'muscles') as x), '{}'),
    c.elem->>'image_uri',
    c.elem->>'video_uri',
    c.elem->>'description',
    (select array_agg(x) from jsonb_array_elements_text(
      case when jsonb_typeof(c.elem->'steps') = 'array' then c.elem->'steps' end
    ) as x),
    coalesce((c.elem->>'muted')::boolean, false),
    nullif(c.elem->>'deleted_at', '')::date
  from jsonb_array_elements(p_custom) as c(elem);
end;
$$;
grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
