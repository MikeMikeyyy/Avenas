-- Login hint for OAuth-only accounts.
--
-- Problem: password sign-in against an account that was created through
-- Google/Apple fails with the same "Invalid login credentials" error as a
-- nonexistent account, so the login screen told the user their account doesn't
-- exist when it does (it just has no password).
--
-- This RPC lets the (anon) login screen ask which social providers an email
-- signs in with, ONLY for accounts that cannot use a password at all:
--   - unknown email               -> {}  (indistinguishable from the next case)
--   - account with a password     -> {}  ("invalid credentials" stays correct)
--   - Google/Apple-only account   -> {google} / {apple} / {apple,google}
--
-- Returning {} for both "no account" and "password account" means the function
-- cannot be used to probe whether an arbitrary email has an Avenas account; it
-- only reveals the provider list in the exact case where the login screen must
-- redirect the user to a social button.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (CREATE OR REPLACE only).

create or replace function public.login_providers_for_email(p_email text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_providers text[];
begin
  select array_agg(distinct i.provider)
    into v_providers
    from auth.users u
    join auth.identities i on i.user_id = u.id
    where lower(u.email) = lower(trim(p_email));

  if v_providers is null or 'email' = any(v_providers) then
    return array[]::text[];
  end if;
  return v_providers;
end;
$$;

revoke all on function public.login_providers_for_email(text) from public;
grant execute on function public.login_providers_for_email(text) to anon, authenticated;
