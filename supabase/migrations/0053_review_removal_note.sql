-- A trainer's message when they remove a review without sending it back.
--
-- Removing a review that hasn't been sent back (Archive or Delete, a 1:1 one
-- or a group's) reads "Not reviewed" to the person who asked (2026-10-29), but
-- never says why: the trainer had nowhere to say it (user request,
-- 2026-11-05). This adds that message:
--
--   shared_programs.removal_note  What the trainer wrote as they removed it,
--                                 or null. Shown to the person who asked only
--                                 while it reads Not reviewed (the app's
--                                 rowToSent). Written just before the removal,
--                                 and cleared when it's restored from the
--                                 archive.
--
-- Written only through set_review_removal_note, never as a column patch. The
-- guard (0039) already refuses any column a caller isn't allowed, so neither
-- the person who asked nor the trainer can patch it; the guard is replaced
-- below only so a new row can't arrive with one already written.
--
-- Apply with `supabase db push` or paste into the SQL editor, after 0052.
-- Idempotent and non-destructive (one nullable column, one function, one
-- replaced trigger function). Until it's applied the app still removes
-- reviews, and tells the trainer their message couldn't be saved.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.shared_programs
  add column if not exists removal_note text;

comment on column public.shared_programs.removal_note is
  'A review''s trainer''s message to the person who asked, left as they removed it without sending it back. Written only by set_review_removal_note.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Writing it
--
--    Who may: the review's trainer (the 1:1 recipient, or a trainer of its
--    group: coaches_group, so its owner or a trainer who's accepted), never
--    the person who asked, and only while it hasn't been sent back: once it
--    has, they have their review and the message has nothing to explain.
--    A blank message is no message (null), which is also how a restore clears
--    it. Returns how many rows changed: 0 is "not yours", as for the archive.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_review_removal_note(p_share uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_count integer;
begin
  if v_uid is null then
    raise exception 'set_review_removal_note: not authenticated';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'set_review_removal_note: the message is too long'
      using errcode = '22001';
  end if;

  update public.shared_programs s
     set removal_note = v_note
   where s.id = p_share
     and s.kind = 'review'
     and s.returned_at is null
     and s.sender_id <> v_uid
     and (
       (s.group_id is null and s.recipient_id = v_uid)
       or (s.group_id is not null and public.coaches_group(v_uid, s.group_id))
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.set_review_removal_note(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The guard (0039): a new row can't arrive with a removal note
--
--    Body unchanged from 0039 but for `new.removal_note` in the insert check.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_shared_program_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_allowed text[] := '{}';
  v_col     text;
begin
  -- Only callers through the API are limited. The security-definer functions
  -- above, the database's own foreign-key actions and the service role all
  -- run as someone else, and are trusted to have checked.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  v_uid := auth.uid();

  if tg_op = 'INSERT' then
    if new.accepted_at is not null or new.deleted_by_recipient_at is not null
       or new.returned_at is not null or new.returned_snapshot is not null
       or new.draft_snapshot is not null or new.completed_at is not null
       or new.archived_at is not null or new.trainer_comments is not null
       or new.last_edited_at is not null or new.removal_note is not null then
      raise exception 'shared_programs: a new program can''t start accepted, archived or sent back'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind = 'share' then
    if v_uid = old.recipient_id then
      v_allowed := v_allowed || array['accepted_at', 'deleted_by_recipient_at'];
    end if;
    if v_uid = old.sender_id then
      v_allowed := v_allowed || array['snapshot', 'program_name', 'last_edited_at'];
      -- Send Update re-opens Accept for everyone; a sender can't accept for them.
      if new.accepted_at is null then
        v_allowed := v_allowed || array['accepted_at'];
      end if;
    end if;
  elsif old.kind = 'review' then
    if v_uid = old.sender_id then
      v_allowed := v_allowed || array['accepted_at'];
    end if;
    if (old.group_id is null and v_uid = old.recipient_id)
       or (old.group_id is not null and public.coaches_group(v_uid, old.group_id)) then
      v_allowed := v_allowed || array['draft_snapshot', 'program_name', 'last_edited_at', 'trainer_comments'];
      if old.group_id is null then
        v_allowed := v_allowed || array['deleted_by_recipient_at'];
      end if;
    end if;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_col in select jsonb_object_keys(v_new) loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) and not (v_col = any(v_allowed)) then
      raise exception 'shared_programs: % can''t be changed here', v_col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

-- Make the API see the new function straight away (see 0028's note).
notify pgrst, 'reload schema';
