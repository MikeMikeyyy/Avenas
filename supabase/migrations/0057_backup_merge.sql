-- Backups from two phones on one account merge instead of overwriting.
--
-- Every backup replaces the account's whole copy (replace_user_data, 0004), and
-- each phone sends one every time it leaves the foreground. With two phones on
-- one account (Expo Go and the App Store app on one phone are two), the copy
-- held whichever phone left last: the other phone's new workouts dropped out of
-- it, and out of a trainer's view, and were lost for good if that phone was
-- then reset before backing up again. Now (user decision, 2026-11-07) a phone
-- may only replace the copy once it has the latest one; one that's behind is
-- refused, downloads the copy, combines it with its own (lib/syncManager.ts,
-- utils/syncMerge.ts) and backs up the result.
--
--   backup_state        which backup the account is on: a version every backup
--                       moves on by one, which phone sent it, when its last
--                       change was made, and every deletion the phones know of
--                       (so a delete on one phone carries to the other).
--   replace_user_data   takes the version the phone last saw and refuses the
--                       backup ("stale backup", PT409) if another has landed
--                       since; returns the new version. An app from before this
--                       sends none and is let through as before (it can't
--                       merge), moving the version on so the new app notices.
--   get_my_backup       the whole copy in one read, with its version: one
--                       statement, so one snapshot, and no 1000-row cap.
--   workouts.local_id,  a session's and an entry's own id, kept through a
--   journal_entries.    backup as a program's has been since 0044, so both
--   local_id            phones know them by the same id.
--
-- Also: programs and custom exercises are stored in the order the phone holds
-- them (each a microsecond after the last), so a restore keeps that order. All
-- rows of one backup used to share one created_at, which orders nothing.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.
-- Requires 0052 (whose replace_user_data this recreates). Until it's applied,
-- the app backs up as before (it falls back to the old call, lib/cloud.ts).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Every session and journal entry keeps its own id through a backup
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.workouts
  add column if not exists local_id text;
alter table public.journal_entries
  add column if not exists local_id text;

comment on column public.workouts.local_id is
  'The session''s own id on the phone (CompletedWorkout.id), read back as its id (lib/mappers.ts). Null on a row from an app before 0057, which takes the row''s id.';
comment on column public.journal_entries.local_id is
  'The entry''s own id on the phone (JournalEntry.id), read back as its id. Null on a row from an app before 0057.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Which backup the account is on
--
--    Written only by replace_user_data (security definer); the owner reads
--    their own row. Gone with the account.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.backup_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  version      bigint not null default 0,
  device       text,
  changed_at   timestamptz,
  backed_up_at timestamptz not null default now(),
  deleted      jsonb not null default '[]'::jsonb
);

comment on table public.backup_state is
  'One row per account: the version of its backup (every replace_user_data moves it on by one), the phone that sent it (device, the app''s own install id), when that phone''s last change was made (changed_at), and every deletion known (deleted: [{ k, id, key?, at }], utils/syncMerge.ts).';

alter table public.backup_state enable row level security;

drop policy if exists "backup_state: read own" on public.backup_state;
create policy "backup_state: read own" on public.backup_state
  for select to authenticated using (user_id = auth.uid());

-- No write policies: through the API a row can only be read, by its owner.
grant select, insert, update, delete on public.backup_state to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The backup, refused when the phone hasn't seen the latest
--
--    The old four-argument function is dropped (its return type changes). A
--    call naming only its four arguments, from an app before this, still finds
--    this one: the rest have defaults.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.replace_user_data(jsonb, jsonb, jsonb, jsonb);

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
    id, user_id, local_id, name, muscles, image_uri, video_uri, description, steps, muted, deleted_at, created_at
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The whole backup in one read, with the version it's at
--
--    The row shapes lib/database.types.ts describes (to_jsonb of each row), as
--    get_client_training (0032) hands a trainer a client's. One statement in a
--    stable function, so every list and the version come from one snapshot: a
--    backup landing mid-read can't pair one backup's programs with another's
--    workouts, which separate reads could.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_backup()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'get_my_backup: not authenticated';
  end if;

  return jsonb_build_object(
    'version', coalesce((select s.version from public.backup_state s where s.user_id = v_uid), 0),
    'device', (select s.device from public.backup_state s where s.user_id = v_uid),
    'changed_at', (select s.changed_at from public.backup_state s where s.user_id = v_uid),
    'backed_up_at', (select s.backed_up_at from public.backup_state s where s.user_id = v_uid),
    'deleted', coalesce((select s.deleted from public.backup_state s where s.user_id = v_uid), '[]'::jsonb),
    'programs', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.programs p where p.user_id = v_uid
    ), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.completed_at desc, w.id)
      from public.workouts w where w.user_id = v_uid
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc, j.id)
      from public.journal_entries j where j.user_id = v_uid
    ), '[]'::jsonb),
    'custom', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.custom_exercises c where c.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_my_backup() to authenticated;

notify pgrst, 'reload schema';
