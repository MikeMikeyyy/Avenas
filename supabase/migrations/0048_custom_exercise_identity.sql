-- A custom exercise keeps its own id, and a deleted one stays, hidden.
--
-- Deleting a custom exercise used to take it out of the list and nothing
-- else: it stayed in programs, and a new exercise later given its name took
-- over the old one's history, "last time" numbers, chart and records, since
-- everything went by name. Now (user request, 2026-10-15) one made from now on
-- has an id (`CustomExercise.id`), recorded on every program day and logged
-- session that uses it, so a new one of the same name is a new exercise. A
-- deleted one stays in the list, hidden (`CustomExercise.deletedAt`), because
-- its sessions are still read with it (its muscles on the radar, its steps),
-- while it leaves every program and frees its slot.
--
-- Both need columns for the backup, a restore and a trainer's read of a client
-- to carry them (get_client_training reads whole rows, so it needs no change).
-- Without `local_id` a restore gave every exercise back without its id, and its
-- next sessions would have started a history apart from its last ones; without
-- `deleted_at` a deleted exercise came back as one you can pick. Null on every
-- older row: an exercise made before ids is known by its name, as before.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.
-- Requires 0047 (whose replace_user_data this recreates with two more columns).
-- Until it's applied the app still backs up (the old function ignores the new
-- keys), but a restore brings deleted exercises back and drops the ids.

alter table public.custom_exercises
  add column if not exists local_id text,
  add column if not exists deleted_at date;

comment on column public.custom_exercises.local_id is
  'The exercise''s own id on the phone (CustomExercise.id), which program days and sessions record as customId. Null for one made before ids, which is known by its name.';
comment on column public.custom_exercises.deleted_at is
  'The day it was deleted (CustomExercise.deletedAt): hidden from the picker and out of every program, kept for the sessions logged with it. Null while it''s live.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The backup carries them. Body unchanged from 0047 but for `local_id` and
-- `deleted_at` on custom exercises.
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
    duration_seconds, exercises, session_notes, plan
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
    case when jsonb_typeof(w.elem->'plan') = 'array' then w.elem->'plan' end
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
