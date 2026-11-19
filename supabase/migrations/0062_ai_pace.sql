-- 0062: the AI's per-minute limit counts questions, never a program build
-- (user report, 2026-11-14).
--
-- Answering the Program Builder's questions quickly (seven answers in 90
-- seconds, short ones a few seconds apart) used up 0061's 6 calls a minute,
-- every feature together, so tapping Build my program straight after was
-- turned away with "That's a lot of questions at once". A build is one tap at
-- the end of an interview and has its own limit (ai_limits 'program', 3 a
-- day) and the account's spend caps (ai_tiers), so the minute's limit no
-- longer counts builds or holds them up: it is for questions (chat,
-- interview, insight), and allows 10 of them a minute (from 6, so an
-- interview answered as fast as people answer it never meets it; the row is
-- only changed if it still has 0060's 6). What stops spending is unchanged:
-- the daily counts, the account's $1 a day and $4 a month, and everyone's
-- daily budget.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

alter table public.ai_settings alter column per_minute set default 10;
update public.ai_settings set per_minute = 10 where per_minute = 6;

comment on table public.ai_settings is
  'The AI''s kill switch (enabled), daily budget for everyone (micro-USD, rolling 24h), questions per account per minute (program builds aside) and the agreement version asked for. One row; change it in the dashboard.';

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

  -- Questions a minute. A program build is neither counted nor held up here.
  if p_feature <> 'program' then
    select count(*) into v_count
      from public.ai_usage
     where user_id = p_user and feature <> 'program' and started_at > now() - interval '1 minute';
    if v_count >= v_settings.per_minute then
      raise exception 'ai_rate_limit';
    end if;
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
