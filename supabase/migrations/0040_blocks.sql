-- Blocks, recorded on the server.
--
-- A block used to live only on the blocker's phone. It hid the person there
-- and severed the connection, but group membership doesn't need a connection,
-- so inside a group the server went on delivering them: their group messages
-- still arrived as push notifications, and a phone can only hide what it knows
-- to hide (a block on one phone never reached the blocker's other devices).
--
-- The phone now records every block here as well (utils/moderation.ts), and
-- three things follow from the row:
--
--   1. The connection is severed, both directions, exactly as the phone's own
--      disconnect does. A block that reaches the server late (made offline, or
--      one from before this migration, backfilled) still finishes the job.
--   2. The person is taken out of every group the BLOCKER OWNS, invites
--      included. In anyone else's group they stay (it isn't the blocker's to
--      change), and the blocker's phone hides their messages, programs and
--      review requests instead.
--   3. Nothing they do notifies the blocker: a message, a group message, a
--      program sent to them, a review sent back, a connection request.
--
-- One way, and silent: the person blocked still sees the blocker's messages
-- and programs in a group they share, and can't read the row, so nothing
-- tells them.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  -- Their name when blocked, for the Blocked Accounts list on the blocker's
  -- other devices: once severed, their profile is no longer the blocker's to read.
  name       text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked on public.blocks (blocked_id);

alter table public.blocks enable row level security;

do $$
begin
  -- The blocker's alone: the person blocked can never see that they are.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='blocks' and policyname='blocks_select') then
    create policy blocks_select on public.blocks
      for select using (blocker_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='blocks' and policyname='blocks_insert') then
    create policy blocks_insert on public.blocks
      for insert with check (blocker_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='blocks' and policyname='blocks_delete') then
    create policy blocks_delete on public.blocks
      for delete using (blocker_id = (select auth.uid()));
  end if;
end $$;

-- Whether p_blocker has blocked p_blocked. For the push triggers, which run as
-- the person acting, who may not read the blocker's rows.
create or replace function public.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
     where b.blocker_id = p_blocker and b.blocked_id = p_blocked
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) What a block does: sever, and out of the blocker's own groups
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.connections c
   where (c.requester_id = new.blocker_id and c.addressee_id = new.blocked_id)
      or (c.requester_id = new.blocked_id and c.addressee_id = new.blocker_id);

  delete from public.group_members m
   using public.groups g
   where g.id = m.group_id
     and g.owner_id = new.blocker_id
     and m.user_id = new.blocked_id;
  return new;
end;
$$;

drop trigger if exists blocks_apply on public.blocks;
create trigger blocks_apply
  after insert on public.blocks
  for each row execute function public.apply_block();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Notifications skip whoever blocked the person acting
--
--    Each is the latest version of its function (0012, 0021, 0034) with that
--    one check added; the triggers already point at them.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
begin
  if public.has_blocked(new.recipient_id, new.sender_id) then
    return new;
  end if;
  select name into v_sender from public.profiles where id = new.sender_id;
  perform public.send_expo_push(
    new.recipient_id,
    'coachMessages',
    coalesce(nullif(trim(v_sender), ''), 'New message'),
    left(new.body, 140),
    jsonb_build_object('url', '/trainer/chat/' || new.sender_id)
  );
  return new;
end;
$$;

create or replace function public.notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    if public.has_blocked(new.addressee_id, new.requester_id) then
      return new;
    end if;
    select name into v_name from public.profiles where id = new.requester_id;
    perform public.send_expo_push(
      new.addressee_id,
      'coachingRequests',
      'New connection request',
      coalesce(nullif(trim(v_name), ''), 'Someone') || ' wants to connect with you.',
      jsonb_build_object('url', '/connect')
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    if public.has_blocked(new.requester_id, new.addressee_id) then
      return new;
    end if;
    select name into v_name from public.profiles where id = new.addressee_id;
    perform public.send_expo_push(
      new.requester_id,
      'coachingRequests',
      'Request accepted',
      coalesce(nullif(trim(v_name), ''), 'Your new connection') || ' accepted your request.',
      jsonb_build_object('url', '/connect')
    );
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_group_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
  v_group  text;
  v_member uuid;
begin
  select name into v_sender from public.profiles where id = new.sender_id;
  select name into v_group  from public.groups   where id = new.group_id;

  for v_member in
    select m.user_id from public.group_members m
     where m.group_id = new.group_id and m.user_id <> new.sender_id
       and not public.has_blocked(m.user_id, new.sender_id)
  loop
    perform public.send_expo_push(
      v_member,
      'coachMessages',
      coalesce(nullif(trim(v_group), ''), 'Group'),
      coalesce(nullif(trim(v_sender), ''), 'Someone') || ': ' || left(new.body, 120),
      jsonb_build_object('url', '/trainer/group/' || new.group_id || '/chat')
    );
  end loop;
  return new;
end;
$$;

create or replace function public.notify_shared_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_actor uuid;
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
    select name into v_name from public.profiles where id = v_actor;
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

notify pgrst, 'reload schema';
