-- Let an account change its own account_type (Trainer <-> Gym User).
--
-- Migration 0008 froze profiles.account_type once onboarding_complete flipped
-- true, to stop a client "granting itself trainer-only abilities at the DB
-- layer". In practice that guard protected nothing and broke a real feature:
--
--   * Nothing server-side keys off account_type. It is not referenced by any RLS
--     policy or RPC gate; connections, messages and shared_programs are all
--     symmetric and scoped by auth.uid(). The column is a role LABEL that
--     get_my_connections() hands to the other side so the UI can bucket people.
--
--   * The app itself offers the switch. Profile > Account Type has always let a
--     user flip between Gym User and Trainer, and the whole trainer hub unlocks
--     from the local value. The lock never prevented the "self-promotion" it was
--     written for — it only stopped the server's copy from keeping up.
--
--   * The drift broke trainer-to-trainer connections. A user who became a
--     Trainer after onboarding still read as account_type = 'user' to everyone
--     they connected with, so they could only ever be bucketed as a client and
--     never appeared on the other trainer's My Trainers page.
--
-- Owners already can only UPDATE their own profile row (owner-only RLS from
-- 0001), so dropping the trigger widens nothing beyond this self-declared label.
-- If a server-side capability is ever gated on being a trainer, that gate needs
-- verified state (a review/approval flag), not an unverified self-declaration —
-- so re-adding this freeze would not be the right fix then either.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive: it drops only the guard trigger + its function, touching no
-- data. Re-running is a no-op.

drop trigger if exists profiles_lock_account_type on public.profiles;
drop function if exists public.enforce_account_type_lock();

-- Backfill note: existing rows keep whatever account_type they were given at
-- onboarding. Each device repairs its own account on next launch via
-- lib/cloud.ts:reconcileAccountType(), which pushes the locally-selected role
-- when it differs from the stored one. No bulk UPDATE here: the device's local
-- value is the only record of what the user actually picked after onboarding.
