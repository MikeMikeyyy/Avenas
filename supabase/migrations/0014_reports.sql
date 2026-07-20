-- Server-side user/content reports (Apple Guideline 1.2 — Safety / UGC).
--
-- Until now reports were logged on-device only, which satisfied the letter of
-- review but meant nobody could actually act on them. This table receives every
-- report filed against a REAL account (mock/local roster contacts stay
-- device-local — there is no real user to moderate). The app also keeps its
-- local log as an offline fallback and retries unsynced reports.
--
-- Reading reports is an OPERATOR activity: users can only insert (and see
-- their own submissions); review happens in the Supabase dashboard / with the
-- service role, which bypasses RLS. Aim to action reports within 24 hours —
-- that's the commitment the in-app copy makes.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references auth.users(id) on delete cascade,
  -- Kept (set null) if the reported account is later deleted, so the report
  -- history survives the account.
  reported_id   uuid references auth.users(id) on delete set null,
  kind          text not null check (kind in ('user','message')),
  reason        text not null check (char_length(reason) between 1 and 200),
  -- Message reports: id is text (may reference a since-deleted or local row)
  -- and the text is snapshotted so the evidence survives deletion.
  message_id    text,
  message_text  text,
  contact_name  text,
  created_at    timestamptz not null default now()
);
create index if not exists reports_created on public.reports (created_at desc);
create index if not exists reports_reported on public.reports (reported_id, created_at);

alter table public.reports enable row level security;

-- Users may file reports as themselves and see what they filed. No update or
-- delete — a submitted report is immutable from the client.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_insert') then
    create policy reports_insert on public.reports
      for insert with check (auth.uid() = reporter_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reports' and policyname='reports_select_own') then
    create policy reports_select_own on public.reports
      for select using (auth.uid() = reporter_id);
  end if;
end $$;
