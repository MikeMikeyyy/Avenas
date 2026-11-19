-- 0061: the AI's per-account spend caps and its agreement (user picks,
-- 2026-11-13).
--
-- 0060 limited each account by how MANY calls it makes; what a call costs
-- varies (a program is far dearer than a question), so a count alone doesn't
-- bound what one account can cost. Now each account also has a cap on what
-- its calls cost, by tier (ai_tiers): over the last 24 hours ($1 for 'free')
-- and over the last 30 days ($4 for 'free'). The paid tier's caps go no higher
-- than what the cheapest paid plan brings in each month, so even the heaviest
-- subscriber can't cost more than they pay. A tier with no row gets nothing
-- (fails closed).
--
-- Everyone's daily budget comes down to $3 while the AI is tested by a
-- handful of people (the row is only changed if it still has 0060's $10, so a
-- figure set in the dashboard is kept).
--
-- And no call reaches the model unless the account has agreed to sharing its
-- training with the AI (document 'ai', record_agreement, 0060) at
-- ai_settings.consent_version or later. The app asks before the first
-- question; this is the server making sure (Apple 5.1.2(i)).
--
-- ai_begin's refusals, in order (new ones marked *):
--   ai_disabled, ai_blocked,
--   ai_consent *      the account hasn't agreed to the current version
--   ai_budget, ai_rate_limit,
--   ai_daily_limit    this feature's calls for the day, or * the account's
--                     spend over 24 hours has reached its tier's daily cap
--   ai_monthly_limit * the account's spend over 30 days has reached its
--                     tier's monthly cap
-- A call is only refused once a cap is reached, so the last call before it
-- can take an account a little past (one call's cost, a few cents to half a
-- dollar); the per-minute limit stops a burst from taking it further.
--
-- ai_remaining() now says why each feature can't be used (`status`, one of
-- the codes above, or null), in place of 0060's `enabled`.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- ── Caps on what each account's calls cost, by tier ──────────────────────────
create table if not exists public.ai_tiers (
  tier                text primary key,
  -- Micro-USD, rolling 24 hours and rolling 30 days.
  daily_cost_micros   bigint not null check (daily_cost_micros >= 0),
  monthly_cost_micros bigint not null check (monthly_cost_micros >= 0)
);
insert into public.ai_tiers (tier, daily_cost_micros, monthly_cost_micros)
values ('free', 1000000, 4000000)
on conflict (tier) do nothing;

comment on table public.ai_tiers is
  'What one account''s AI calls may cost, by tier, in micro-USD: over any 24 hours and any 30 days. A tier with no row gets no AI.';

alter table public.ai_tiers enable row level security;
-- No policy: the app never reads it (ai_remaining() says what it needs).
grant select, insert, update, delete on public.ai_tiers to authenticated, service_role;

-- ── Everyone's daily budget, and the agreement's version ─────────────────────
alter table public.ai_settings alter column daily_budget_micros set default 3000000;
update public.ai_settings set daily_budget_micros = 3000000 where daily_budget_micros = 10000000;

alter table public.ai_settings add column if not exists consent_version integer not null default 1
  check (consent_version >= 1);

