-- Group limits, take two (user decision, 2026-10-01): an account can create at
-- most 3 groups and be in at most 3 others, and a group holds at most 10
-- people.
--
-- 0035 counted one number, every group an account was in with the ones it
-- created included, at most 5. Creating and joining are separate limits now,
-- so someone running 3 groups can still be in 3 more. A group's size counts its
-- owner, its members and anyone invited who hasn't answered: an invite holds a
-- place, so nobody who taps Accept is ever told the group is full, and the
-- owner makes room by taking an invite back (or the invitee declining it).
-- Pending invites still don't count toward the groups someone is in.
--
-- All three are triggers, as 0035's was: groups and their rows can also be
-- written directly through the owner's policies, not just through create_group,
-- set_group_members and accept_group_invite, and a check in each function would
-- leave those open. Each fires only on what ADDS (a new group, a new person in
-- a group, an invite becoming a membership), so anyone already over a limit
-- keeps everything they have; they just can't add to it until they're under it.
--
-- The app checks first (MAX_OWNED_GROUPS, MAX_JOINED_GROUPS and
-- MAX_GROUP_MEMBERS in constants/groups.ts, keep them in step) so the prompt
-- comes before a form is filled in; these catch a stale list or a second phone.
-- The refusals are 'group_limit_reached' (creating or joining, as before) and
-- 'group_full', which lib/groups.ts turns into the prompts.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0035 (whose trigger now calls the function below).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Joining: at most 3 groups someone else created
--
--    Same trigger as 0035 (group_members_limit), counting differently. The
--    owner's own row is creating a group, not joining one, so it isn't counted
--    here or anywhere else in this function: section 2 counts the groups made.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_group_limit()
returns trigger
language plpgsql
-- The count must see every group the person is in. Under the caller's RLS an
-- owner adding someone would only count that person's rows in the owner's own
-- groups.
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is null then
    return new; -- an invite, not a membership
  end if;
  if tg_op = 'UPDATE' and old.accepted_at is not null and old.user_id = new.user_id then
    return new; -- already a membership; a re-stamp isn't joining
  end if;
  if exists (select 1 from public.groups g where g.id = new.group_id and g.owner_id = new.user_id) then
    return new; -- the owner's own row: their group, not one they're joining
  end if;

  -- Two accepts at once (two phones, two invites) must not both count 2 and
  -- both go through. One lock per person, released with the transaction.
  perform pg_advisory_xact_lock(hashtextextended('group_limit:' || new.user_id::text, 0));

  if (
    select count(*) from public.group_members m
      join public.groups g on g.id = m.group_id
     where m.user_id = new.user_id
       and m.accepted_at is not null
       and g.owner_id <> new.user_id
       and m.group_id <> new.group_id
  ) >= 3 then
    raise exception 'group_limit_reached'
      using hint = 'An account can be in at most 3 groups besides the ones it created.';
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Creating: at most 3 groups
--
--    On the group itself, before create_group adds the owner's row, so a
--    refused create leaves nothing behind. An owner can't hand a group to
--    someone else (groups' update policy pins owner_id to the caller), so only
--    a new group adds to the count.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_group_create_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Two creates at once (a double tap, two phones) must not both count 2.
  perform pg_advisory_xact_lock(hashtextextended('group_create:' || new.owner_id::text, 0));

  if (select count(*) from public.groups g where g.owner_id = new.owner_id) >= 3 then
    raise exception 'group_limit_reached'
      using hint = 'An account can create at most 3 groups.';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_create_limit on public.groups;
create trigger groups_create_limit
  before insert on public.groups
  for each row execute function public.enforce_group_create_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) A group's size: at most 10 people, invites included
--
--    Every row counts: the owner's, each member's, each pending invite's.
--    Accepting an invite is an update of a row already counted, so it never
--    trips this; only a new person does.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_group_size()
returns trigger
language plpgsql
-- The count must see the whole group, whoever is adding to it.
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.group_id = new.group_id then
    return new; -- still the same group's row
  end if;
  -- Already in the group: set_group_members re-inserts everyone it keeps, and
  -- each of those conflicts and does nothing. Counted, they refused every save
  -- of a full group, a rename or a new photo included.
  if exists (select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = new.user_id) then
    return new;
  end if;

  -- Two additions at once (two phones) must not both count 9 and both go in.
  perform pg_advisory_xact_lock(hashtextextended('group_size:' || new.group_id::text, 0));

  if (select count(*) from public.group_members m where m.group_id = new.group_id) >= 10 then
    raise exception 'group_full'
      using hint = 'A group can hold at most 10 people, its owner and pending invites included.';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_size on public.group_members;
create trigger group_members_size
  before insert or update of group_id on public.group_members
  for each row execute function public.enforce_group_size();
