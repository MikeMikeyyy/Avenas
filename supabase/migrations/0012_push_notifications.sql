-- Server-sent push notifications (Expo push) for the events another account
-- triggers: chat messages (0011) and connection requests/accepts (0006).
--
-- Design: each signed-in device registers its Expo push token plus the
-- EFFECTIVE per-category notification prefs (master && category, mirrored by
-- lib/push.ts on every prefs change). Delivery happens straight from Postgres:
-- AFTER-triggers batch the recipient's eligible tokens and hand one HTTP call
-- to Expo's push API via pg_net (async, queued — never blocks or fails the
-- triggering insert). No edge function to deploy; applying this file is the
-- whole server side.
--
-- Token hygiene: registration goes through the register_push_token RPC, which
-- re-claims the token from any other account first — a device token belongs to
-- exactly one account, so a signed-out-then-switched device never leaks the
-- previous account's messages. Sign-out deletes the row (lib/auth.ts).
-- Tokens Expo reports as dead are simply ignored at Expo's side; rows are
-- cleaned up on sign-out/account-delete (FK cascade) and re-upserted on every
-- app start, so drift stays bounded.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires the pg_net extension (available on hosted Supabase).

create extension if not exists pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) push_tokens — one row per (account, device token)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  user_id    uuid  not null references auth.users(id) on delete cascade,
  token      text  not null,
  platform   text  not null default 'ios',
  -- Effective push-category switches, e.g. {"coachMessages": true, ...}.
  -- A missing key counts as ENABLED (forward-compatible with new categories).
  categories jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
create index if not exists push_tokens_token on public.push_tokens (token);

alter table public.push_tokens enable row level security;

-- RLS: owners can see and delete their device rows. There are deliberately NO
-- insert/update policies — writes go through register_push_token below, which
-- also evicts the token from any previous account.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='push_tokens' and policyname='push_tokens_select') then
    create policy push_tokens_select on public.push_tokens
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='push_tokens' and policyname='push_tokens_delete') then
    create policy push_tokens_delete on public.push_tokens
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Register/refresh this device's token for the calling account, claiming it
-- from any other account that held it. Also the path prefs changes take
-- (same upsert, fresh categories).
create or replace function public.register_push_token(
  p_token      text,
  p_platform   text,
  p_categories jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'register_push_token: not authenticated';
  end if;
  if p_token is null or length(trim(p_token)) = 0 or length(p_token) > 512 then
    raise exception 'register_push_token: invalid token';
  end if;

  delete from public.push_tokens where token = p_token and user_id <> v_uid;

  insert into public.push_tokens (user_id, token, platform, categories, updated_at)
  values (
    v_uid,
    p_token,
    case when p_platform in ('ios','android') then p_platform else 'ios' end,
    coalesce(p_categories, '{}'::jsonb),
    now()
  )
  on conflict (user_id, token)
  do update set platform = excluded.platform, categories = excluded.categories, updated_at = now();
end;
$$;
grant execute on function public.register_push_token(text, text, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) send helper — one Expo API call per recipient, all eligible tokens batched
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.send_expo_push(
  p_user     uuid,
  p_category text,
  p_title    text,
  p_body     text,
  p_data     jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
begin
  -- A category key absent from the row counts as enabled; an explicit false
  -- (toggle off, or master off) silences the device server-side.
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', p_title,
           'body', p_body,
           'sound', 'default',
           'channelId', 'default',
           'data', coalesce(p_data, '{}'::jsonb) || jsonb_build_object('category', p_category)
         ))
    into v_messages
    from public.push_tokens t
   where t.user_id = p_user
     and coalesce((t.categories->>p_category)::boolean, true);

  if v_messages is null then
    return;
  end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    body    := v_messages,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  -- Push is best-effort; never let it break the triggering write.
  raise warning 'send_expo_push failed for %: %', p_user, sqlerrm;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) message push  (category: coachMessages) — tap opens the chat thread
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
begin
  select name into v_sender from public.profiles where id = new.sender_id;
  perform public.send_expo_push(
    new.recipient_id,
    'coachMessages',
    coalesce(nullif(trim(v_sender), ''), 'New message'),
    left(new.body, 140),
    jsonb_build_object('url', '/trainer/chat/' || new.sender_id)
  );
  return new;
end;
$$;

drop trigger if exists messages_push on public.messages;
create trigger messages_push
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) connection push  (category: coachingRequests)
--    - a request lands (INSERT as pending, or a declined row revived to
--      pending by request_connection's upsert) → tell the addressee
--    - a pending request is accepted → tell the requester
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    select name into v_name from public.profiles where id = new.requester_id;
    perform public.send_expo_push(
      new.addressee_id,
      'coachingRequests',
      'New connection request',
      coalesce(nullif(trim(v_name), ''), 'Someone') || ' wants to connect with you.',
      jsonb_build_object('url', '/connect')
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    select name into v_name from public.profiles where id = new.addressee_id;
    perform public.send_expo_push(
      new.requester_id,
      'coachingRequests',
      'Request accepted',
      coalesce(nullif(trim(v_name), ''), 'Your new connection') || ' accepted your request.',
      jsonb_build_object('url', '/connect')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists connections_push on public.connections;
create trigger connections_push
  after insert or update of status on public.connections
  for each row execute function public.notify_connection_change();

-- NOTE: the programShared category has no trigger yet — program sharing is
-- still device-local. When shares move server-side, add the same pattern:
-- after insert on the shares table → send_expo_push(recipient, 'programShared', ...).
