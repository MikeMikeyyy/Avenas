-- A trainer's comments, sent back with their review.
--
-- Send Back and Send Update asked "Are you sure?" with nowhere to say anything
-- (user request, 2026-11-06: a box like Remove's message, its words on the card
-- the person who asked gets back). shared_programs.trainer_comments has been
-- there since 0013, and the app has always shown it on a review sent back, but
-- nothing wrote it.
--
-- Now return_shared_review takes the comments and writes them in the same
-- statement as the version it hands over, so the person who asked never reads
-- new comments on the previous version, or a version without its own:
--
--   p_comments  The comments on the version being sent back. Blank clears
--               them: an update with nothing to say says nothing, rather than
--               the last version's words (the app's box opens with those, to
--               keep or change). Null, which is what a build from before this
--               sends (it names the review alone), leaves them as they were.
--
-- And they're written only so: the guard (0039, 0053) no longer lets a
-- review's trainer patch them, as it never let returned_snapshot be patched.
--
-- Comments alone are an answer too (user request, 2026-11-06: "an alternative
-- rather than removing"). A trainer with nothing to change sends it back as it
-- came, with their comments: returned_snapshot stays null, which is how the
-- app knows it came back with no changes (the person who asked says Got it,
-- not Accept). And once it's back, a trainer can send comments again without
-- editing: with no new draft the version is the one they have, so their
-- accept stands (it used to be cleared by every send) and only the comments
-- and returned_at move, which brings the request back to their attention and
-- notifies them. The notification says which it was: reviewed with no
-- changes, returned with changes, an update, or a comment.
--
-- Apply with `supabase db push` or paste into the SQL editor, after 0053, and
-- BEFORE shipping the build that uses it: that build's Send Back passes the
-- comments, and fails without this. Older builds keep working. Idempotent and
-- non-destructive (a function's arguments and two replaced trigger functions;
-- no data changes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Send Back / Send Update, with the comments
--
--    0034's function, its checks unchanged. The one-argument version goes: a
--    second beside it, with a default, would leave the API two to choose
--    between for a call naming p_share alone (an older build's), and it would
--    refuse the call.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.return_shared_review(uuid);

create or replace function public.return_shared_review(p_share uuid, p_comments text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_row      public.shared_programs%rowtype;
  v_comments text := nullif(btrim(coalesce(p_comments, '')), '');
begin
  if v_uid is null then
    raise exception 'return_shared_review: not authenticated';
  end if;
  if char_length(v_comments) > 1000 then
    raise exception 'return_shared_review: the comments are too long'
      using errcode = '22001';
  end if;

  select * into v_row from public.shared_programs where id = p_share;
  if not found or v_row.kind <> 'review' then
    raise exception 'return_shared_review: not a review';
  end if;
  if v_uid = v_row.sender_id then
    raise exception 'return_shared_review: this is your own request';
  end if;
  if not (
    v_uid = v_row.recipient_id
    or (v_row.group_id is not null and public.coaches_group(v_uid, v_row.group_id))
  ) then
    raise exception 'return_shared_review: not this review''s trainer';
  end if;

  -- (The right-hand sides read the row as it was.) A new version, or the first
  -- send-back, reopens Accept; comments alone on the version they have leave
  -- their accept as it stands.
  update public.shared_programs
     set returned_snapshot = coalesce(draft_snapshot, returned_snapshot),
         draft_snapshot    = null,
         returned_at       = now(),
         accepted_at       = case when draft_snapshot is null and returned_at is not null then accepted_at end,
         trainer_comments  = case when p_comments is null then trainer_comments else v_comments end
   where id = p_share;
end;
$$;
grant execute on function public.return_shared_review(uuid, text) to authenticated;

comment on column public.shared_programs.trainer_comments is
  'A review''s trainer''s comments on the version sent back. Written only by return_shared_review, with that version.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The guard (0039, as 0053 left it): the comments are no longer a column a
--    review's trainer may patch
--
--    Body unchanged from 0053 but for 'trainer_comments' leaving the trainer's
--    list. A new row still can't arrive with them.
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
      v_allowed := v_allowed || array['draft_snapshot', 'program_name', 'last_edited_at'];
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) What the person who asked is told (0040's notify_shared_program)
--
--    Body unchanged from 0040 but for the send-back's words, which said "with
--    their changes" of every first send-back and "an update" of every other.
--    Read off the row as it was: no copy sent back yet and no draft is a review
--    with no changes; a draft is a new version; neither is comments alone,
--    which says nothing when it only took the comments off.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_shared_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_actor uuid;
  v_body  text;
begin
  if tg_op = 'INSERT' then
    if public.has_blocked(new.recipient_id, new.sender_id) then
      return new;
    end if;
    select name into v_name from public.profiles where id = new.sender_id;
    perform public.send_expo_push(
      new.recipient_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Someone'),
      case when new.kind = 'review'
        then 'Sent you "' || new.program_name || '" to review.'
        else 'Sent you a program: "' || new.program_name || '".'
      end,
      jsonb_build_object('url', '/trainer-hub')
    );
  elsif tg_op = 'UPDATE' and new.returned_at is not null
        and new.returned_at is distinct from old.returned_at then
    -- The trainer acting, when there is one (return_shared_review runs as the
    -- caller's request); the row's recipient otherwise.
    v_actor := coalesce(auth.uid(), new.recipient_id);
    if public.has_blocked(new.sender_id, v_actor) then
      return new;
    end if;
    v_body := case
      when old.returned_at is null and old.draft_snapshot is null and old.returned_snapshot is null
        then 'Reviewed "' || new.program_name || '" with no changes.'
      when old.returned_at is null
        then 'Returned "' || new.program_name || '" with their changes.'
      when old.draft_snapshot is not null
        then 'Sent an update to "' || new.program_name || '".'
      when new.trainer_comments is not null
        then 'Left a comment on "' || new.program_name || '".'
    end;
    if v_body is null then
      return new;
    end if;
    select name into v_name from public.profiles where id = v_actor;
    perform public.send_expo_push(
      new.sender_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Your trainer'),
      v_body,
      jsonb_build_object('url', '/trainer-hub')
    );
  end if;
  return new;
end;
$$;

-- Make the API see the new function straight away (see 0028's note: without it
-- Send Back can fail with "Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';
