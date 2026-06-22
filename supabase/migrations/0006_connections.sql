-- Real account-to-account connections (Trainer Phase 2, Slice 1).
--
-- Every profile gets a short shareable `connect_code` (shown as a QR + text on the
-- Connect screen). Connecting is a request → accept handshake recorded in the
-- `connections` table. Profiles stay owner-only in RLS; a connected user's *safe*
-- fields (name, avatar_url, account_type) are exposed only through the
-- get_my_connections() security-definer RPC — never the whole profile row.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (adds a column, a table, RLS, and functions; no DROP).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Shareable connect code on each profile
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists connect_code text;

-- Backfill existing rows (8 hex chars, uppercased).
update public.profiles
  set connect_code = upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8))
  where connect_code is null;

-- New rows (created by the handle_new_user trigger, which doesn't set this column)
-- get a code from the default — no trigger edit needed.
alter table public.profiles
  alter column connect_code set default upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

create unique index if not exists profiles_connect_code_key on public.profiles (connect_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) connections  (directed request row; symmetric once accepted)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (requester_id, addressee_id)
);
create index if not exists connections_addressee on public.connections (addressee_id, status);
create index if not exists connections_requester on public.connections (requester_id, status);

alter table public.connections enable row level security;

-- RLS: you can see connections you're part of; only create requests as yourself;
-- only the addressee may respond (update); either party may cancel/disconnect.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connections' and policyname='connections_select') then
    create policy connections_select on public.connections
      for select using (auth.uid() in (requester_id, addressee_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connections' and policyname='connections_insert') then
    create policy connections_insert on public.connections
      for insert with check (auth.uid() = requester_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connections' and policyname='connections_update') then
    create policy connections_update on public.connections
      for update using (auth.uid() = addressee_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='connections' and policyname='connections_delete') then
    create policy connections_delete on public.connections
      for delete using (auth.uid() in (requester_id, addressee_id));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) RPCs  (security definer; scoped manually to auth.uid())
-- ─────────────────────────────────────────────────────────────────────────────

-- Send a connection request to whoever owns p_code. Handles the awkward cases:
-- unknown code, self, already connected, an inverse pending request (→ accept it),
-- a duplicate of my own pending (→ no-op), and reviving a previously declined row.
create or replace function public.request_connection(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
begin
  if v_uid is null then
    raise exception 'request_connection: not authenticated';
  end if;

  select id into v_target from public.profiles where connect_code = upper(trim(p_code));
  if v_target is null then return 'not_found'; end if;
  if v_target = v_uid then return 'self'; end if;

  if exists (
    select 1 from public.connections
    where status = 'accepted'
      and ((requester_id = v_uid and addressee_id = v_target)
        or (requester_id = v_target and addressee_id = v_uid))
  ) then
    return 'already';
  end if;

  -- They already requested me → accept their pending request instead.
  update public.connections
    set status = 'accepted', responded_at = now()
    where requester_id = v_target and addressee_id = v_uid and status = 'pending';
  if found then return 'connected'; end if;

  -- Create (or revive a declined) request from me to them.
  insert into public.connections (requester_id, addressee_id, status)
    values (v_uid, v_target, 'pending')
    on conflict (requester_id, addressee_id)
    do update set status = 'pending', created_at = now(), responded_at = null;

  return 'requested';
end;
$$;
grant execute on function public.request_connection(text) to authenticated;

-- Accept or decline a pending request addressed to me.
create or replace function public.respond_connection(p_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'respond_connection: not authenticated';
  end if;
  update public.connections
    set status = case when p_accept then 'accepted' else 'declined' end,
        responded_at = now()
    where id = p_id and addressee_id = v_uid and status = 'pending';
  if not found then return 'not_found'; end if;
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;
grant execute on function public.respond_connection(uuid, boolean) to authenticated;

-- All of the caller's connections (accepted + pending), each joined to the
-- counterpart's SAFE profile fields only. `direction` lets the UI bucket them:
-- 'accepted' (active), 'incoming' (they asked me — show Accept/Decline),
-- 'outgoing' (I asked them — show Pending).
create or replace function public.get_my_connections()
returns table (
  connection_id uuid,
  other_id      uuid,
  name          text,
  avatar_url    text,
  account_type  text,
  status        text,
  direction     text
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id,
    other.id,
    other.name,
    other.avatar_url,
    other.account_type,
    c.status,
    case
      when c.status = 'accepted'      then 'accepted'
      when c.requester_id = auth.uid() then 'outgoing'
      else 'incoming'
    end
  from public.connections c
  join public.profiles other
    on other.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
  where auth.uid() in (c.requester_id, c.addressee_id)
    and c.status in ('pending', 'accepted')
  order by c.created_at desc;
$$;
grant execute on function public.get_my_connections() to authenticated;
