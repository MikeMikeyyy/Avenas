-- A custom exercise can be assisted: its weight is help, not load (a
-- machine-assisted pull-up or dip), so less is harder and less is its record
-- (utils/assisted.ts; user request, 2026-11-07). Create Exercise's Assisted
-- switch (CustomExercise.assisted).
--
--   custom_exercises.assisted   the switch. Read back by get_my_backup and
--                               get_client_training as they are (to_jsonb of
--                               the row); written by replace_user_data, which
--                               lists its columns, so it's recreated here.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.
-- Requires 0057 (whose replace_user_data this recreates, with the one column
-- more). Until it's applied, a backup carrying the switch still lands (the
-- function ignores what it doesn't list) and a restore reads it as off.

alter table public.custom_exercises
  add column if not exists assisted boolean not null default false;

comment on column public.custom_exercises.assisted is
  'Its weight is help, not load (CustomExercise.assisted): less is harder, so less is its record (utils/assisted.ts).';

-- ─────────────────────────────────────────────────────────────────────────────
-- The backup, writing the switch (otherwise as 0057)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_user_data(
  p_programs     jsonb default '[]'::jsonb,
  p_workouts     jsonb default '[]'::jsonb,
  p_journal      jsonb default '[]'::jsonb,
  p_custom       jsonb default '[]'::jsonb,
  p_base_version bigint default null,
  p_device       text default null,
  p_deleted      jsonb default null,
  p_changed_at   timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_version bigint;
begin
  if v_uid is null then
    raise exception 'replace_user_data: not authenticated';
  end if;

  -- One backup at a time per account: a second waits here for the first to
  -- commit, then sees the version it moved on.
  insert into public.backup_state (user_id) values (v_uid) on conflict (user_id) do nothing;
  select version into v_version from public.backup_state where user_id = v_uid for update;

  if p_base_version is not null and p_base_version <> v_version then
    raise exception 'replace_user_data: stale backup (at %, sent from %)', v_version, p_base_version
      using errcode = 'PT409';
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
      workouts, extra_workouts, created_at
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
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'extra_workouts') as x), '{}'),
      -- In the phone's order, so a restore reads them back in it.
      now() + pi.ord * interval '1 microsecond'
    from prog_input pi
    returning id
  )
  insert into public.workouts (
    id, user_id, local_id, program_id, program_unknown, date, completed_at, workout_name, day_id,
    duration_seconds, exercises, session_notes, plan, program_name
  )
  select
    gen_random_uuid(),
    v_uid,
    nullif(w.elem->>'local_id', ''),
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
    case when jsonb_typeof(w.elem->'plan') = 'array' then w.elem->'plan' end,
    nullif(w.elem->>'program_name', '')
  from jsonb_array_elements(p_workouts) as w(elem);

  insert into public.journal_entries (id, user_id, local_id, title, body, created_at)
  select
    gen_random_uuid(),
    v_uid,
    nullif(j.elem->>'local_id', ''),
    coalesce(j.elem->>'title', ''),
    coalesce(j.elem->>'body', ''),
    (j.elem->>'created_at')::timestamptz
  from jsonb_array_elements(p_journal) as j(elem);

  insert into public.custom_exercises (
    id, user_id, local_id, name, muscles, image_uri, video_uri, description, steps, muted, assisted, deleted_at, created_at
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
    -- Absent from an older app's backup: not assisted.
    coalesce((c.elem->>'assisted')::boolean, false),
    nullif(c.elem->>'deleted_at', '')::date,
    now() + c.ord * interval '1 microsecond'
  from jsonb_array_elements(p_custom) with ordinality as c(elem, ord);

  update public.backup_state set
    version      = v_version + 1,
    device       = p_device,
    changed_at   = coalesce(p_changed_at, now()),
    backed_up_at = now(),
    -- An app from before this sends none: the deletions already known stay.
    deleted      = case when jsonb_typeof(p_deleted) = 'array' then p_deleted else deleted end
  where user_id = v_uid;

  return v_version + 1;
end;
$$;
grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb, bigint, text, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
