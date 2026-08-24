-- A reachable contact address, separate from the login identifier.
--
-- Sign in with Apple lets the user pick "Hide My Email", in which case Apple
-- hands the app a per-app relay address (…@privaterelay.appleid.com) and never
-- reveals the real one — not on first authorization, not ever. That relay
-- address is what lands in auth.users.email, so for those accounts the login
-- identifier is not something the user recognises or wants shown back to them.
--
-- auth.users.email therefore stays what it is (the login identifier, managed by
-- Supabase Auth and changed only through its confirm-link flow), and this column
-- holds the address the user actually wants to be reached on. Nullable: most
-- accounts never set it, because their login email is already reachable.
--
-- NOTE: mail sent to a @privaterelay.appleid.com address BOUNCES unless the
-- sending domain and From addresses are registered with Apple under
-- Certificates, Identifiers & Profiles → Services → Sign in with Apple for
-- Email Communication. This column is how we reach those users until that's set
-- up, and a useful fallback afterwards.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (adds one nullable column; no DROP, no backfill).

alter table public.profiles
  add column if not exists contact_email text;
