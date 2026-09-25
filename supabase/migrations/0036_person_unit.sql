-- A trainer sees a client's weights in the CLIENT's unit, and is told when the
-- two differ.
--
-- profiles.unit has existed since 0001, but nobody else could read it (profiles
-- are owner-only) and it was only written at sign-up and on the Profile screen,
-- never when someone flipped kg/lb in Settings. The app now writes it on every
-- change (lib/cloud.ts pushUnit) and once at launch; this adds the two reads.
--
--   * get_client_training carries the person's unit, so the client page shows
--     their logged sets, PRs and charts in the unit they log in (and caches it
--     with the rest of the snapshot for offline). Same signature and return
--     type, so this is a plain replace; an app older than this build simply
--     doesn't look for the new key.
--   * get_people_units(uuid[]) is the light read for the warnings: the program
--     builder reviewing someone's program, and the send sheets. It answers for
--     anyone the caller has an ACCEPTED connection with or shares a group with
--     (both memberships accepted), which is everyone those screens can show.
--     Anyone else is simply absent.
--
-- A unit is not sensitive, but it is still only handed to people who already
-- see each other's names in the app, the same boundary get_group_members keeps.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0027 (is_group_member) and 0032.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The client's training, now with their unit
--
--    Body unchanged from 0032 apart from 'unit'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_client_training(p_client uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'get_client_training: not authenticated';
  end if;
  if not public.can_view_training(p_client) then
    return null;
  end if;

  return jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.programs p where p.user_id = p_client
    ), '[]'::jsonb),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.completed_at desc)
      from public.workouts w where w.user_id = p_client
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from public.journal_entries j where j.user_id = p_client
    ), '[]'::jsonb),
    'custom', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.name)
      from public.custom_exercises c where c.user_id = p_client
    ), '[]'::jsonb),
    'backed_up_at', (
      select max(u) from (
        select max(updated_at) as u from public.programs where user_id = p_client
        union all select max(updated_at) from public.workouts where user_id = p_client
        union all select max(updated_at) from public.journal_entries where user_id = p_client
        union all select max(updated_at) from public.custom_exercises where user_id = p_client
      ) s
    ),
    -- 'kg' | 'lb': what they log in, so the trainer sees their numbers as
    -- they wrote them.
    'unit', (select pr.unit from public.profiles pr where pr.id = p_client)
  );
end;
$$;
grant execute on function public.get_client_training(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Several people's units, for the warnings
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_people_units(p_ids uuid[])
returns table (user_id uuid, unit text)
language sql
security definer
stable
set search_path = ''
as $$
  select pr.id, pr.unit
  from public.profiles pr
  where pr.id = any(coalesce(p_ids, '{}'::uuid[]))
    and auth.uid() is not null
    and pr.id <> auth.uid()
    and (
      exists (
        select 1 from public.connections c
        where c.status = 'accepted'
          and ((c.requester_id = auth.uid() and c.addressee_id = pr.id)
            or (c.requester_id = pr.id and c.addressee_id = auth.uid()))
      )
      or exists (
        select 1 from public.group_members mine
        join public.group_members theirs on theirs.group_id = mine.group_id
        where mine.user_id = auth.uid() and mine.accepted_at is not null
          and theirs.user_id = pr.id and theirs.accepted_at is not null
      )
    );
$$;
grant execute on function public.get_people_units(uuid[]) to authenticated;
