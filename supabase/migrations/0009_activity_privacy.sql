-- Activity-status privacy. profiles.share_activity gates whether connections
-- can see this account's last_active_at ("Active now" / "Last active Xm ago").
-- Enforced SERVER-side in get_my_connections: when the counterpart has sharing
-- off, their last_active_at comes back NULL, so a hidden user's timestamp never
-- reaches another device (a client-side filter would still ship the data).
-- The UI renders no presence row for a NULL timestamp, so "hidden" is
-- indistinguishable from "never active" — deliberate.
--
-- The presence heartbeat keeps writing last_active_at while sharing is off
-- (it's the owner's own row; only read visibility is gated), so re-enabling
-- shows correct recent activity immediately.
--
-- Default TRUE preserves current behavior for existing accounts.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive; get_my_connections keeps the same return type, so a plain
-- CREATE OR REPLACE suffices (no DROP).

alter table public.profiles
  add column if not exists share_activity boolean not null default true;

create or replace function public.get_my_connections()
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
    case when other.share_activity then other.last_active_at end,
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
