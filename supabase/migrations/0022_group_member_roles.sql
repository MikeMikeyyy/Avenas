-- Roles inside a group: the owner can promote members to trainer.
--
-- Three roles, only two of them stored:
--   owner   — derived from groups.owner_id, never in this column
--   trainer — promoted by the owner; can send programs to the group and to
--             individuals in it, but cannot change the roster
--   member  — the default
--
-- Promotion is owner-only. group_members had no UPDATE policy at all, so every
-- client write to it was denied; this adds a narrow one rather than opening the
-- table up.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0013 (shared_programs) and 0016 (groups).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.group_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.group_members'::regclass and conname = 'group_members_role_check'
  ) then
    alter table public.group_members
      add constraint group_members_role_check check (role in ('member', 'trainer'));
  end if;
end $$;

comment on column public.group_members.role is
  'member | trainer. The OWNER is not represented here — they are groups.owner_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Owner-only role changes
--
--    with check pins group_id and user_id as well, so an owner cannot use the
--    update to move a row into a group they do not own.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'group_members' and policyname = 'group_members_update'
  ) then
    create policy group_members_update on public.group_members
      for update
      using (public.group_owner(group_id) = (select auth.uid()))
      with check (public.group_owner(group_id) = (select auth.uid()));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Can `p_sender` coach `p_recipient`?
--
--    True when they share a group in which the sender is the owner or a
--    trainer. SECURITY DEFINER because it is called from an RLS policy on
--    shared_programs: a plain sub-select there would be evaluated under
--    group_members' own RLS and silently return nothing.
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
  );
$$;
grant execute on function public.can_coach_in_group(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Let a group's trainers send programs to its members
--
--    0013 required an accepted 1:1 CONNECTION between sender and recipient.
--    Members of a group are generally not connected to each other, so a
--    promoted trainer would be refused at the database. This adds the group
--    route alongside the connection route; sending to someone you neither
--    share a group with nor are connected to is still refused.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists shared_programs_insert on public.shared_programs;
create policy shared_programs_insert on public.shared_programs
  for insert with check (
    (select auth.uid()) = sender_id
    and sender_id <> recipient_id
    and (
      exists (
        select 1 from public.connections c
        where c.status = 'accepted'
          and ((c.requester_id = sender_id and c.addressee_id = recipient_id)
            or (c.requester_id = recipient_id and c.addressee_id = sender_id))
      )
      or public.can_coach_in_group(sender_id, recipient_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) get_group_members now returns the role
--
--    DROP first: Postgres refuses CREATE OR REPLACE when the return columns
--    change.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_group_members(uuid);
create function public.get_group_members(p_group uuid)
returns table (
  user_id    uuid,
  name       text,
  avatar_url text,
  is_owner   boolean,
  role       text
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
    m.role
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
  -- Owner first, then trainers, then members; alphabetical within each.
  order by (p.id = g.owner_id) desc, (m.role = 'trainer') desc, p.name;
$$;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Promote / demote (owner only)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_group_member_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'set_group_member_role: not authenticated';
  end if;
  if public.group_owner(p_group) is distinct from v_uid then
    raise exception 'set_group_member_role: not the group owner';
  end if;
  if p_role not in ('member', 'trainer') then
    raise exception 'set_group_member_role: invalid role %', p_role;
  end if;
  -- The owner's own row is left alone: their status comes from groups.owner_id,
  -- and writing a role there would imply it could be taken away.
  if p_user = v_uid then
    return;
  end if;

  update public.group_members
     set role = p_role
   where group_id = p_group and user_id = p_user;
end;
$$;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
