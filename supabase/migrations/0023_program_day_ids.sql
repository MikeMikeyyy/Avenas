-- Stable identity for a program's workout days.
--
-- A day used to be identified by its NAME, which is neither unique (a cycle can
-- schedule "Upper" twice) nor stable (renaming it orphaned everything keyed to
-- it). Two new columns fix that:
--
--   programs.day_ids  text[]  parallel to cycle_pattern, one id per slot
--   workouts.day_id   text    which of those slots the session was performed on
--
-- Both are nullable/empty-defaulted for rows written before this migration; the
-- client synthesizes the same deterministic positional ids for those (see
-- utils/programDays.ts legacyDayId) so the two agree without a server backfill.
--
-- ALSO recreates replace_user_data. The RPC lists its insert columns explicitly,
-- so every column added since 0004 is silently dropped on a full-snapshot push.
-- That already cost `paused_at` (migration 0019): pushing the local snapshot
-- wiped the hold date in the cloud, and the next pull brought a program back
-- unpaused. Both columns are carried here.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (two nullable columns, no data rewritten).

alter table public.programs
  add column if not exists day_ids text[] not null default '{}';

comment on column public.programs.day_ids is
  'Stable per-slot ids, parallel to cycle_pattern. A day''s real identity: survives a rename and distinguishes two same-named days. Empty for rows predating this column.';

alter table public.workouts
  add column if not exists day_id text;

comment on column public.workouts.day_id is
  'Which cycle slot of program_id this session was performed on (a programs.day_ids entry). Null for free workouts and for records predating this column.';

-- ── replace_user_data, carrying day_ids / day_id / paused_at ──────────────────
-- Body is otherwise unchanged from 0004; see that migration for the design notes
-- on atomicity and the program_index → uuid resolution.

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
      cycle_pattern, day_ids, workouts, extra_workouts
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
      coalesce(pi.elem->'workouts', '{}'::jsonb),
      coalesce((select array_agg(x) from jsonb_array_elements_text(pi.elem->'extra_workouts') as x), '{}')
    from prog_input pi
    returning id
  )
  insert into public.workouts (
    id, user_id, program_id, date, completed_at, workout_name, day_id,
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
    (select array_agg(x) from jsonb_array_elements_text(c.elem->'steps') as x),
    coalesce((c.elem->>'muted')::boolean, false)
  from jsonb_array_elements(p_custom) as c(elem);
end;
$$;

grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb) to authenticated;