-- ── Before a call ────────────────────────────────────────────────────────────
create or replace function public.ai_begin(p_user uuid, p_feature text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.ai_settings;
  v_tier     public.ai_tiers;
  v_limit    integer;
  v_spent    bigint;
  v_count    integer;
  v_id       bigint;
begin
  if p_user is null then
    raise exception 'ai_begin: no account';
  end if;
  if p_feature is null or p_feature not in ('chat', 'interview', 'program', 'insight') then
    raise exception 'ai_begin: no such feature %', p_feature;
  end if;

  -- One account's calls are checked and counted one at a time, so a burst
  -- can't all pass the check before any is counted.
  perform pg_advisory_xact_lock(hashtext('ai_begin:' || p_user::text));

  select * into v_settings from public.ai_settings where id;
  if not found or not v_settings.enabled then
    raise exception 'ai_disabled';
  end if;

  if exists (select 1 from public.ai_blocked_users where user_id = p_user) then
    raise exception 'ai_blocked';
  end if;

  if not exists (
    select 1 from public.agreements
     where user_id = p_user and document = 'ai' and version >= v_settings.consent_version
  ) then
    raise exception 'ai_consent';
  end if;

  select coalesce(sum(cost_micros), 0) into v_spent
    from public.ai_usage where started_at > now() - interval '24 hours';
  if v_spent >= v_settings.daily_budget_micros then
    raise exception 'ai_budget';
  end if;

  select count(*) into v_count
    from public.ai_usage where user_id = p_user and started_at > now() - interval '1 minute';
  if v_count >= v_settings.per_minute then
    raise exception 'ai_rate_limit';
  end if;

  select per_day into v_limit
    from public.ai_limits where tier = public.ai_tier_of(p_user) and feature = p_feature;
  select count(*) into v_count
    from public.ai_usage
   where user_id = p_user and feature = p_feature and started_at > now() - interval '24 hours';
  if v_count >= coalesce(v_limit, 0) then
    raise exception 'ai_daily_limit';
  end if;

  -- What this account's calls have cost. No row for the tier: nothing allowed.
  select * into v_tier from public.ai_tiers where tier = public.ai_tier_of(p_user);
  select coalesce(sum(cost_micros), 0) into v_spent
    from public.ai_usage where user_id = p_user and started_at > now() - interval '24 hours';
  if v_spent >= coalesce(v_tier.daily_cost_micros, 0) then
    raise exception 'ai_daily_limit';
  end if;
  select coalesce(sum(cost_micros), 0) into v_spent
    from public.ai_usage where user_id = p_user and started_at > now() - interval '30 days';
  if v_spent >= coalesce(v_tier.monthly_cost_micros, 0) then
    raise exception 'ai_monthly_limit';
  end if;

  insert into public.ai_usage (user_id, feature) values (p_user, p_feature)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_begin(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_begin(uuid, text) to service_role;

-- ── For the app: what's left, and why not ────────────────────────────────────
-- A new column, so the old function goes first (a function's columns can't
-- change in place).
drop function if exists public.ai_remaining();

create function public.ai_remaining()
returns table (feature text, per_day integer, used integer, remaining integer, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_settings public.ai_settings;
  v_tier     public.ai_tiers;
  v_everyone bigint;
  v_day      bigint;
  v_month    bigint;
  v_account  text;
begin
  if v_uid is null then
    raise exception 'ai_remaining: not authenticated';
  end if;

  select * into v_settings from public.ai_settings where id;
  select * into v_tier from public.ai_tiers where tier = public.ai_tier_of(v_uid);
  select coalesce(sum(a.cost_micros), 0) into v_everyone
    from public.ai_usage a where a.started_at > now() - interval '24 hours';
  select coalesce(sum(a.cost_micros), 0) into v_day
    from public.ai_usage a where a.user_id = v_uid and a.started_at > now() - interval '24 hours';
  select coalesce(sum(a.cost_micros), 0) into v_month
    from public.ai_usage a where a.user_id = v_uid and a.started_at > now() - interval '30 days';

  -- Why nothing can be asked, whatever the feature (ai_begin's order).
  v_account := case
    when v_settings.id is null or not v_settings.enabled then 'ai_disabled'
    when exists (select 1 from public.ai_blocked_users b where b.user_id = v_uid) then 'ai_blocked'
    when not exists (
      select 1 from public.agreements g
       where g.user_id = v_uid and g.document = 'ai' and g.version >= v_settings.consent_version
    ) then 'ai_consent'
    when v_everyone >= v_settings.daily_budget_micros then 'ai_budget'
    when v_day >= coalesce(v_tier.daily_cost_micros, 0) then 'ai_daily_limit'
    when v_month >= coalesce(v_tier.monthly_cost_micros, 0) then 'ai_monthly_limit'
    else null
  end;

  return query
    select l.feature,
           l.per_day,
           coalesce(u.n, 0)::integer,
           case when v_account is null then greatest(l.per_day - coalesce(u.n, 0), 0) else 0 end::integer,
           coalesce(v_account, case when coalesce(u.n, 0) >= l.per_day then 'ai_daily_limit' end)
      from public.ai_limits l
      left join (
        select a.feature, count(*)::integer as n
          from public.ai_usage a
         where a.user_id = v_uid and a.started_at > now() - interval '24 hours'
         group by a.feature
      ) u on u.feature = l.feature
     where l.tier = public.ai_tier_of(v_uid)
     order by l.feature;
end;
$$;

revoke all on function public.ai_remaining() from public, anon;
grant execute on function public.ai_remaining() to authenticated;
