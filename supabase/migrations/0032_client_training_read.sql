-- A trainer can see the training of the people they coach.
--
-- Every client's programs, workouts, journal and custom exercises have been
-- backed up to their own rows since 0004, but 0001's owner-only policies meant
-- nobody else could read them, so the client page's Progress, Journal and
-- Programs tabs were empty for every real client. This adds the read half.
--
-- WHO: a TRAINER account (profiles.account_type = 'pt') with an ACCEPTED
-- connection to the person. The person's own account type is deliberately not
-- checked, so a fellow trainer taken on as a client reads exactly like a gym
-- user. Connections are role-blind (0006) and "which of two trainers coaches
-- the other" is a local-only choice (@avenas/pt/trainer_clients), so two
-- connected trainers can each read the other. A gym user never reads anyone's
-- training, whatever group role they hold. Removing or blocking the connection
-- ends it, because the check is live on every read.
--
-- HOW: through two SECURITY DEFINER functions rather than widening the tables'
-- policies. Writes stay exactly as owner-only as they were, and
-- get_client_training reads all four tables in ONE statement, so one snapshot.
-- replace_user_data re-mints every program uuid on each backup; separate reads
-- could land either side of one and return workouts pointing at a program id
-- the programs read never saw, which drops those sessions from the per-day
-- breakdown. A single jsonb value also isn't subject to the API's 1000-row cap.
--
-- ALSO recreates replace_user_data, fixing two things that kept a client's
-- training out of the cloud, where a trainer now reads it:
--   * skipped_dates, pushed_dates (0025) and pulled_dates (0029). The RPC lists
--     its insert columns explicitly, and neither migration updated it, so every
--     backup since has written empty lists: the cloud (and anything restored or
--     read from it) lost every rest-day mark.
--   * a custom exercise without steps. The app sends `steps: null` for one, and
--     expanding a JSON null as an array raises, so since 0004 EVERY backup from
--     an account holding such an exercise has failed outright.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0006 (connections), 0023, 0025 and 0029.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) May the caller read `p_owner`'s training?
--
--    Keyed to auth.uid() rather than taking the viewer as an argument, so it
--    can't be used to ask about two OTHER accounts' connection.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.can_view_training(p_owner uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select auth.uid() is not null
    and p_owner is not null
    and p_owner <> auth.uid()
    and exists (
      select 1 from public.profiles v
      where v.id = auth.uid() and v.account_type = 'pt'
    )
    and exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.addressee_id = p_owner)
          or (c.requester_id = p_owner and c.addressee_id = auth.uid()))
    );
$$;
grant execute on function public.can_view_training(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) One person's training, as the row shapes the app already maps
--
--    Returns null (not an error) when the caller may not read it, so the app
--    can tell "no access" from "couldn't reach the server". Each array holds
--    to_jsonb(row), i.e. the same columns lib/database.types.ts describes, in
--    the order lib/cloud.ts's own pull uses.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_client_training(p_client uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'get_client_training: not authenticated';
  end if;
  if not public.can_view_training(p_client) then
    return null;
  end if;

  return jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.programs p where p.user_id = p_client
    ), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.completed_at desc)
      from public.workouts w where w.user_id = p_client
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from public.journal_entries j where j.user_id = p_client
    ), '[]'::jsonb),
    'custom', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.name)
      from public.custom_exercises c where c.user_id = p_client
    ), '[]'::jsonb),
    -- When their phone last backed up, so the trainer can tell how current
    -- this is. Every backup deletes and re-inserts all four tables (and the
    -- app backs up whenever it leaves the foreground), so every row's
    -- updated_at is that backup's time. Null for someone with nothing backed up.
    'backed_up_at', (
      select max(u) from (
        select max(updated_at) as u from public.programs where user_id = p_client
        union all select max(updated_at) from public.workouts where user_id = p_client
        union all select max(updated_at) from public.journal_entries where user_id = p_client
        union all select max(updated_at) from public.custom_exercises where user_id = p_client
      ) s
    )
  );
end;
$$;
grant execute on function public.get_client_training(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The active program's name for several people at once
--
--    For the one-line "active program" under each person on the trainer hub
--    and a group's roster. Fetching every client's whole history just to read
--    one name would be the heaviest thing either page does. Anyone the caller
--    may not read is simply absent from the result.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_clients_active_programs(p_clients uuid[])
returns table (user_id uuid, name text)
language sql
security definer
stable
set search_path = ''
as $$
  select p.user_id, p.name
  from public.programs p
  where p.user_id = any(coalesce(p_clients, '{}'::uuid[]))
    and p.status = 'active'
    and public.can_view_training(p.user_id);
$$;
grant execute on function public.get_clients_active_programs(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) replace_user_data, now carrying skipped / pushed / pulled dates
--
--    Body otherwise unchanged from 0023; see 0004 for the design notes on
--    atomicity and the program_index → uuid resolution.
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
    -- lib/mappers.ts:customToRow sends `steps: null` for an exercise without
    -- steps, and jsonb_array_elements_text() raises on a JSON null ("cannot
    -- extract elements from a scalar") where it would skip a SQL null.
    (select array_agg(x) from jsonb_array_elements_text(
      case when jsonb_typeof(c.elem->'steps') = 'array' then c.elem->'steps' end
    ) as x),
    coalesce((c.elem->>'muted')::boolean, false)
  from jsonb_array_elements(p_custom) as c(elem);
end;
$$;
grant execute on function public.replace_user_data(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Make the API see the new functions straight away (see 0028).
notify pgrst, 'reload schema';
