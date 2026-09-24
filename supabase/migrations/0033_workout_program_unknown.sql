-- Keep "we don't know which program" apart from "no program" through a backup.
--
-- A logged session records its program in CompletedWorkout.programId, and the
-- app reads it three ways (utils/progressStats.ts workoutBelongsToProgram):
--   a program id  → that program's session
--   ""            → a FREE workout, belonging to no program
--   absent        → a LEGACY record, written before programId existed; which
--                   program it was is worked out from its day name and the
--                   program's dates
-- The cloud stored the last two identically, as program_id null, and read both
-- back as "". So a restore, or a trainer reading a client (0032), turned every
-- legacy session into a free workout, and it silently stopped counting towards
-- the program it was done in.
--
-- program_unknown marks the legacy case. It defaults to false, which is how
-- every existing row has always read back (as free), so nothing already in the
-- cloud changes meaning; each phone's next backup rewrites its rows and marks
-- its own legacy sessions. It is only ever true with program_id null.
--
-- ALSO recreates replace_user_data, which lists its insert columns explicitly
-- (see 0023, 0032): body unchanged from 0032 but for carrying the new column.
--
-- Apply with `supabase db push` or paste into the SQL editor, AFTER 0032.
-- Idempotent and non-destructive (adds one defaulted column).

alter table public.workouts
  add column if not exists program_unknown boolean not null default false;

comment on column public.workouts.program_unknown is
  'Legacy record from before the app stored programId: the program is unknown and is inferred from the day name and dates. False (with program_id null) means a free workout.';

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
      start_date, completed_date, cycle_offset, paused_at, training_days, cycle_days,
      cycle_pattern, day_ids, skipped_dates, pushed_dates, pulled_dates,
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
      (pi.elem->>'training_days')::integer,
      (pi.elem->>'cycle_days')::integer,
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'cycle_pattern') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'day_ids') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'skipped_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pushed_dates') as x), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'pulled_dates') as x), '{}'),
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

notify pgrst, 'reload schema';
