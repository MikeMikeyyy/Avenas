-- Remotely-controlled minimum app version (force-update gate).
--
-- A single row holding the oldest build allowed to run. The app reads it on
-- launch and blocks anything older, sending the user to the App Store.
--
-- Server-controlled rather than derived from Apple's lookup API on purpose:
--   * Apple's endpoint is cached for hours after a release, and a phased
--     rollout means some users legitimately cannot get the new version yet.
--     Auto-forcing on "a newer version exists" locks those people out of the
--     app while the App Store still shows them "Open" rather than "Update".
--   * More importantly this is the ONLY undo. If a bad value ships, lifting
--     the block is a one-field edit here rather than another review cycle.
--
-- Readable by anon as well as authenticated: the gate runs before sign-in, so
-- someone on an old build who is signed out must still be told to update.
-- Nobody can write it from the client — change it in the dashboard.
--
-- ⚠ NEVER set min_ios_version to the version you are currently submitting.
--   App Review runs that build; if the floor is above it the reviewer sees a
--   locked screen and rejects. Raise it only once the version is live.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

create table if not exists public.app_config (
  -- Single-row table: the check constraint makes a second row impossible.
  id               int primary key default 1 check (id = 1),
  min_ios_version  text not null default '0.0.0',
  updated_at       timestamptz not null default now()
);

insert into public.app_config (id) values (1) on conflict (id) do nothing;

alter table public.app_config enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_config' and policyname = 'app_config_read'
  ) then
    -- Read-only, and readable by everyone. There is no insert/update/delete
    -- policy, so RLS denies every client write by default.
    create policy app_config_read on public.app_config for select using (true);
  end if;
end $$;

grant select on public.app_config to anon, authenticated;

drop trigger if exists app_config_set_updated_at on public.app_config;
create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

comment on column public.app_config.min_ios_version is
  'Oldest CFBundleShortVersionString allowed to run, e.g. "2.2.0". Anything lower is hard-blocked with an update prompt. Keep at 0.0.0 to block nothing.';
