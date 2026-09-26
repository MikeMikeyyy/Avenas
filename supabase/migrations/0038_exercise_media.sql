-- Custom exercise photos and videos that travel with a program.
--
-- A program exercise used to reach its recipient as a bare name, so a
-- trainer's custom exercise showed up on the client's phone with none of what
-- the trainer made: no muscles, no steps, no photo, no demo clip. The details
-- now ride inside the program (the exercise's `customDetails`, in the workouts
-- jsonb, so no column), but the photo and video were files in the trainer's own
-- app folder, and a path to one means nothing on another phone. They're
-- uploaded here the first time a program using them is sent
-- (lib/exerciseMedia.ts), and the program carries the public URL.
--
--   Storage layout:  exercise-media/<uid>/<file name>
--
-- Same shape as 0005 (avatars): public reads, so the URL works for whoever the
-- program reaches without asking who they are, and writes only inside your own
-- "<uid>/" folder. A file is never overwritten with something else: its name
-- carries the time it was picked, so a replaced photo is a new object and the
-- programs already sent keep showing the one they were sent with.
--
-- The size cap is Supabase's own per-file ceiling on the free plan, and it is
-- the app's MAX_MEDIA_BYTES (constants/exercises.ts): the two move together.
-- The app refuses a bigger video when it's picked (and anything over a minute),
-- so this is the backstop; a clip from before that check is sent without its
-- video rather than failing the send. The types are what the custom exercise
-- screen saves (.jpg, .mp4) plus the ones older builds may have left behind.
--
-- Nothing is required of existing rows. Programs sent before this carry no
-- details, and show the bare name as before until they're sent again.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media', 'exercise-media', true, 52428800,
  array['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_public_read'
  ) then
    create policy "exercise_media_public_read" on storage.objects
      for select using (bucket_id = 'exercise-media');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_owner_insert'
  ) then
    create policy "exercise_media_owner_insert" on storage.objects
      for insert with check (
        bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_owner_update'
  ) then
    create policy "exercise_media_owner_update" on storage.objects
      for update using (
        bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'exercise_media_owner_delete'
  ) then
    create policy "exercise_media_owner_delete" on storage.objects
      for delete using (
        bucket_id = 'exercise-media' and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
