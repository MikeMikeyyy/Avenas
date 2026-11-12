-- 0059: a record of who agreed to what (user request, 2026-11-12).
--
-- The Terms of Service (at sign-up, app/accept-terms.tsx) and the community
-- guidelines (Apple 1.2, components/CommunityGate.tsx) were only ever agreed
-- on the phone: a flag in its storage, which nobody but that phone could see
-- and a reinstall took away, so there was no showing that an account had
-- agreed to them. Now each agreement is kept here too: which document, which
-- version, when the phone says they agreed, and when the server heard.
-- (profiles.terms_accepted, from 0001, was never written; this replaces it.)
--
-- The phone's own copy stays what lets someone in (utils/agreements.ts), so
-- nothing waits on the server; the app sends each agreement as it's given
-- and, when there was no signal, at the next launch or when the signal comes
-- back.
--
-- One row per document and version, the first kept: agreeing again (another
-- phone, a reinstall) changes nothing. The account reads its own and nobody
-- writes through the API: record_agreement() does, with the server's time, so
-- a record can't be backdated, changed or taken back from the app. It goes
-- with the account, as everything else does (the Privacy Policy says so).
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

create table if not exists public.agreements (
  user_id     uuid not null references auth.users(id) on delete cascade,
  document    text not null check (document in ('terms', 'community')),
  version     integer not null check (version > 0),
  -- When the phone says they agreed, by its own clock (never later than the
  -- server's: a phone set ahead can't record an agreement in the future).
  agreed_at   timestamptz not null,
  -- When the server recorded it, by its own clock, which nobody sets.
  recorded_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

comment on table public.agreements is
  'Each account''s agreement to each version of the Terms of Service (terms) and the community guidelines (community). Written only by record_agreement().';

alter table public.agreements enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agreements' and policyname='agreements_select_own') then
    create policy agreements_select_own on public.agreements
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- The API reaches the table (0049's rule for every table); with no policy to
-- insert, update or delete, Row Level Security refuses all three to the app.
grant select, insert, update, delete on public.agreements to authenticated, service_role;

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
  if p_document is null or p_document not in ('terms', 'community') then
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

-- Only a signed-in account, and only for itself (auth.uid()).
revoke all on function public.record_agreement(text, integer, timestamptz) from public;
grant execute on function public.record_agreement(text, integer, timestamptz) to authenticated;
