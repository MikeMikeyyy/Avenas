-- How a trainer files each trainer they're connected with, and what everyone's
-- lists do when someone switches account type.
--
-- Connecting is role-blind (0006): where a person appears is worked out from
-- their account type (utils/roster.ts). For a TRAINER connected to another
-- trainer that was always "My Trainers", with "also my client" an opt-in kept
-- on the phone alone, so a new phone lost it. Now:
--
--   1. connection_roles records how an account files a connection: trainer,
--      client or both. The owner's alone, and it follows them to a new phone.
--      A trainer-account connection with no row hasn't been decided yet (the
--      app asks); existing trainer-to-trainer connections are backfilled below
--      as 'trainer', which is how they read until now.
--
--   2. change_account_type is the Profile screen's switch, and the one place
--      the consequences happen, for every device at once:
--
--      Trainer → Gym User
--        - their groups and the programs they sent are deleted (the app did
--          this on the phone; now it can't be half done);
--        - reviews people asked them for and never got back are withdrawn;
--        - gym users they coached are disconnected (nothing uses a gym user to
--          gym user connection) and left a note;
--        - a trainer who had them as a trainer only: taken out of My Trainers
--          and NOT dropped into My Clients; their note asks "keep as client or
--          remove". As 'both': they stay a client, with a note. As 'client'
--          only: nothing changes for them.
--
--      Gym User → Trainer
--        - trainers who coached them keep them as a client ('client' row)
--          instead of losing them to My Trainers, with a note offering "also
--          my trainer";
--        - their own trainers are filed as trainers, so they aren't asked;
--        - gym users connected to them see them arrive in My Trainers, with a
--          note.
--
--      Deliberately NOT a trigger on profiles.account_type: lib/cloud.ts's
--      reconcileAccountType rewrites that column from the phone's saved value
--      on every launch to repair drift, and a stale phone must never sever
--      someone's clients. Only the explicit, confirmed switch runs this.
--
--   3. connection_notices are those notes: one per (reader, person), readable
--      and dismissable by the reader only, written only by change_account_type.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) How each account files its connections
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.connection_roles (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  other_id   uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('trainer', 'client', 'both')),
  updated_at timestamptz not null default now(),
  primary key (owner_id, other_id),
  check (owner_id <> other_id)
);

alter table public.connection_roles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_roles' and policyname='connection_roles_select') then
    create policy connection_roles_select on public.connection_roles
      for select using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_roles' and policyname='connection_roles_insert') then
    create policy connection_roles_insert on public.connection_roles
      for insert with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_roles' and policyname='connection_roles_update') then
    create policy connection_roles_update on public.connection_roles
      for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_roles' and policyname='connection_roles_delete') then
    create policy connection_roles_delete on public.connection_roles
      for delete using (owner_id = (select auth.uid()));
  end if;
end $$;

-- A connection that goes takes both sides' filing with it, so connecting again
-- later is a fresh start (and asks again) rather than an old choice resurfacing.
create or replace function public.forget_connection_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.connection_roles r
   where (r.owner_id = old.requester_id and r.other_id = old.addressee_id)
      or (r.owner_id = old.addressee_id and r.other_id = old.requester_id);
  return old;
end;
$$;

drop trigger if exists connections_forget_roles on public.connections;
create trigger connections_forget_roles
  after delete on public.connections
  for each row execute function public.forget_connection_roles();

-- Existing trainer-to-trainer connections read as 'trainer' until now; keep
-- that, both ways, so nobody is asked about a connection they already have.
insert into public.connection_roles (owner_id, other_id, role)
select s.owner_id, s.other_id, 'trainer'
  from (
    select c.requester_id as owner_id, c.addressee_id as other_id
      from public.connections c
      join public.profiles a on a.id = c.requester_id
      join public.profiles b on b.id = c.addressee_id
     where c.status = 'accepted' and a.account_type = 'pt' and b.account_type = 'pt'
    union
    select c.addressee_id, c.requester_id
      from public.connections c
      join public.profiles a on a.id = c.requester_id
      join public.profiles b on b.id = c.addressee_id
     where c.status = 'accepted' and a.account_type = 'pt' and b.account_type = 'pt'
  ) s
on conflict (owner_id, other_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Notes left when someone switches account type
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.connection_notices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,  -- who reads it
  other_id          uuid not null references auth.users(id) on delete cascade,  -- who it's about
  kind              text not null check (kind in (
                      'ex_trainer_choose',   -- your trainer is now a gym user: keep as client, or remove
                      'ex_trainer_client',   -- ...no longer your trainer, still your client
                      'ex_trainer_gone',     -- ...and you've been disconnected
                      'new_trainer_client',  -- your client now has a trainer account: also your trainer?
                      'new_trainer'          -- someone you're connected with is now a trainer
                    )),
  -- Their name at the time: once disconnected, their profile isn't the
  -- reader's to look up.
  other_name        text,
  -- Reviews the reader had asked them for, withdrawn by the switch.
  withdrawn_reviews integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (user_id, other_id)
);

alter table public.connection_notices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_notices' and policyname='connection_notices_select') then
    create policy connection_notices_select on public.connection_notices
      for select using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connection_notices' and policyname='connection_notices_delete') then
    create policy connection_notices_delete on public.connection_notices
      for delete using (user_id = (select auth.uid()));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) The switch
-- ─────────────────────────────────────────────────────────────────────────────
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

notify pgrst, 'reload schema';
