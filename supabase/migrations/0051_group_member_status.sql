-- 0051: what a group's members see of each other on its page (user request,
-- 2026-10-22): the program each is running, and when each was last on the
-- app ("Active now" / "Last active 2h ago"), for trainers and gym users alike.
--
-- Until now neither reached a fellow member: last_active_at only came through
-- get_my_connections, to connections, and a program only through
-- can_view_training, to a connected trainer. This is the one read that gives
-- them to a group's members, about each other, and it keeps every existing
-- rule:
--
--   * Only between members who have JOINED: the caller must be in the group
--     (is_group_member requires accepted_at), and an invite still unanswered
--     isn't listed. The caller isn't listed either: their own row is theirs.
--   * profiles.share_activity (0009, the Activity Status switch in Privacy &
--     Security) now hides BOTH when it's off (user decision, 2026-10-22: one
--     switch). A hidden person's timestamp and program come back NULL, so they
--     never reach another phone, and "hidden" reads exactly like "never active,
--     no program", as 0009 made it for presence.
--   * A connected trainer keeps their coaching access: can_view_training lets
--     them see a client's program here whatever the switch says, as they can on
--     the client page (user decision, the same day). Presence stays hidden from
--     them too, as get_my_connections already does.
--   * Someone who has blocked the caller (0040) isn't listed at all.
--
-- Read-only and SECURITY DEFINER (profiles and programs aren't selectable
-- across accounts under RLS). Idempotent: CREATE OR REPLACE, no table changes,
-- so replace_user_data is untouched.

create or replace function public.get_group_member_status(p_group uuid)
returns table (
  user_id        uuid,
  active_program text,
  last_active_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    m.user_id,
    case when p.share_activity or public.can_view_training(m.user_id) then (
      select pr.name from public.programs pr
       where pr.user_id = m.user_id and pr.status = 'active'
       order by pr.updated_at desc
       limit 1
    ) end,
    case when p.share_activity then p.last_active_at end
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and m.accepted_at is not null
    and m.user_id <> auth.uid()
    and public.is_group_member(p_group, auth.uid())
    and not public.has_blocked(m.user_id, auth.uid());
$$;

revoke all on function public.get_group_member_status(uuid) from public, anon;
grant execute on function public.get_group_member_status(uuid) to authenticated, service_role;
