-- Archive: take a program off a list without losing it, and bring it back.
--
-- Every Remove on a program used to be the only way to shorten a list, and it
-- was for good. Archive is the other choice beside it, and each page gets an
-- archive to restore from. Two tables carry it:
--
--   programs.archived_at        One of MY programs, archived from My Programs.
--                               A date ("YYYY-MM-DD"), like paused_at: it only
--                               orders the archive and says when. Rides the
--                               backup, so replace_user_data is recreated below
--                               with the column in its list (see 0023, 0032:
--                               a column missing from that list is silently
--                               blanked by every backup).
--
--   shared_programs.archived_at Taken off the list of whoever the row is WORK
--                               for, and what that reaches depends on the kind:
--                                 'share'  the sender's (or a group trainer's)
--                                          sent list, and so every recipient's
--                                          list too: an archived send is hidden
--                                          from the people it went to until it's
--                                          restored. A recipient's own Remove is
--                                          a device-local hide and outlives a
--                                          restore, which is the point.
--                                 'review' the reviewer's queue (the 1:1 trainer,
--                                          or a group's trainers). The person who
--                                          asked never sees it: their request is
--                                          theirs, not the trainer's to tidy.
--
-- Written only through set_share_archived, never as a column patch: the update
-- policy lets a recipient write their own row, and a recipient must not be able
-- to archive a trainer's send, nor someone asking for a review close their own.
--
-- Apply with `supabase db push` or paste into the SQL editor, AFTER 0036.
-- Idempotent and non-destructive (two nullable columns, one function, one
-- replaced function). Apply it BEFORE shipping the build that uses it: that
-- build's Archive calls set_share_archived, which fails without this, and its
-- backups send archived_at, which an older replace_user_data drops.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.programs
  add column if not exists archived_at date;

comment on column public.programs.archived_at is
  'Archived from My Programs on this date. Null = in the list. Status is untouched, so a restore puts it back as it was.';

alter table public.shared_programs
  add column if not exists archived_at timestamptz;

comment on column public.shared_programs.archived_at is
  'Archived by whoever the row is work for: a share by its sender or a group trainer (hidden from recipients too), a review by its trainer(s) (the sender is unaffected). Written only by set_share_archived.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Archive / restore
--
--    Takes ids rather than a batch key so a whole send (one row per recipient)
--    goes in one statement: a send is never half archived. Rows the caller may
--    not archive are left alone rather than raising, and the count says how
--    many moved, so the app can tell "done" from "not yours" (as with deletes).
--
--    Who may:
--      a share   its sender, or a trainer of the group it went to
--      a review  its trainer: the 1:1 recipient, or a trainer of its group.
--                Never the person who asked.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_share_archived(p_shares uuid[], p_archived boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'set_share_archived: not authenticated';
  end if;

  update public.shared_programs s
     set archived_at = case when p_archived then now() else null end
   where s.id = any(coalesce(p_shares, '{}'::uuid[]))
     and (
       (s.kind = 'share' and (
          s.sender_id = v_uid
          or (s.group_id is not null and public.coaches_group(v_uid, s.group_id))))
       or (s.kind = 'review' and s.sender_id <> v_uid and (
          (s.group_id is null and s.recipient_id = v_uid)
          or (s.group_id is not null and public.coaches_group(v_uid, s.group_id))))
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.set_share_archived(uuid[], boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The backup carries a program's archived_at
--
--    Body unchanged from 0033 but for the one column.
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
