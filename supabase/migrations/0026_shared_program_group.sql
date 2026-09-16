-- The group a program share was sent to, when it came from a group's Send
-- Program rather than a direct send.
--
-- A group send still writes ONE row per member, which is what drives the
-- per-recipient "hasn't opened it yet" list. Without this column those rows are
-- anonymous: nothing ties them back to the group, so the group's own page can't
-- list what has been sent to it and the trainer hub can't say where a send went.
--
-- Nullable, and null on every existing row, which reads as "sent individually".
-- There is no backfill because the information was never recorded.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a group must not delete the
-- programs its members were sent. Those shares stay valid, they just stop being
-- attributed to a group.
--
-- Safe to run more than once.

alter table public.shared_programs
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists shared_programs_group on public.shared_programs (group_id)
  where group_id is not null;

comment on column public.shared_programs.group_id is
  'Group this share was sent to, or null for a direct send. One row per member either way.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Does `p_user` coach `p_group`? (owner, or a member promoted to trainer)
--
-- `can_coach_in_group` from 0022 answers "can A coach B", which needs a pair.
-- A group send is addressed to the GROUP, and the question the policies below
-- ask is about one person and one group — a coach's authority over a send comes
-- from the group it went to, not from who happened to receive it.
--
-- SECURITY DEFINER for the same reason as 0022's helper: called from an RLS
-- policy, a plain sub-select would run under group_members' own RLS and come
-- back empty.
-- ─────────────────────────────────────────────────────────────────────────────
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
    where m.group_id = p_group and m.user_id = p_user and m.role = 'trainer'
  );
$$;
grant execute on function public.coaches_group(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- A group's coaches can see and remove what was sent to their group
--
-- 0013 scoped both policies to the two parties on the row, which is right for a
-- direct send but leaves a co-trainer unable to do anything about a program in
-- a group they run: they can't see the other members' rows, so the group page
-- reads "0 of 1 opened" to them, and a delete would silently take only their
-- own copy while the program stayed in the group for everyone else.
--
-- Widened only for rows that carry a group_id, so a direct send is untouched.
-- UPDATE deliberately stays as it was: accepting stamps your own row, and a
-- coach has no business editing someone else's acceptance.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists shared_programs_select on public.shared_programs;
create policy shared_programs_select on public.shared_programs
  for select using (
    (select auth.uid()) in (sender_id, recipient_id)
    or (group_id is not null and public.coaches_group((select auth.uid()), group_id))
  );

drop policy if exists shared_programs_delete on public.shared_programs;
create policy shared_programs_delete on public.shared_programs
  for delete using (
    (select auth.uid()) = sender_id
    or (group_id is not null and public.coaches_group((select auth.uid()), group_id))
  );
