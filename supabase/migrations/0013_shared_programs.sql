-- Real cross-account program sharing (replaces the local mock transport in
-- utils/trainerStore.ts for REAL connected accounts; local mock roster people
-- keep the on-device path).
--
-- One table carries both flows, discriminated by `kind`:
--   'share'  — trainer/coach sends a program TO someone (client or fellow
--              trainer). Recipient accepts → materialises the snapshot into
--              their local library and stamps accepted_at.
--   'review' — gym user sends THEIR program to their trainer for review. The
--              trainer edits (returned_snapshot) and sends it back
--              (returned_at + trainer_comments); the sender applies it over
--              their original program and stamps accepted_at.
--
-- The row carries a full program SNAPSHOT (canonical-kg JSON, same shape as
-- @avenas/programs entries) because sender and recipient are different
-- accounts: there is no shared library to reference. `sender_program_id` and
-- `sent_key` echo the sender's local program id and client-side sentAtISO so
-- the app's existing batch grouping (programId|sentAtISO) keeps working across
-- the wire.
--
-- Delivery: AFTER-triggers reuse 0012's send_expo_push (category
-- 'programShared') — new share/review → recipient; review returned → sender.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0006 (connections) and 0012 (send_expo_push).

create table if not exists public.shared_programs (
  id                      uuid primary key default gen_random_uuid(),
  sender_id               uuid not null references auth.users(id) on delete cascade,
  recipient_id            uuid not null references auth.users(id) on delete cascade,
  kind                    text not null default 'share' check (kind in ('share','review')),
  sender_program_id       text not null,
  program_name            text not null check (char_length(program_name) between 1 and 200),
  snapshot                jsonb not null,
  sent_key                text not null,
  sent_at                 timestamptz not null default now(),
  last_edited_at          timestamptz,
  accepted_at             timestamptz,
  deleted_by_recipient_at timestamptz,
  returned_at             timestamptz,
  trainer_comments        text,
  returned_snapshot       jsonb
);
create index if not exists shared_programs_recipient on public.shared_programs (recipient_id, sent_at);
create index if not exists shared_programs_sender    on public.shared_programs (sender_id, sent_at);

alter table public.shared_programs enable row level security;

-- RLS: participants read; you may only send as yourself, to an accepted
-- connection; either participant may update (lifecycle stamps flow both ways:
-- sender edits snapshots, recipient accepts/hides); only the sender may delete
-- (unsend). Column-level discipline lives in utils/trainerStore.ts — both
-- parties already trust each other with this data by being connected.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shared_programs' and policyname='shared_programs_select') then
    create policy shared_programs_select on public.shared_programs
      for select using (auth.uid() in (sender_id, recipient_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shared_programs' and policyname='shared_programs_insert') then
    create policy shared_programs_insert on public.shared_programs
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
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shared_programs' and policyname='shared_programs_update') then
    create policy shared_programs_update on public.shared_programs
      for update using (auth.uid() in (sender_id, recipient_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='shared_programs' and policyname='shared_programs_delete') then
    create policy shared_programs_delete on public.shared_programs
      for delete using (auth.uid() = sender_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Push notifications (category: programShared; gated per-device by 0012)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_shared_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from public.profiles where id = new.sender_id;
    perform public.send_expo_push(
      new.recipient_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Someone'),
      case when new.kind = 'review'
        then 'Sent you "' || new.program_name || '" to review.'
        else 'Sent you a program: "' || new.program_name || '".'
      end,
      jsonb_build_object('url', '/trainer-hub')
    );
  elsif tg_op = 'UPDATE' and old.returned_at is null and new.returned_at is not null then
    -- Trainer sent the reviewed program back — tell the original sender.
    select name into v_name from public.profiles where id = new.recipient_id;
    perform public.send_expo_push(
      new.sender_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Your trainer'),
      'Returned "' || new.program_name || '" with their changes.',
      jsonb_build_object('url', '/trainer-hub')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists shared_programs_push on public.shared_programs;
create trigger shared_programs_push
  after insert or update of returned_at on public.shared_programs
  for each row execute function public.notify_shared_program();
