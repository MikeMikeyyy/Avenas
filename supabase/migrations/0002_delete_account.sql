-- Lets a signed-in user delete THEIR OWN account. Deleting the auth.users row
-- cascades (via the on-delete-cascade FKs) to remove profiles + all their data.
-- security definer so it can touch auth.users; `where id = auth.uid()` makes it
-- impossible to delete anyone else's account.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

-- Only a logged-in user may call it (anon would have a null uid anyway).
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
