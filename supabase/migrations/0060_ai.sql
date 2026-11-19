-- 0060: the AI assistant's limits (user request, 2026-11-13).
--
-- The AI (Insights chat, the program builder, workout and program insights)
-- runs through one Edge Function, supabase/functions/ai, which holds the
-- Anthropic API key; the app never sees it. Every call costs money, so before
-- the function calls the model it asks ai_begin() here, and after it tells
-- ai_finish() what the call used. Both are the function's alone (service_role):
-- an account can't spend, refund or fake a cost through the API, or set off
-- the daily budget for everyone with a made-up figure.
--
-- What ai_begin() refuses, in order:
--   ai_disabled     ai_settings.enabled is off (the kill switch)
--   ai_blocked      the account is in ai_blocked_users
--   ai_budget       everyone's spend over the last 24 hours has reached
--                   ai_settings.daily_budget_micros
--   ai_rate_limit   this account's calls in the last minute (every feature)
--                   have reached ai_settings.per_minute
--   ai_daily_limit  this account's calls of this feature in the last 24 hours
--                   have reached its tier's ai_limits.per_day
-- Rolling windows, not calendar days, so nobody's limit turns over at a UTC
-- midnight that is the middle of their afternoon.
--
-- A call is counted when it starts, not when it ends, so a burst of calls
-- can't all slip in before the first finishes (each account's checks hold an
-- advisory lock), and one the function dies during still counts. A call that
-- fails on our side or Anthropic's is taken back (ai_finish with p_ok false),
-- so an outage doesn't use up anyone's day.
--
-- No message text is kept: a row is who, which feature, when, which model,
-- the tokens and what it cost. Rows go with the account.
--
-- Tiers: everyone is 'free' for now (the free test, no paywall yet). A
-- subscription later only has to say which tier an account is in
-- (ai_tier_of) and add that tier's rows to ai_limits.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- ── Settings: one row ────────────────────────────────────────────────────────
create table if not exists public.ai_settings (
  id                  boolean primary key default true check (id),
  enabled             boolean not null default true,
  -- Everyone's spend over any 24 hours, in millionths of a US dollar.
  daily_budget_micros bigint  not null default 10000000 check (daily_budget_micros >= 0),
  -- One account's calls in any minute, every feature together.
  per_minute          integer not null default 6 check (per_minute >= 0),
  updated_at          timestamptz not null default now()
);
insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

comment on table public.ai_settings is
  'The AI''s kill switch (enabled), daily budget for everyone (micro-USD, rolling 24h) and per-account calls per minute. One row; change it in the dashboard.';

-- ── Limits: calls per feature per day, by tier ───────────────────────────────
create table if not exists public.ai_limits (
  tier     text    not null,
  feature  text    not null check (feature in ('chat', 'interview', 'program', 'insight')),
  per_day  integer not null check (per_day >= 0),
  primary key (tier, feature)
);
insert into public.ai_limits (tier, feature, per_day) values
  ('free', 'chat',      30),  -- Insights questions
  ('free', 'interview', 30),  -- the program builder's questions, so building one doesn't use up chat
  ('free', 'program',    3),  -- programs built
  ('free', 'insight',   10)   -- workout and program insights (the phone keeps each one, so these are rare)
on conflict (tier, feature) do nothing;

comment on table public.ai_limits is
  'Calls each account may make of each AI feature in any 24 hours, by tier.';

-- ── Accounts kept from the AI ────────────────────────────────────────────────
create table if not exists public.ai_blocked_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now()
);

comment on table public.ai_blocked_users is
  'Accounts the AI refuses (abuse). Add or remove rows in the dashboard.';

-- ── What was used ────────────────────────────────────────────────────────────
create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  feature       text not null check (feature in ('chat', 'interview', 'program', 'insight')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_micros   bigint not null default 0 check (cost_micros >= 0)
);
create index if not exists ai_usage_user_started on public.ai_usage (user_id, started_at desc);
create index if not exists ai_usage_started on public.ai_usage (started_at desc);

comment on table public.ai_usage is
  'One row per AI call: who, which feature, when, the model, tokens and cost (micro-USD). Never the messages.';

