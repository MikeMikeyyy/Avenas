-- Adding someone from a group, and a group's trainers being trainer accounts
-- (user decisions, 2026-11-20).
--
-- Connecting took a connect code (0006), and people in a group don't have each
-- other's. Now a member's sheet on a group's page asks them from the group,
-- through request_group_connection: a trainer account may ask anyone in a
-- group they're both in, a gym user only a trainer account (a connection
-- between two gym users does nothing, 0041). "Trainer" is the ACCOUNT TYPE,
-- never the group role. Both must have joined: an invitee hasn't agreed to be
-- among these people yet. It is the same request a code sends, accepted or
-- declined on the Connect screen, under the same 10-a-minute limit, counted
-- together with it (0050).
--
-- A declined request stands. Asked again from a group, it isn't sent (the
-- sheet goes on reading "Request sent", so whoever said no isn't asked
-- again); the person who declined may ask instead, which clears their decline,
-- and if THAT is declined it's the first person's turn. Connecting by code
-- still re-sends a declined request, as it always has.
--
-- Only a trainer account can be made a trainer of a group. The owner's "Make a
-- trainer" on a gym user says so; the database refuses it whatever asks; gym
-- users who are trainers of a group go back to members here; and switching to
-- a gym account (change_account_type) takes the role away in every group.
--
-- Two holes the rules above wouldn't hold against without this:
--   * connections could be written straight through the API. Any account could
--     insert an ACCEPTED connection with anyone by their id, and a trainer
--     could then read that person's training (0032); someone a request was
--     addressed to could re-point its requester at someone else and accept it.
--     Every write now goes through the functions (request_connection,
--     request_group_connection, respond_connection). Deleting (cancel a
--     request, remove a connection) is still either side's, except a declined
--     request, whose decline would go with it.
--   * group_members could be written straight through the API by a group's
--     owner: a membership inserted already accepted, or an invite accepted on
--     the invitee's behalf, when joining is the invitee's own act (0027). Every
--     write now goes through create_group, set_group_members,
--     set_group_member_role, accept_group_invite and decline_group_invite;
--     leaving, and an owner taking someone out, still delete.
--   The app never wrote either table directly (only its deletes), so no build
--   in anyone's hands is affected.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Connections are written only by the functions
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists connections_insert on public.connections;
drop policy if exists connections_update on public.connections;
drop policy if exists connections_delete on public.connections;
-- Cancelling a request or removing a connection, from either side. Never a
-- declined request: deleting it would take the decline with it, and whoever
-- asked could ask again.
create policy connections_delete on public.connections
  for delete using (
    (select auth.uid()) in (requester_id, addressee_id)
    and status <> 'declined'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) A decline stands until the other person asks
-- ─────────────────────────────────────────────────────────────────────────────

-- A connection's filings (0041) go when the connection does, and only then. A
-- declined request between the same two people, cleared away below while an
-- accepted connection stands beside it, isn't the connection going.
create or replace function public.forget_connection_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.connections c
     where c.status = 'accepted'
       and ((c.requester_id = old.requester_id and c.addressee_id = old.addressee_id)
         or (c.requester_id = old.addressee_id and c.addressee_id = old.requester_id))
  ) then
    return old;
  end if;
  delete from public.connection_roles r
   where (r.owner_id = old.requester_id and r.other_id = old.addressee_id)
      or (r.owner_id = old.addressee_id and r.other_id = old.requester_id);
  return old;
end;
$$;

-- Someone who declined a request, asking the person themselves (or the two
-- connecting any other way), has answered their own decline: it goes. That
-- leaves at most one request between two people, and the next ask with
-- whoever declined last. Every path that asks or accepts gets this, a code's
-- included.
create or replace function public.clear_answered_decline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('pending', 'accepted') then
    delete from public.connections c
     where c.requester_id = new.addressee_id
       and c.addressee_id = new.requester_id
       and c.status = 'declined';
  end if;
  return null;
end;
$$;

