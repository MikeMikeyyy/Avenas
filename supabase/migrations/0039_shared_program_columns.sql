-- Who may change WHICH columns of a shared program.
--
-- The row policies (0013, 0026, 0028) say who may update a row at all: its
-- sender, its recipient, and a trainer of its group. They can't say which
-- columns, so anyone allowed to touch a row could change any of it by talking
-- to the API directly, with their own login and no app involved. The app only
-- ever writes the right columns, but these all worked:
--
--   * a client un-archiving a send their trainer had archived (archived_at);
--   * someone who asked for a review marking it done or "sent back" themselves
--     (completed_at, returned_at, returned_snapshot);
--   * re-addressing a row (sender_id / recipient_id), which put a program on
--     the list of someone the sender isn't connected to, getting round the
--     connection check that sending a program goes through.
--
-- This trigger allows, for a caller coming through the API, exactly the
-- columns the app writes for them, and refuses anything else:
--
--   a SEND                                                      (kind 'share')
--     its recipient   accepted_at, deleted_by_recipient_at      accept, remove,
--                                                               delete my copy
--     its sender      snapshot, program_name, last_edited_at,   Send Update
--                     and accepted_at back to null              (re-opens Accept)
--   a REVIEW                                                    (kind 'review')
--     who asked       accepted_at                               accept the changes
--     its trainer     draft_snapshot, program_name,             builder saves,
--                     last_edited_at, trainer_comments          comments
--                     + deleted_by_recipient_at (1:1 only)      Delete from my list
--
-- Its trainer is the 1:1 recipient, or a trainer of its group. Everything else
-- (who it's from and to, its kind, group, send key and time, archived_at,
-- completed_at, returned_at, returned_snapshot) is written only by the
-- security-definer functions that check who's asking themselves
-- (set_share_archived, set_group_review_completed, return_shared_review),
-- which run as the table's owner, and by the database's own actions (a deleted
-- group nulls group_id): neither is an API caller, so neither is checked here.
--
-- A new row through the API starts with none of that state set: a send can't
-- arrive already accepted, archived or "sent back".
--
-- Apply with `supabase db push` or paste into the SQL editor, after 0038.
-- Idempotent. Nothing the app does changes: scripts/verify-program-flows.ts
-- plays every share and review action through the API role against it, and
-- scripts/verify-db.ts pins what's refused.

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
       or new.last_edited_at is not null then
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

drop trigger if exists shared_programs_guard on public.shared_programs;
create trigger shared_programs_guard
  before insert or update on public.shared_programs
  for each row execute function public.guard_shared_program_write();