-- ── Who reads what ───────────────────────────────────────────────────────────
-- Every table is reached by the API (0049's rule) and Row Level Security
-- decides: an account reads its own usage and the limits; nobody writes
-- through the API, and settings and the block list aren't read at all.
alter table public.ai_settings      enable row level security;
alter table public.ai_limits        enable row level security;
alter table public.ai_blocked_users enable row level security;
alter table public.ai_usage         enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_usage' and policyname='ai_usage_select_own') then
    create policy ai_usage_select_own on public.ai_usage
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_limits' and policyname='ai_limits_select_all') then
    create policy ai_limits_select_all on public.ai_limits
      for select to authenticated using (true);
  end if;
end $$;

grant select, insert, update, delete on public.ai_settings      to authenticated, service_role;
grant select, insert, update, delete on public.ai_limits        to authenticated, service_role;
grant select, insert, update, delete on public.ai_blocked_users to authenticated, service_role;
grant select, insert, update, delete on public.ai_usage         to authenticated, service_role;

-- ── Which tier an account is in ──────────────────────────────────────────────
-- Everyone is free during the test. The paywall changes only this.
create or replace function public.ai_tier_of(p_user uuid)
returns text
language sql
stable
set search_path = ''
as $$ select 'free'::text $$;

revoke all on function public.ai_tier_of(uuid) from public, anon, authenticated;
grant execute on function public.ai_tier_of(uuid) to service_role;

-- ── Before a call: may this account make it? ─────────────────────────────────
-- Counts it and returns its id, or raises one of the codes in the header.
create or replace function public.ai_begin(p_user uuid, p_feature text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.ai_settings;
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

  insert into public.ai_usage (user_id, feature) values (p_user, p_feature)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_begin(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_begin(uuid, text) to service_role;

-- ── After a call: what it used, or take it back ──────────────────────────────
-- p_ok false: the call failed on our side or Anthropic's (no answer reached
-- the account), so it isn't counted. Only a call still open is changed.
create or replace function public.ai_finish(
  p_id            bigint,
  p_ok            boolean,
  p_model         text    default null,
  p_input_tokens  integer default null,
  p_output_tokens integer default null,
  p_cost_micros   bigint  default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not p_ok then
    delete from public.ai_usage where id = p_id and finished_at is null;
    return;
  end if;
  update public.ai_usage
     set finished_at   = now(),
         model         = p_model,
         input_tokens  = p_input_tokens,
         output_tokens = p_output_tokens,
         cost_micros   = greatest(coalesce(p_cost_micros, 0), 0)
   where id = p_id and finished_at is null;
end;
$$;

revoke all on function public.ai_finish(bigint, boolean, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.ai_finish(bigint, boolean, text, integer, integer, bigint) to service_role;

-- ── For the app: what's left today ───────────────────────────────────────────
-- The signed-in account's calls left of each feature in the last 24 hours,
-- and whether the AI is on, so a screen can say "3 left" or "back tomorrow"
-- before anyone types.
create or replace function public.ai_remaining()
returns table (feature text, per_day integer, used integer, remaining integer, enabled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'ai_remaining: not authenticated';
  end if;
  return query
    select l.feature,
           l.per_day,
           coalesce(u.n, 0)::integer,
           greatest(l.per_day - coalesce(u.n, 0), 0)::integer,
           coalesce((select s.enabled from public.ai_settings s where s.id), false)
              and not exists (select 1 from public.ai_blocked_users b where b.user_id = v_uid)
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

-- ── Agreeing to the AI ───────────────────────────────────────────────────────
-- The AI reads someone's training and sends it to Anthropic, so before its
-- first use each account agrees to that (Apple 5.1.2(i): personal data shared
-- with a third-party AI needs the person's say-so first), recorded as the
-- Terms and the guidelines are (0059), as document 'ai'.
alter table public.agreements drop constraint if exists agreements_document_check;
alter table public.agreements add constraint agreements_document_check
  check (document in ('terms', 'community', 'ai'));

comment on table public.agreements is
  'Each account''s agreement to each version of the Terms of Service (terms), the community guidelines (community) and sharing their training with the AI (ai). Written only by record_agreement().';

create or replace function public.record_agreement(
  p_document  text,
  p_version   integer,
  p_agreed_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'record_agreement: not authenticated';
  end if;
  if p_document is null or p_document not in ('terms', 'community', 'ai') then
    raise exception 'record_agreement: no such document %', p_document;
  end if;
  if p_version is null or p_version < 1 then
    raise exception 'record_agreement: no such version %', p_version;
  end if;

  insert into public.agreements (user_id, document, version, agreed_at)
  values (v_uid, p_document, p_version, least(coalesce(p_agreed_at, now()), now()))
  on conflict (user_id, document, version) do nothing;
end;
$$;

revoke all on function public.record_agreement(text, integer, timestamptz) from public;
grant execute on function public.record_agreement(text, integer, timestamptz) to authenticated;
