-- 0049: explicit Data API grants on every table.
--
-- From 30 October 2026 Supabase stops granting the API roles access to new
-- tables in "public" automatically. Tables that already exist keep their
-- grants, so on the live database this changes nothing (granting what a table
-- already has is a no-op). It's for a database built from these migrations
-- (a new project, a preview branch, `supabase db reset`), where every table
-- before this one would otherwise come up out of reach of the app.
--
-- Row Level Security on every one of these tables still decides which rows
-- anyone sees; the grant only lets the API reach the table at all. The app
-- signs in before it touches a table, so `authenticated` gets access and
-- `anon` gets none (app_config's read for anon is granted in 0020).
--
-- A NEW TABLE grants its access in the migration that creates it (CLAUDE.md);
-- scripts/verify-db.ts fails if one doesn't.

-- Granted one table at a time, skipping any that isn't there: the live
-- database turned out not to have connection_request_attempts (0008), and a
-- single GRANT naming a missing table fails as a whole.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_config',
    'blocks',
    'chat_reads',
    'connection_notices',
    'connection_request_attempts',
    'connection_roles',
    'connections',
    'custom_exercises',
    'group_members',
    'group_messages',
    'group_reads',
    'groups',
    'journal_entries',
    'messages',
    'profiles',
    'programs',
    'push_tokens',
    'reports',
    'shared_programs',
    'workouts'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice '0049: public.% does not exist, skipped', t;
    else
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated, service_role',
        t
      );
    end if;
  end loop;
end
$$;
