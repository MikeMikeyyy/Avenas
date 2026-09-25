-- One account can be in at most 5 groups, counting the groups it created.
--
-- An owner is an accepted member of their own group (create_group inserts their
-- row accepted, 0027), so "groups I own or have joined" is one number: my
-- ACCEPTED group_members rows. Pending invites don't count. The limit is checked
-- when an invite is ACCEPTED, not when it's sent, so an owner can still invite
-- anyone and learns nothing about how many groups they're in; an invitee at the
-- limit keeps the invite and can accept it once they've left a group.
--
-- A trigger rather than a check in create_group and accept_group_invite: a row
-- can also become accepted through a direct write (the owner's insert and update
-- policies on group_members), and a check in each RPC would leave those open.
-- It fires only when a row BECOMES accepted, so anyone already over the limit
-- keeps every group they're in; they just can't create or join another until
-- they're under it.
--
-- The app checks first (MAX_GROUPS in constants/groups.ts, keep the two in step)
-- so the prompt comes before a form is filled in. This is what catches a stale
-- list or a second phone. The refusal's message is exactly 'group_limit_reached',
-- which the app (isGroupLimitError in lib/groups.ts) turns into the same prompt.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0016 (groups) and 0027 (accepted_at).

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

  -- Two accepts at once (two phones, two invites) must not both count 4 and
  -- both go through. One lock per person, released with the transaction.
  perform pg_advisory_xact_lock(hashtextextended('group_limit:' || new.user_id::text, 0));

  if (
    select count(*) from public.group_members m
     where m.user_id = new.user_id
       and m.accepted_at is not null
       and m.group_id <> new.group_id
  ) >= 5 then
    raise exception 'group_limit_reached'
      using hint = 'An account can be in at most 5 groups, including the ones it created.';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_limit on public.group_members;
create trigger group_members_limit
  before insert or update of accepted_at, user_id on public.group_members
  for each row execute function public.enforce_group_limit();
