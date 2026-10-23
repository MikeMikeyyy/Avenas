-- 0050: the connection-request rate limit, which the live database never got.
--
-- 0008 had two parts: an account_type lock (later removed on purpose by 0015)
-- and a per-user limit of 10 request_connection calls per rolling minute, so
-- nobody can guess connect codes at speed. Running 0049 on the live database
-- (2026-10-21) found connection_request_attempts missing, and request_connection
-- was still 0006's version with no limit. This is 0008's part 2 alone: do NOT
-- re-run 0008 whole, or its account_type lock comes back and breaks
-- change_account_type (0041).
--
-- Idempotent: on a database built from the migrations (where 0008 already ran)
-- it changes nothing.

create table if not exists public.connection_request_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists conn_attempts_user_time
  on public.connection_request_attempts (user_id, attempted_at desc);

-- Written only through the SECURITY DEFINER function below. RLS with no
-- policies denies any direct API read or write; the grant only matches every
-- other table (0049).
alter table public.connection_request_attempts enable row level security;
grant select, insert, update, delete on table public.connection_request_attempts
  to authenticated, service_role;

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

  -- Prune this caller's stale attempts, count what's left, record this one.
  delete from public.connection_request_attempts
    where user_id = v_uid and attempted_at < now() - interval '1 minute';

  select count(*) into v_recent_count
    from public.connection_request_attempts
    where user_id = v_uid;

  if v_recent_count >= v_max_per_minute then
    raise exception 'rate limit: too many connection requests, try again in a minute';
  end if;

  insert into public.connection_request_attempts (user_id) values (v_uid);

  -- 0006's body, unchanged.
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
