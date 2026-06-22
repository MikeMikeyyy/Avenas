-- "Last active" presence for connections. profiles.last_active_at is bumped to
-- server-now while the app is foregrounded (on sign-in, on every foreground, and
-- on a light heartbeat), so a trainer can see when a connected client was last on
-- the app — and "Active now" when it's recent.
--
-- Apply with `supabase db push` or paste into the SQL editor. The only DROP is of
-- the get_my_connections function (no data) — it's recreated immediately because
-- adding a returned column is a return-type change.

alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- Bump the caller's own last_active_at to server time.
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_last_active() to authenticated;

-- get_my_connections now also returns the counterpart's last_active_at. Changing
-- the OUT columns is a return-type change, so drop + recreate.
drop function if exists public.get_my_connections();
create function public.get_my_connections()
returns table (
  connection_id  uuid,
  other_id       uuid,
  name           text,
  avatar_url     text,
  account_type   text,
  last_active_at timestamptz,
  status         text,
  direction      text
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
    other.last_active_at,
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
