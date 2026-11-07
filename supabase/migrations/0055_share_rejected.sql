-- A program someone turned down reads "Rejected" to the trainer who sent it,
-- until the trainer sends them a new version.
--
-- A client's Remove on a program sent to them, one they hadn't accepted, was a
-- hide on their own phone: the server never knew, and the trainer read
-- "Pending" for good (user request, 2026-11-06: show it as rejected, the circle
-- red). The app now writes deleted_by_recipient_at on the row as well, as
-- deleting an accepted copy has always done, and the trainer reads either as
-- Rejected (user decision, 2026-11-06). The recipient could already write it
-- (0039's guard), so that part needs nothing here.
--
-- What does: a trainer's Send Update re-offers the program to everyone, so a
-- turn-down of the version before stops counting. It re-opens Accept that way
-- (accepted_at), and now clears deleted_by_recipient_at in the same patch. The
-- guard lets the sender clear it, and only together with an update (a new
-- last_edited_at), so they can't take back what someone decided about the
-- version they have.
--
-- Apply with `supabase db push` or paste into the SQL editor, after 0054, and
-- BEFORE shipping the build that uses it: that build's Send Update clears it,
-- which the old guard refuses, so an update to anyone who'd turned the program
-- down fails without this. Idempotent and non-destructive (one replaced
-- trigger function; no data changes).

-- ─────────────────────────────────────────────────────────────────────────────
-- The guard (0039, as 0054 left it). Body unchanged from 0054 but for the
-- share sender's deleted_by_recipient_at.
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
  -- and the database's own foreign-key actions and the service role all run
  -- as someone else, and are trusted to have checked.
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
      -- ...and re-offers it to anyone who turned the version before down: only
      -- to clear it, and only with the update.
      if new.deleted_by_recipient_at is null and new.last_edited_at is distinct from old.last_edited_at then
        v_allowed := v_allowed || array['deleted_by_recipient_at'];
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

-- Make the API see the new function straight away (see 0028's note).
notify pgrst, 'reload schema';
