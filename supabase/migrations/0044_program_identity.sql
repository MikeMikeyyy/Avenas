-- A program keeps one id for life, and a received copy remembers whose program
-- it is.
--
-- Every backup (replace_user_data) deletes the account's rows and inserts them
-- again under freshly minted uuids, and a restore (a new phone, a reinstall,
-- signing in to another account and back) read those uuids back as the
-- programs' ids. So a restore renamed every program, and with it:
--   * a trainer's program went out on its next send under a new id, so the
--     client's phone took it for a different program and added a second copy
--     beside the one they were running;
--   * the client's phone lost its own record of which send made which copy
--     (kept on the phone only, and cleared by a restore), so even an update of
--     the same send added a second copy.
-- The client's sessions stayed on the first copy. Starting the second, or
-- deleting the first as a duplicate, left sessions they had logged in the
-- program showing as individual workouts on their trainer's page (user report,
-- 2026-10-13).
--
--   programs.local_id      the app's own id for the program. The backup sends
--                          it; a restore gives it back as the program's id and
--                          points each workout at its program by it.
--   programs.share_origin  on a copy accepted from someone's send, whose
--                          program it is: "<sender uid>|<sender's program id>".
--                          An update or a re-send of that program finds the
--                          copy by it, restored or not. On a copy that a
--                          trainer's review made because the original was
--                          deleted, the review's: the account's own uid and
--                          the original's id, so the next accept of it lands
--                          there too.
--
-- Rows from an app before this build carry neither: they read back as they
-- always did (the row's id, no origin).
--
-- Rides the backup, so replace_user_data is recreated below with both columns
-- in its list (see 0023, 0032, 0037, 0043: a column missing from that list is
-- silently blanked by every backup). get_client_training returns whole rows
-- (to_jsonb), so a trainer's read of a client carries them with no change.
--
-- Apply with `supabase db push` or paste into the SQL editor, AFTER 0043.
-- Idempotent and non-destructive (two nullable columns, one replaced function).
-- Apply it BEFORE shipping the build that uses it: until then the backups that
-- build sends lose both, and a restore renames programs as before.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.programs
  add column if not exists local_id text;
alter table public.programs
  add column if not exists share_origin text;

comment on column public.programs.local_id is
  'The app''s own id for this program. The row id is minted afresh by every backup; a restore reads this back as the program''s id, so a program keeps one id for life. Null on a row from an app before migration 0044.';
comment on column public.programs.share_origin is
  'On a copy accepted from someone''s send: whose program it is, "<sender uid>|<sender program id>". An update or re-send of that program lands on this copy by it. On a copy a trainer''s review made in place of a deleted original: the review''s (this account''s uid and the original''s id). Null otherwise.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The backup carries both
--
--    Body unchanged from 0043 but for the two columns.
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
      cycle_pattern, day_ids, skipped_dates, pushed_dates, pulled_dates, holds,
      workouts, extra_workouts
    )
    select
      pi.new_id,
      v_uid,
      -- Absent from an older app's backup: the restore then uses the row's id,
      -- as it always did.
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
