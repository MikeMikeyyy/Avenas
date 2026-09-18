-- A group can have a photo.
--
-- Groups have been drawn as a generic people icon everywhere they appear, which
-- is fine with one group and useless with six — the trainer hub, the invite
-- card, the group page and the chat all show a list of identical circles. The
-- owner picks an image; everyone who can see the group sees it.
--
-- Layout mirrors 0005 (profile avatars): the image lives in a PUBLIC Storage
-- bucket and the row holds its public URL, so it travels with the group row
-- through the same reads every screen already does and needs no second query.
-- The bucket is separate from 'avatars' because the folder check is a different
-- question — 'avatars' pins the first path segment to the caller's uid, and a
-- group photo belongs to the GROUP, not to whoever happens to own it today.
--
--   Storage layout:  group-avatars/<groupId>/avatar   (one object, upserted)
--
-- The write policies ask public.groups whether the caller owns that group. The
-- comparison is `g.id::text = <folder>` rather than casting the folder to uuid:
-- a policy has no guaranteed evaluation order, so a cast would be free to run
-- against a non-uuid folder name and error the whole statement. Reads are public
-- like 0005's, so the URL works without auth.
--
-- Nothing is required of existing rows: avatar_url stays null and every screen
-- keeps its icon fallback.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0016 (groups) and 0027 (group invites).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
--
--    groups_update (0016) is already owner-only, and RLS is row-level, so the
--    owner may write this column and nobody else can. No policy change needed.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.groups
  add column if not exists avatar_url text;

comment on column public.groups.avatar_url is
  'Public URL of the group photo in the group-avatars bucket. Null = no photo, screens fall back to the people icon.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The bucket
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('group-avatars', 'group-avatars', true)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Storage RLS
--
--    Anyone may read (the bucket is public and the URL is handed out in the
--    group row). Only the group's OWNER may write inside "<groupId>/", which is
--    the same authority that renames the group and manages its roster.
--
--    Postgres has no "create policy if not exists", so each is guarded by an
--    existence check — the same pattern 0005 uses, and what keeps this
--    re-runnable without any DROP.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'group_avatars_public_read'
  ) then
    create policy "group_avatars_public_read" on storage.objects
      for select using (bucket_id = 'group-avatars');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'group_avatars_owner_insert'
  ) then
    create policy "group_avatars_owner_insert" on storage.objects
      for insert with check (
        bucket_id = 'group-avatars'
        and exists (
          select 1 from public.groups g
          where g.id::text = (storage.foldername(name))[1]
            and g.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'group_avatars_owner_update'
  ) then
    create policy "group_avatars_owner_update" on storage.objects
      for update using (
        bucket_id = 'group-avatars'
        and exists (
          select 1 from public.groups g
          where g.id::text = (storage.foldername(name))[1]
            and g.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'group_avatars_owner_delete'
  ) then
    create policy "group_avatars_owner_delete" on storage.objects
      for delete using (
        bucket_id = 'group-avatars'
        and exists (
          select 1 from public.groups g
          where g.id::text = (storage.foldername(name))[1]
            and g.owner_id = auth.uid()
        )
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) The invite card gets the photo too
--
--    get_my_group_invites (0027) is the ONLY thing a pending invitee may read
--    about a group they haven't joined, and it returns exactly the fields the
--    card renders. The card now renders the photo, so the RPC returns it —
--    widening no policy, exactly as 0027 intended.
--
--    Return type changes, so it has to be dropped first; 0027 does the same for
--    get_group_members.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_my_group_invites();
create function public.get_my_group_invites()
returns table (
  group_id     uuid,
  name         text,
  avatar_url   text,
  owner_id     uuid,
  owner_name   text,
  owner_avatar text,
  member_count integer,
  invited_at   timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    g.id,
    g.name,
    g.avatar_url,
    g.owner_id,
    o.name,
    o.avatar_url,
    (select count(*)::integer from public.group_members c
      where c.group_id = g.id and c.accepted_at is not null),
    m.added_at
  from public.group_members m
  join public.groups   g on g.id = m.group_id
  join public.profiles o on o.id = g.owner_id
  where m.user_id = auth.uid()
    and m.accepted_at is null
  order by m.added_at desc;
$$;
grant execute on function public.get_my_group_invites() to authenticated;
