-- Security hardening (Trainer hub audit follow-ups).
--
--   1. Lock profiles.account_type after onboarding completes. The client can
--      otherwise UPDATE it via the owner-only RLS policy on profiles, which is
--      enough to grant itself trainer-only abilities at the DB layer. Owners can
--      still set it during the onboarding UPDATE that flips onboarding_complete
--      from false to true (pushProfile does both in one statement). Service
--      role / admin operations (no auth.uid()) bypass the gate.
--
--   2. Per-user rate limit on request_connection. The 8-hex connect_code space
--      (~4.3B) plus distinguishable return values made enumeration cheap; this
--      caps each authenticated caller at 10 attempts per rolling minute. A tiny
--      attempts table absorbs the writes; rows older than 1 minute are pruned
--      inline so it stays bounded.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (CREATE OR REPLACE / IF NOT EXISTS / guarded policy creation;
-- no DROP statements except the trigger drop+recreate, which is safe because
-- the trigger is owner-only logic with no associated data).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Lock account_type after onboarding
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_account_type_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Service role / admin (no JWT → no auth.uid()) is exempt so dashboard
  -- queries and future server-side migrations can still adjust the value.
  if auth.uid() is null then
    return new;
  end if;

  -- Allow the change while onboarding is still in progress (the same UPDATE
  -- that flips onboarding_complete to true can also set account_type — that's
  -- the normal pushProfile flow). After completion, account_type is frozen
  -- from client UPDATEs.
  if old.onboarding_complete = true
     and old.account_type is distinct from new.account_type then
    raise exception 'account_type cannot be changed after onboarding';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_lock_account_type on public.profiles;
create trigger profiles_lock_account_type
  before update on public.profiles
  for each row execute function public.enforce_account_type_lock();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Rate-limit request_connection (per authenticated user, rolling 1 minute)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.connection_request_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists conn_attempts_user_time
  on public.connection_request_attempts (user_id, attempted_at desc);

-- The table is written only through the SECURITY DEFINER RPC below; no client
-- needs direct access. Enable RLS with no policies so any direct REST attempt
-- is denied even though the table is in the public schema.
alter table public.connection_request_attempts enable row level security;

-- Updated request_connection: prepends a rate-limit window check and records
-- each attempt. The body that follows is the same logic as migration 0006
-- (unknown code, self, already, inverse-pending → accept, revive-declined),
-- republished here so the whole function stays a single transaction.
create or replace function public.request_connection(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_target         uuid;
  v_recent_count   integer;
  v_max_per_minute constant integer := 10;
begin
  if v_uid is null then
    raise exception 'request_connection: not authenticated';
  end if;

  -- Bounded rate limit: prune this caller's stale attempts, count what's left,
  -- record the new attempt. Per-user state only, so one abuser can't slow
  -- anyone else down.
  delete from public.connection_request_attempts
    where user_id = v_uid and attempted_at < now() - interval '1 minute';

  select count(*) into v_recent_count
    from public.connection_request_attempts
    where user_id = v_uid;

  if v_recent_count >= v_max_per_minute then
    raise exception 'rate limit: too many connection requests, try again in a minute';
  end if;

  insert into public.connection_request_attempts (user_id) values (v_uid);

  -- ── original 0006 body below ─────────────────────────────────────────────
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
