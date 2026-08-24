-- Client groups + group chat (Trainer hub).
--
-- A trainer creates a group, puts some of their connected clients in it, and
-- the group gets its own shared thread that EVERY member can post to (unlike
-- the 1:1 threads in 0011, and unlike a broadcast, which is just N private
-- messages). Sending a program to a group reuses 0013 unchanged: the client
-- expands the group to its member ids and inserts one shared_programs row per
-- member, so the existing batch grouping and accept/unsend flows still work.
--
-- Why not reuse public.messages: its insert policy hard-requires an accepted
-- 1:1 connection between sender and recipient (group members are generally NOT
-- connected to each other), chat_reads keys on peer_id REFERENCES auth.users
-- (a group id is not a user), and the realtime filter is recipient_id=eq.<uid>,
-- which cannot express "any group I belong to".
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0006 (connections) and 0012 (send_expo_push).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists groups_owner on public.groups (owner_id, created_at);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

create table if not exists public.group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists group_messages_group_time on public.group_messages (group_id, created_at);

create table if not exists public.group_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Membership helper
--
--    SECURITY DEFINER so it reads group_members with RLS bypassed. Every policy
--    below asks "is this user in this group?" — and group_members' own SELECT
--    policy is exactly that question, so calling it inline would make Postgres
--    recurse infinitely ("infinite recursion detected in policy"). Routing the
--    check through a definer function is the standard way out.
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
    where m.group_id = p_group and m.user_id = p_user
  );
$$;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

-- Owner of a group, likewise read without RLS so member-side policies can check
-- "is the owner connected to this person?" without being able to see groups.
create or replace function public.group_owner(p_group uuid)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select g.owner_id from public.groups g where g.id = p_group;
$$;
grant execute on function public.group_owner(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_reads    enable row level security;

do $$
begin
  -- groups: any member (incl. the owner) can read it; only the owner creates,
  -- renames or deletes. Wrapped auth.uid() so it is evaluated once per query
  -- rather than once per row.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='groups_select') then
    create policy groups_select on public.groups
      for select using (
        owner_id = (select auth.uid())
        or public.is_group_member(id, (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='groups_insert') then
    create policy groups_insert on public.groups
      for insert with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='groups_update') then
    create policy groups_update on public.groups
      for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='groups' and policyname='groups_delete') then
    create policy groups_delete on public.groups
      for delete using (owner_id = (select auth.uid()));
  end if;

  -- group_members: members see the whole roster (that is what makes a group
  -- chat legible — you can see who else is in it). Only the owner adds people,
  -- and only people they already have an ACCEPTED connection with, so a group
  -- can never be used to pull in strangers. The owner may remove anyone; a
  -- member may remove themselves (leave).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and policyname='group_members_select') then
    create policy group_members_select on public.group_members
      for select using (
        user_id = (select auth.uid())
        or public.is_group_member(group_id, (select auth.uid()))
        or public.group_owner(group_id) = (select auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and policyname='group_members_insert') then
    create policy group_members_insert on public.group_members
      for insert with check (
        public.group_owner(group_id) = (select auth.uid())
        and (
          user_id = (select auth.uid())  -- the owner's own membership row
          or exists (
            select 1 from public.connections c
            where c.status = 'accepted'
              and ((c.requester_id = (select auth.uid()) and c.addressee_id = user_id)
                or (c.requester_id = user_id and c.addressee_id = (select auth.uid())))
          )
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_members' and policyname='group_members_delete') then
    create policy group_members_delete on public.group_members
      for delete using (
        user_id = (select auth.uid())                              -- leave
        or public.group_owner(group_id) = (select auth.uid())      -- owner removes
      );
  end if;

  -- group_messages: members read the thread and post to it; you may only post
  -- as yourself, and only while you are still a member. Authors delete their
  -- own; the owner can delete anything in their group (moderation).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_messages' and policyname='group_messages_select') then
    create policy group_messages_select on public.group_messages
      for select using (public.is_group_member(group_id, (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_messages' and policyname='group_messages_insert') then
    create policy group_messages_insert on public.group_messages
      for insert with check (
        sender_id = (select auth.uid())
        and public.is_group_member(group_id, (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_messages' and policyname='group_messages_delete') then
    create policy group_messages_delete on public.group_messages
      for delete using (
        sender_id = (select auth.uid())
        or public.group_owner(group_id) = (select auth.uid())
      );
  end if;

  -- group_reads: your own stamps only.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='group_reads' and policyname='group_reads_own') then
    create policy group_reads_own on public.group_reads
      for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Member profiles for a group
--
--    Group members are generally NOT connected to each other, so they cannot
--    read each other's rows through get_my_connections(). This returns just the
--    SAFE display fields (name + photo) for a group the caller belongs to, so
--    the roster and message authorship can render.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_group_members(p_group uuid)
returns table (
  user_id    uuid,
  name       text,
  avatar_url text,
  is_owner   boolean
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
    (p.id = g.owner_id)
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group, auth.uid())
  order by (p.id = g.owner_id) desc, p.name;
$$;
grant execute on function public.get_group_members(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Create a group with its members in one atomic call
--
--    The owner's own membership row is inserted too, so the owner reads the
--    thread through exactly the same is_group_member() path as everyone else.
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
  insert into public.group_members (group_id, user_id) values (v_id, v_uid);

  foreach v_member in array coalesce(p_member_ids, '{}'::uuid[]) loop
    -- Silently skip anyone the caller is not actually connected to, rather than
    -- failing the whole create: the roster is derived client-side and can be a
    -- moment stale.
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

-- Replace a group's membership wholesale (the manage-members screen saves the
-- full list). Owner-only; the owner's own row is always preserved.
create or replace function public.set_group_members(p_group uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'set_group_members: not authenticated';
  end if;
  if public.group_owner(p_group) is distinct from v_uid then
    raise exception 'set_group_members: not the group owner';
  end if;

  delete from public.group_members m
   where m.group_id = p_group
     and m.user_id <> v_uid
     and not (m.user_id = any (coalesce(p_member_ids, '{}'::uuid[])));

  foreach v_member in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_member <> v_uid and exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and ((c.requester_id = v_uid and c.addressee_id = v_member)
          or (c.requester_id = v_member and c.addressee_id = v_uid))
    ) then
      insert into public.group_members (group_id, user_id)
        values (p_group, v_member)
        on conflict do nothing;
    end if;
  end loop;
end;
$$;
grant execute on function public.set_group_members(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Push — fan out to every member except the sender (category coachMessages)
-- ─────────────────────────────────────────────────────────────────────────────
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
  loop
    perform public.send_expo_push(
      v_member,
      'coachMessages',
      coalesce(nullif(trim(v_group), ''), 'Group'),
      coalesce(nullif(trim(v_sender), ''), 'Someone') || ': ' || left(new.body, 120),
      jsonb_build_object('url', '/trainer/group/' || new.group_id)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists group_messages_push on public.group_messages;
create trigger group_messages_push
  after insert on public.group_messages
  for each row execute function public.notify_new_group_message();

-- Keep groups.updated_at fresh (reuses 0001's set_updated_at).
drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Realtime — live delivery for an open group thread. Postgres Changes
--    respects group_messages_select, so a subscriber only ever receives rows
--    from groups they belong to.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
     ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;
