-- Adds a profile photo. The image itself lives in a public Storage bucket
-- ("avatars"); profiles.avatar_url holds the public URL so it syncs with the
-- rest of the profile (pushProfile / pullProfile) and survives reinstall.
--
-- Storage layout: each user owns the folder "<uid>/" and writes a single object
-- "<uid>/avatar". Reads are public (so the URL works without auth, ready for any
-- future cross-account viewing); writes are restricted to the owning user via
-- the folder-name check below.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive: it only adds a column, the bucket, and the RLS policies if
-- they aren't already present (no DROP statements).

alter table public.profiles
  add column if not exists avatar_url text;

-- Public bucket for avatars (id == name == 'avatars').
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- RLS on storage.objects (already enabled by Supabase). Anyone may read an
-- avatar; only the owner may create/replace/delete objects inside their own
-- "<uid>/" folder. storage.foldername(name) splits the object path into folders;
-- element [1] is the first segment, which we pin to the caller's uid.
--
-- Postgres has no "create policy if not exists", so each policy is guarded by an
-- existence check. This keeps the migration re-runnable without any DROP.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_public_read'
  ) then
    create policy "avatars_public_read" on storage.objects
      for select using (bucket_id = 'avatars');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_owner_insert'
  ) then
    create policy "avatars_owner_insert" on storage.objects
      for insert with check (
        bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_owner_update'
  ) then
    create policy "avatars_owner_update" on storage.objects
      for update using (
        bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_owner_delete'
  ) then
    create policy "avatars_owner_delete" on storage.objects
      for delete using (
        bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
