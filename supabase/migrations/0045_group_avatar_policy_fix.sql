-- A group's owner can upload its photo.
--
-- 0030's write policies on storage.objects asked whether the caller owns the
-- group named by the object's first folder:
--
--   exists (select 1 from public.groups g
--           where g.id::text = (storage.foldername(name))[1] and g.owner_id = auth.uid())
--
-- Inside `from public.groups g` an unqualified `name` is the GROUP's name
-- column, which shadows the object's. So it compared the group's id with the
-- folder of the group's NAME ("Monday Strength" has no folder, so null), never
-- matched, and every upload was refused: Save with a photo said "Couldn't save
-- group", and a new group with one said the photo didn't upload (user report,
-- 2026-10-13). No group photo has ever been stored.
--
-- Here each policy names the object's column as `objects.name`. Nothing else
-- changes: the bucket, the public read and who may write (the owner only).
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent.
-- Requires 0030. scripts/verify-db.ts section 8b covers it.

drop policy if exists "group_avatars_owner_insert" on storage.objects;
create policy "group_avatars_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'group-avatars'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and g.owner_id = auth.uid()
    )
  );

drop policy if exists "group_avatars_owner_update" on storage.objects;
create policy "group_avatars_owner_update" on storage.objects
  for update using (
    bucket_id = 'group-avatars'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and g.owner_id = auth.uid()
    )
  );

drop policy if exists "group_avatars_owner_delete" on storage.objects;
create policy "group_avatars_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'group-avatars'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and g.owner_id = auth.uid()
    )
  );
