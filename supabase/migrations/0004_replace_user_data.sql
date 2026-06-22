-- Atomic "replace this user's data" RPC — the server half of the cloud backup.
--
-- The old client-side push did DELETE-all then INSERT across four tables over
-- several round-trips: non-atomic (a mid-way network failure left the cloud
-- wiped/partial) and only ever triggered at first login. This function does the
-- whole replace inside ONE transaction (the function body), so it either fully
-- succeeds or rolls back — and it's cheap enough to call automatically on every
-- change (see lib/syncManager.ts).
--
-- Program → workout linkage: workouts reference their program by `program_index`
-- (the program's position in p_programs), not by id. We pre-generate a uuid per
-- program (keyed by array position via WITH ORDINALITY, forced single-evaluation
-- with MATERIALIZED) so a workout's program_index resolves to the right new uuid
-- without a second round-trip. A null/absent program_index = free/legacy workout.
--
-- security definer + manual `user_id = auth.uid()` scoping: every row written is
-- pinned to the caller, so it can't touch another account's data. auth.uid()
-- reads the request JWT and works inside a definer function.
--
-- Apply with `supabase db push` or paste into the SQL editor.

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

  -- Wipe this user's rows. Same statement (function body) as the inserts below,
  -- so the whole thing is one transaction → atomic.
  delete from public.workouts        where user_id = v_uid;
  delete from public.programs        where user_id = v_uid;
  delete from public.journal_entries where user_id = v_uid;
  delete from public.custom_exercises where user_id = v_uid;

  -- Programs + workouts in one statement so the workout insert can resolve
  -- program_index → the program's freshly-minted uuid.
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
      start_date, completed_date, cycle_offset, training_days, cycle_days,
      cycle_pattern, workouts, extra_workouts
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
      (pi.elem->>'training_days')::integer,
      (pi.elem->>'cycle_days')::integer,
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'cycle_pattern') as x), '{}'),
      coalesce(pi.elem->'workouts', '{}'::jsonb),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'extra_workouts') as x), '{}')
    from prog_input pi
    returning id
  )
  insert into public.workouts (
    id, user_id, program_id, date, completed_at, workout_name,
    duration_seconds, exercises, session_notes
  )
  select
    gen_random_uuid(),
    v_uid,
    (select pi.new_id from prog_input pi
       where pi.ord = (w.elem->>'program_index')::integer + 1),
    (w.elem->>'date')::date,
    (w.elem->>'completed_at')::timestamptz,
    w.elem->>'workout_name',
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
    (select array_agg(x) from jsonb_array_elements_text(c.elem->'steps') as x),
    coalesce((c.elem->>'muted')::boolean, false)
  from jsonb_array_elements(p_custom) as c(elem);
end;
$$;

grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb) to authenticated;
