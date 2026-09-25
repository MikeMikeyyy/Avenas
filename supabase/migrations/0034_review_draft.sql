-- A trainer's edits to a review reach the client when they SEND IT BACK, not
-- every time they save.
--
-- 0013 kept the trainer's working copy in returned_snapshot, which is also the
-- copy the client views and accepts. So every save in the builder went straight
-- to the client, and "Send Update" only moved returned_at: a client could accept
-- a program the trainer was still halfway through, and one who had already
-- accepted never got the update at all, because nothing cleared accepted_at
-- (the Accept button and applyReturnedProgram both stop at it).
--
-- The row now holds three copies, each written by one thing:
--   snapshot           what the client sent. Never touched.
--   draft_snapshot     the trainer's working copy. Every builder save.
--   returned_snapshot  what the client was sent back. Only return_shared_review,
--                      which copies the draft across, stamps returned_at and
--                      clears accepted_at in one statement, so Send Back and
--                      Send Update both reopen Accept.
--
-- No backfill. A row reviewed but not yet sent back carries its working copy in
-- returned_snapshot; the app reads the trainer's copy as draft, then returned,
-- then the original, and the client's as the original until returned_at is set,
-- so that copy is picked up as the draft and never shown early.
--
-- Also: the "sent back" notification now names the trainer who did it (a group
-- review is addressed to the group's owner, but any coach may send it back),
-- and a Send Update notifies too, since it now reopens Accept.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0012 (send_expo_push), 0013 (shared_programs), 0027
-- (coaches_group) and 0028 (group reviews). Apply it BEFORE shipping the build
-- that uses it: that build's builder saves write draft_snapshot and its Send
-- Back calls return_shared_review, and both fail without this.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The trainer's working copy
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.shared_programs
  add column if not exists draft_snapshot jsonb;

comment on column public.shared_programs.draft_snapshot is
  'A review''s working copy: the trainer''s edits not yet sent back. Null once sent.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Send Back / Send Update
--
--    An RPC because it copies one column into another, which a patch through
--    the API can't express, and because it's the one step that must happen
--    whole: a returned_at without the copy would show the client the previous
--    version as the new one.
--
--    Who may: the row's recipient (a 1:1 review's trainer) or any coach of the
--    group it was posted to. Never the sender, even though the update policy
--    lets them write their own row: sending back your own request is not a
--    review.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.return_shared_review(p_share uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shared_programs%rowtype;
begin
  if v_uid is null then
    raise exception 'return_shared_review: not authenticated';
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

  update public.shared_programs
     set returned_snapshot = coalesce(draft_snapshot, returned_snapshot),
         draft_snapshot    = null,
         returned_at       = now(),
         accepted_at       = null
   where id = p_share;
end;
$$;
grant execute on function public.return_shared_review(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Notifications
--
--    0013's trigger, with the return branch reworked: it names the trainer
--    who sent it back rather than the row's recipient, and it fires on every
--    new returned_at rather than only the first.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_shared_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
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
    select name into v_name from public.profiles where id = coalesce(auth.uid(), new.recipient_id);
    perform public.send_expo_push(
      new.sender_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Your trainer'),
      case when old.returned_at is null
        then 'Returned "' || new.program_name || '" with their changes.'
        else 'Sent an update to "' || new.program_name || '".'
      end,
      jsonb_build_object('url', '/trainer-hub')
    );
  end if;
  return new;
end;
$$;

-- Make the API see the new function straight away (see 0028's note: without it
-- Send Back can fail with "Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';
