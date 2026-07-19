-- Real account-to-account chat (replaces the local mock in utils/chatStore.ts).
--
-- Messages between connected accounts live server-side, so both sides of an
-- accepted connection see the same thread and history survives sign-out /
-- account switches on a device. Sending requires an ACCEPTED connection between
-- the two accounts — and because blocking severs the connection (see the block
-- flow in utils/moderation.ts → disconnectByOtherId), a blocked person can no
-- longer message you at the DB layer, not just in the UI.
--
-- chat_reads stores each account's per-peer "last read" stamp so unread badges
-- survive reinstall / account switch and stay consistent across devices.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (adds two tables, RLS, and a realtime publication entry).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) messages  (1:1; a broadcast is one row per recipient)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index if not exists messages_sender_time    on public.messages (sender_id, created_at);
create index if not exists messages_recipient_time on public.messages (recipient_id, created_at);

alter table public.messages enable row level security;

-- RLS: participants can read; you may only send as yourself, to someone you
-- have an accepted connection with; only the sender may delete.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_select') then
    create policy messages_select on public.messages
      for select using (auth.uid() in (sender_id, recipient_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_insert') then
    create policy messages_insert on public.messages
      for insert with check (
        auth.uid() = sender_id
        and sender_id <> recipient_id
        and exists (
          select 1 from public.connections c
          where c.status = 'accepted'
            and ((c.requester_id = sender_id and c.addressee_id = recipient_id)
              or (c.requester_id = recipient_id and c.addressee_id = sender_id))
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='messages_delete') then
    create policy messages_delete on public.messages
      for delete using (auth.uid() = sender_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) chat_reads  (per-account, per-peer last-read stamp → unread badges)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  peer_id      uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);

alter table public.chat_reads enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_reads' and policyname='chat_reads_own') then
    create policy chat_reads_own on public.chat_reads
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Realtime — lets an open thread receive inbound messages live. Postgres
--    Changes respects the RLS select policy, so subscribers only ever see rows
--    they participate in.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
