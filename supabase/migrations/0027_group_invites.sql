-- Joining a group is now something you agree to.
--
-- 0016 put you in a group the moment the owner added you: the insert created a
-- membership row and that row WAS the membership. That is fine for a trainer
-- organising their own clients, and wrong from the other side — a gym user was
-- silently placed in a shared chat with strangers, with no say and no notice.
--
-- A membership row now means "invited"; `accepted_at` is what makes it a
-- membership. Everything that asks "is this person in this group?" goes through
-- is_group_member(), so pinning the accepted check there covers the chat, the
-- roster, the read stamps and the program-send policies in one place rather
-- than in each of them.
--
-- What a pending invitee can see is deliberately nothing: not the roster, not
-- the thread, not the group row itself. The invite card is fed by one RPC that
-- returns exactly the fields it renders. Declining therefore leaks nothing,
-- which would not be true if the policies had been widened to invitees instead.
--
-- A program sent to a group still goes to EVERY invited member, pending ones
-- included, so it is waiting on their own page the moment they accept rather
-- than being lost because it was sent while they hadn't answered yet. That is
-- why can_coach_in_group() below gained an accepted check on the SENDER only.
--
-- Existing rows are backfilled to added_at: nobody already in a group is
-- suddenly pending.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0016 (groups), 0022 (roles) and 0026 (group shares).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.group_members
  add column if not exists accepted_at timestamptz;

-- Backfill BEFORE anything reads it. Existing rows predate the invite concept,
-- so they are accepted memberships by definition.
update public.group_members set accepted_at = added_at where accepted_at is null;

-- An owner is never pending in their own group, whatever order things ran in.
update public.group_members m
   set accepted_at = coalesce(m.accepted_at, m.added_at)
  from public.groups g
 where g.id = m.group_id and g.owner_id = m.user_id;

create index if not exists group_members_pending on public.group_members (user_id)
  where accepted_at is null;

comment on column public.group_members.accepted_at is
  'When the invitee accepted. Null = invited but not yet in the group.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Membership means accepted
--
--    Every policy in 0016 routes through this, so this one line is what keeps a
--    pending invitee out of the thread, the roster and the read stamps.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_group_member(p_group uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group
      and m.user_id = p_user
      and m.accepted_at is not null
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Sending to the group requires an accepted SENDER
--
--    The recipient side stays deliberately status-blind: a program sent to the
--    group reaches everyone invited, so accepting later still hands you what
--    was sent while you were deciding.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.can_coach_in_group(p_sender uuid, p_recipient uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members s
    join public.group_members r on r.group_id = s.group_id
    join public.groups g on g.id = s.group_id
    where s.user_id = p_sender
      and r.user_id = p_recipient
      and p_sender <> p_recipient
      and (s.role = 'trainer' or g.owner_id = p_sender)
      and (s.accepted_at is not null or g.owner_id = p_sender)
  );
$$;

-- Same for authority over a group's sends (0026): a trainer who hasn't accepted
-- their own invite doesn't yet coach anything.
create or replace function public.coaches_group(p_user uuid, p_group uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group and g.owner_id = p_user
  ) or exists (
    select 1 from public.group_members m
    where m.group_id = p_group
      and m.user_id = p_user
      and m.role = 'trainer'
      and m.accepted_at is not null
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The roster reports who hasn't answered yet
--
--    Pending members are still LISTED — the owner needs to see that an invite
--    is outstanding, and a program send reads this roster. DROP first: Postgres
--    refuses CREATE OR REPLACE when the return columns change.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_group_members(uuid);
create function public.get_group_members(p_group uuid)
returns table (
  user_id    uuid,
  name       text,
  avatar_url text,
  is_owner   boolean,
  role       text,
  accepted   boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    m.user_id,
    p.name,
    p.avatar_url,
    (p.id = g.owner_id),
    m.role,
    (m.accepted_at is not null)
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
  order by (p.id = g.owner_id) desc, (m.accepted_at is not null) desc, p.name;
$$;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) The invites waiting for me
--
--    The ONLY thing a pending invitee can read about a group they haven't
--    joined, and it returns exactly what the invite card shows: the name, who
--    invited them, and how big the group is. No policy is widened to invitees,
--    so declining leaves them having seen nothing else.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_group_invites()
returns table (
  group_id     uuid,
  name         text,
  owner_id     uuid,
  owner_name   text,
  owner_avatar text,
  member_count integer,
  invited_at   timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    g.id,
    g.name,
    g.owner_id,
    o.name,
    o.avatar_url,
    (select count(*)::integer from public.group_members c
      where c.group_id = g.id and c.accepted_at is not null),
    m.added_at
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles o on o.id = g.owner_id
  where m.user_id = auth.uid()
    and m.accepted_at is null
  order by m.added_at desc;
$$;
grant execute on function public.get_my_group_invites() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Accept / decline
--
--    Accept has to be SECURITY DEFINER: group_members' only UPDATE policy is
--    owner-only (0022), so the invitee cannot stamp their own row directly.
--    Decline is a delete the invitee is already allowed to make, but goes
--    through an RPC too so it can refuse to touch an ACCEPTED row — declining
--    an invite and leaving a group you're in are different actions, and only
--    the second should be reachable from the group page.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.accept_group_invite(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'accept_group_invite: not authenticated';
  end if;
  update public.group_members
     set accepted_at = now()
   where group_id = p_group
     and user_id = v_uid
     and accepted_at is null;
  if not found then
    -- Already accepted, or never invited. Idempotent either way: a double tap
    -- on a slow connection must not read as an error.
    return;
  end if;
end;
$$;
grant execute on function public.accept_group_invite(uuid) to authenticated;

create or replace function public.decline_group_invite(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'decline_group_invite: not authenticated';
  end if;
  delete from public.group_members
   where group_id = p_group
     and user_id = v_uid
     and accepted_at is null;
end;
$$;
grant execute on function public.decline_group_invite(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) The owner joins their own group outright
--
--    Creating a group is consenting to it. Without this the creator would sit
--    pending in their own group and lock themselves out of it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'create_group: not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'create_group: name required';
  end if;

  insert into public.groups (owner_id, name) values (v_uid, trim(p_name)) returning id into v_id;
  insert into public.group_members (group_id, user_id, accepted_at)
    values (v_id, v_uid, now());

  foreach v_member in array coalesce(p_member_ids, '{}'::uuid[]) loop
    -- Silently skip anyone the caller is not actually connected to, rather than
    -- failing the whole create: the roster is derived client-side and can be a
    -- moment stale. Added members land PENDING (accepted_at stays null).
    if v_member <> v_uid and exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and ((c.requester_id = v_uid and c.addressee_id = v_member)
          or (c.requester_id = v_member and c.addressee_id = v_uid))
    ) then
      insert into public.group_members (group_id, user_id)
        values (v_id, v_member)
        on conflict do nothing;
    end if;
  end loop;

  return v_id;
end;
$$;
grant execute on function public.create_group(text, uuid[]) to authenticated;
