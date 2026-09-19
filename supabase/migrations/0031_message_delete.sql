-- Deleting a chat message you sent, in a 1:1 thread (0011) or a group (0016).
--
-- A SOFT delete: the row stays, so the thread can show "Message deleted" where
-- it was and the conversation still reads in order, but its words don't — the
-- body is blanked on the server, not just hidden on the phone. Hiding it
-- client-side alone would leave the text readable through the API by the other
-- side of the conversation, which is not what "delete" promises.
--
-- Only through the two functions below, never an UPDATE policy: a policy that
-- let a sender write their own row would also let them rewrite what they said
-- after it was read. These do exactly one thing — blank the body and stamp
-- deleted_at — and only for the sender.
--
-- Reports are unaffected: a message report snapshots the text when it's filed
-- (utils/moderation.ts), so deleting a reported message can't erase the evidence.
--
-- The group owner's moderation DELETE (0016) is untouched: it still removes a
-- message outright.
--
-- Realtime already publishes both tables (0011, 0016), UPDATEs included, which
-- is what lets an open thread on the other phone show the deletion live.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0011 (messages) and 0016 (group_messages).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.messages       add column if not exists deleted_at timestamptz;
alter table public.group_messages add column if not exists deleted_at timestamptz;

comment on column public.messages.deleted_at is
  'The sender deleted this message. The body is blanked; the row stays so the thread shows where it was.';
comment on column public.group_messages.deleted_at is
  'The sender deleted this message. The body is blanked; the row stays so the thread shows where it was.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The body check
--
--    0011 / 0016 required 1–4000 characters. A deleted message has none, so the
--    rule becomes: a live message has 1–4000 characters, a deleted one is empty.
--    The old checks were declared inline and so carry generated names; they're
--    found by their definition rather than guessed at.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.conrelid in ('public.messages'::regclass, 'public.group_messages'::regclass)
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%char_length(body)%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.messages add constraint messages_body_live_or_deleted
  check (case when deleted_at is null then char_length(body) between 1 and 4000 else body = '' end);
alter table public.group_messages add constraint group_messages_body_live_or_deleted
  check (case when deleted_at is null then char_length(body) between 1 and 4000 else body = '' end);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Deleting
--
--    Sender only. Idempotent: deleting an already-deleted message of yours
--    succeeds and keeps the first deletion's time. Anything else — someone
--    else's message, or one that doesn't exist — raises, so the app can tell
--    the user it didn't happen instead of showing a deletion that didn't stick.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_message: not authenticated';
  end if;

  update public.messages
     set body = '', deleted_at = coalesce(deleted_at, now())
   where id = p_message_id
     and sender_id = v_uid;

  if not found then
    raise exception 'delete_message: not your message';
  end if;
end;
$$;
revoke all on function public.delete_message(uuid) from public;
grant execute on function public.delete_message(uuid) to authenticated;

create or replace function public.delete_group_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_group_message: not authenticated';
  end if;

  update public.group_messages
     set body = '', deleted_at = coalesce(deleted_at, now())
   where id = p_message_id
     and sender_id = v_uid;

  if not found then
    raise exception 'delete_group_message: not your message';
  end if;
end;
$$;
revoke all on function public.delete_group_message(uuid) from public;
grant execute on function public.delete_group_message(uuid) to authenticated;
