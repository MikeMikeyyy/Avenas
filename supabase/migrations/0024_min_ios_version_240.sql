-- Raise the force-update floor to 2.4.0.
--
-- 2.4.0 (build 36) carries the Expo SDK 57 / RN 0.86 upgrade and the one-shot
-- day-id migration, which rewrites @avenas/programs and @avenas/workout_history
-- on first launch. Older builds don't know about programs.day_ids or
-- workouts.day_id, so a full-snapshot push from one would blank both columns in
-- the cloud (replace_user_data lists its insert columns explicitly — see 0023).
-- That's the reason to actually enforce the floor rather than just ship and hope.
--
-- ⚠ RUN THIS ONLY ONCE 2.4.0 IS AVAILABLE TO EVERYONE.
--   Under a phased release Apple offers the update to a slice of users per day.
--   Everyone else CANNOT install it yet — their App Store still says "Open",
--   not "Update" — so raising the floor locks them out of a working app with no
--   way forward. Either wait for 100%, or hit "Release This Version to All
--   Users" in App Store Connect first.
--   Never set the floor to a version that is still in review, either: App
--   Review runs that build, and a reviewer who sees a locked screen rejects it.
--
-- The value is the app VERSION string (expoConfig.version), never the build
-- number. The gate blocks strictly-below, so '2.4.0' stops 2.3.0 and older and
-- lets 2.4.0 through (utils/version.ts isBelowMinimum).
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.

-- Guard for a database where 0020 hasn't seeded the singleton row yet.
insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- updated_at is maintained by the app_config_set_updated_at trigger (0020),
-- so it's deliberately not set here.
update public.app_config
set min_ios_version = '2.4.0'
where id = 1;

-- Confirm what the gate will now read.
select id, min_ios_version, updated_at from public.app_config where id = 1;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- The floor is the one part of a release that can be undone without shipping
-- anything. If 2.4.0 turns out to be bad, or the phased rollout catches people
-- out, drop it back and the gate stops blocking on the next foreground check:
--
--   update public.app_config set min_ios_version = '0.0.0' where id = 1;