drop trigger if exists connections_clear_answered_decline on public.connections;
create trigger connections_clear_answered_decline
  after insert or update of status on public.connections
  for each row execute function public.clear_answered_decline();

-- The declines already answered before this: one with a request or a
-- connection the other way since, and the older of two declines between the
-- same two people. Left, either would keep someone from asking from a group.
delete from public.connections d
 using public.connections o
 where d.status = 'declined'
   and o.requester_id = d.addressee_id
   and o.addressee_id = d.requester_id
   and (o.status <> 'declined'
        or (coalesce(o.responded_at, o.created_at), o.id) > (coalesce(d.responded_at, d.created_at), d.id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Asking someone in a group
--
--    Answers the app turns into words (lib/groups.ts, utils/groupConnect.ts):
--      requested     sent; or already waiting on them; or declined by them,
--                    which reads the same and sends nothing
--      connected     they'd asked me, and this accepted it
--      already       connected already
--      not_member    one of us isn't (or is no longer) in the group, joined
--      not_allowed   two gym users
--      self          me
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.request_group_connection(p_group uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_recent_count   integer;
  v_max_per_minute constant integer := 10;
  v_mine           text;
  v_theirs         text;
begin
  if v_uid is null then
    raise exception 'request_group_connection: not authenticated';
  end if;

  -- request_connection's limit (0050), in the same count.
  delete from public.connection_request_attempts
    where user_id = v_uid and attempted_at < now() - interval '1 minute';
  select count(*) into v_recent_count
    from public.connection_request_attempts
    where user_id = v_uid;
  if v_recent_count >= v_max_per_minute then
    raise exception 'rate limit: too many connection requests, try again in a minute';
  end if;
  insert into public.connection_request_attempts (user_id) values (v_uid);

  if p_user is null or p_user = v_uid then
    return 'self';
  end if;

  -- Both joined: is_group_member is an accepted membership (0027).
  if not (public.is_group_member(p_group, v_uid) and public.is_group_member(p_group, p_user)) then
    return 'not_member';
  end if;

  select p.account_type into v_mine from public.profiles p where p.id = v_uid;
  select p.account_type into v_theirs from public.profiles p where p.id = p_user;
  if v_mine is distinct from 'pt' and v_theirs is distinct from 'pt' then
    return 'not_allowed';
  end if;

  if exists (
    select 1 from public.connections c
     where c.status = 'accepted'
       and ((c.requester_id = v_uid and c.addressee_id = p_user)
         or (c.requester_id = p_user and c.addressee_id = v_uid))
  ) then
    return 'already';
  end if;

  -- They asked me: this is my yes.
  update public.connections c
     set status = 'accepted', responded_at = now()
   where c.requester_id = p_user and c.addressee_id = v_uid and c.status = 'pending';
  if found then
    return 'connected';
  end if;

  -- Mine is already with them, waiting or declined. A declined one isn't sent
  -- again from here; it's theirs to ask now.
  if exists (
    select 1 from public.connections c
     where c.requester_id = v_uid and c.addressee_id = p_user
  ) then
    return 'requested';
  end if;

  insert into public.connections (requester_id, addressee_id, status)
  values (v_uid, p_user, 'pending');
  return 'requested';
end;
$$;
grant execute on function public.request_group_connection(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The roster says what each member's account is, and where I stand with them
--
--    account_type decides what a member's sheet offers: who may be asked from
--    the group, and who may be made a trainer of it. connection is mine with
--    them: 'connected', 'incoming' (they've asked me), 'requested' (I've asked
--    them, waiting or declined: a decline reads as still waiting to the one
--    declined), or null (nothing, or me). DROP first: Postgres refuses CREATE
--    OR REPLACE when the return columns change.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_group_members(uuid);
create function public.get_group_members(p_group uuid)
returns table (
  user_id      uuid,
  name         text,
  avatar_url   text,
  is_owner     boolean,
  role         text,
  accepted     boolean,
  account_type text,
  connection   text
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
    (m.accepted_at is not null),
    p.account_type,
    case
      when m.user_id = auth.uid() then null
      when exists (
        select 1 from public.connections c
         where c.status = 'accepted'
           and ((c.requester_id = auth.uid() and c.addressee_id = m.user_id)
             or (c.requester_id = m.user_id and c.addressee_id = auth.uid()))
      ) then 'connected'
      when exists (
        select 1 from public.connections c
         where c.requester_id = m.user_id and c.addressee_id = auth.uid() and c.status = 'pending'
      ) then 'incoming'
      when exists (
        select 1 from public.connections c
         where c.requester_id = auth.uid() and c.addressee_id = m.user_id
           and c.status in ('pending', 'declined')
      ) then 'requested'
    end
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
  order by (p.id = g.owner_id) desc, (m.accepted_at is not null) desc, p.name;
$$;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) A group's trainers are trainer accounts
-- ─────────────────────────────────────────────────────────────────────────────

-- Gym users made trainers of a group before this go back to members. What
-- they sent the group stays where it is.
update public.group_members m
   set role = 'member'
  from public.profiles p
 where p.id = m.user_id
   and m.role = 'trainer'
   and p.account_type <> 'pt';

-- Whatever asks: set_group_member_role, or anything to come. Only when the
-- role is being GIVEN, so a trainer row is never refused something else (an
-- invite accepted) over an account type that moved after it.
-- 'not_a_trainer_account' is what lib/groups.ts turns into the prompt.
create or replace function public.enforce_group_trainer_account()
returns trigger
language plpgsql
-- profiles is owner-only (0006): the check must read the member's.
security definer
set search_path = ''
as $$
begin
  if new.role = 'trainer'
     and (tg_op = 'INSERT' or old.role is distinct from 'trainer' or old.user_id is distinct from new.user_id)
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.account_type = 'pt') then
    raise exception 'not_a_trainer_account'
      using hint = 'Only a trainer account can be a trainer in a group.';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_trainer_account on public.group_members;
create trigger group_members_trainer_account
  before insert or update on public.group_members
  for each row execute function public.enforce_group_trainer_account();

-- The switch (0041's), now also taking a gym account out of the trainer role
-- in other people's groups. Unchanged otherwise.
create or replace function public.change_account_type(p_account_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_old       text;
  v_name      text;
  r           record;
  v_role      text;
  v_kind      text;
  v_withdrawn integer;
  v_inserted  integer;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_account_type is null or p_account_type not in ('pt', 'user') then
    raise exception 'unknown account type';
  end if;

  select p.account_type, p.name into v_old, v_name
    from public.profiles p where p.id = v_uid
    for update;
  if not found then
    raise exception 'no profile';
  end if;

  update public.profiles set account_type = p_account_type where id = v_uid;
  if v_old = p_account_type then
    return;
  end if;

  -- My own notes were about the account I'm leaving.
  delete from public.connection_notices n where n.user_id = v_uid;

  if v_old = 'pt' then
    -- ── Trainer → Gym User ──────────────────────────────────────────────────
    delete from public.groups g where g.owner_id = v_uid;
    -- Nor is it a trainer in anyone else's: only a trainer account can be one
    -- (0063). What it sent those groups stays.
    update public.group_members m set role = 'member'
     where m.user_id = v_uid and m.role = 'trainer';
    delete from public.shared_programs s where s.sender_id = v_uid and s.kind = 'share';
    -- A gym account files nothing: its trainers are simply the trainer
    -- accounts it's connected with.
    delete from public.connection_roles cr where cr.owner_id = v_uid;

    for r in
      select c.id as connection_id, o.id as other_id, o.account_type as other_type
        from public.connections c
        join public.profiles o
          on o.id = case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
       where (c.requester_id = v_uid or c.addressee_id = v_uid)
         and c.status = 'accepted'
    loop
      -- Reviews they asked me for that never came back: nobody can answer
      -- them now.
      with gone as (
        delete from public.shared_programs s
         where s.recipient_id = v_uid and s.sender_id = r.other_id
           and s.kind = 'review' and s.group_id is null and s.returned_at is null
        returning 1
      )
      select count(*)::integer into v_withdrawn from gone;

      v_kind := null;
      if r.other_type = 'pt' then
        select cr.role into v_role
          from public.connection_roles cr
         where cr.owner_id = r.other_id and cr.other_id = v_uid;
        if v_role = 'client' then
          -- I was only their client, which a gym account can still be.
          if v_withdrawn > 0 then v_kind := 'ex_trainer_client'; end if;
        elsif v_role = 'both' then
          update public.connection_roles cr set role = 'client', updated_at = now()
           where cr.owner_id = r.other_id and cr.other_id = v_uid;
          v_kind := 'ex_trainer_client';
        else
          -- Their trainer only (or never decided, which read as trainer): out
          -- of My Trainers, and not into My Clients until they say so. A
          -- 'trainer' row on a gym account is exactly that pending state.
          insert into public.connection_roles (owner_id, other_id, role)
          values (r.other_id, v_uid, 'trainer')
          on conflict (owner_id, other_id) do update set role = 'trainer', updated_at = now();
          v_kind := 'ex_trainer_choose';
        end if;
      else
        delete from public.connections c where c.id = r.connection_id;
        v_kind := 'ex_trainer_gone';
      end if;

      if v_kind is not null then
        insert into public.connection_notices (user_id, other_id, kind, other_name, withdrawn_reviews)
        values (r.other_id, v_uid, v_kind, v_name, v_withdrawn)
        on conflict (user_id, other_id) do update
          set kind = excluded.kind, other_name = excluded.other_name,
              withdrawn_reviews = excluded.withdrawn_reviews, created_at = now();
      end if;
    end loop;

    -- Anything still waiting on me, from someone I'm no longer connected to:
    -- deleting my groups above turned their group reviews into reviews
    -- addressed to me alone (0026 nulls a deleted group's rows).
    delete from public.shared_programs s
     where s.recipient_id = v_uid and s.kind = 'review' and s.returned_at is null;

  else
    -- ── Gym User → Trainer ──────────────────────────────────────────────────
    for r in
      select o.id as other_id, o.account_type as other_type
        from public.connections c
        join public.profiles o
          on o.id = case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
       where (c.requester_id = v_uid or c.addressee_id = v_uid)
         and c.status = 'accepted'
    loop
      v_kind := null;
      if r.other_type = 'pt' then
        -- They were coaching me: they're still my trainer.
        insert into public.connection_roles (owner_id, other_id, role)
        values (v_uid, r.other_id, 'trainer')
        on conflict (owner_id, other_id) do nothing;
        -- And I'm still their client, rather than moving to their My Trainers.
        insert into public.connection_roles (owner_id, other_id, role)
        values (r.other_id, v_uid, 'client')
        on conflict (owner_id, other_id) do nothing;
        get diagnostics v_inserted = row_count;
        select cr.role into v_role
          from public.connection_roles cr
         where cr.owner_id = r.other_id and cr.other_id = v_uid;
        if v_inserted > 0 or v_role = 'client' then
          v_kind := 'new_trainer_client';
        else
          -- Filed as their trainer already (I was one before): I'm simply back,
          -- and any note about my leaving is out of date.
          delete from public.connection_notices n
           where n.user_id = r.other_id and n.other_id = v_uid;
        end if;
      else
        v_kind := 'new_trainer';
      end if;

      if v_kind is not null then
        insert into public.connection_notices (user_id, other_id, kind, other_name, withdrawn_reviews)
        values (r.other_id, v_uid, v_kind, v_name, 0)
        on conflict (user_id, other_id) do update
          set kind = excluded.kind, other_name = excluded.other_name,
              withdrawn_reviews = 0, created_at = now();
      end if;
    end loop;
  end if;
end;
$$;

grant execute on function public.change_account_type(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Group memberships are written only by the functions
--
--    The owner's insert (0016) and update (0022) policies go. Leaving, and an
--    owner taking someone out, keep group_members_delete.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists group_members_insert on public.group_members;
drop policy if exists group_members_update on public.group_members;

notify pgrst, 'reload schema';
