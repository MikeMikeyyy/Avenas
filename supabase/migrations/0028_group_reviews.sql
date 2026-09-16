-- A gym user can post a program to their group for review.
--
-- 0013's review flow is 1:1 — a gym user sends a program to THEIR trainer and
-- that trainer sends it back. A gym is not one trainer: whoever is free picks
-- the program up. So a review can now be addressed to a GROUP, and any coach of
-- that group can review it and send it back.
--
-- One row, not one per coach. A group review is a queue item, not a request for
-- N second opinions, and N rows would mean N different returned snapshots of
-- the same program with nothing to say which one the client should follow.
-- recipient_id is the group's owner, because the column is NOT NULL and the
-- owner is the group's responsible party — but group_id is what actually
-- decides who may act on it, through coaches_group() from 0026.
--
-- `completed_at` is what stops the queue growing forever. A coach marks a
-- review done and it leaves the group's list; the gym user keeps it on their
-- own page either way, because it's their record of having asked.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive. Requires 0013 (shared_programs), 0016 (groups), 0022 (roles),
-- 0026 (group shares) and 0027 (group invites).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) The column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.shared_programs
  add column if not exists completed_at timestamptz;

create index if not exists shared_programs_group_open on public.shared_programs (group_id)
  where group_id is not null and completed_at is null;

comment on column public.shared_programs.completed_at is
  'A group coach marked this review dealt with. Null = still in the group queue.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Sending a review TO a group
--
--    0013 required an accepted 1:1 connection between sender and recipient, and
--    0022 added the coach-to-client route. Neither covers this direction: a gym
--    member is generally not connected to the gym's owner, and they are the
--    CLIENT here, not the coach. The new branch is the mirror of 0022's — you
--    may send to someone who coaches YOU in a group.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists shared_programs_insert on public.shared_programs;
create policy shared_programs_insert on public.shared_programs
  for insert with check (
    (select auth.uid()) = sender_id
    and sender_id <> recipient_id
    and (
      exists (
        select 1 from public.connections c
        where c.status = 'accepted'
          and ((c.requester_id = sender_id and c.addressee_id = recipient_id)
            or (c.requester_id = recipient_id and c.addressee_id = sender_id))
      )
      or public.can_coach_in_group(sender_id, recipient_id)
      -- Sending a program for review to a group that coaches me. Pinned to
      -- group_id so this cannot be used to reach a coach outside the group the
      -- row claims to belong to.
      or (
        group_id is not null
        and public.is_group_member(group_id, sender_id)
        and public.coaches_group(recipient_id, group_id)
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Any coach of the group can act on the group's rows
--
--    Reviewing means writing returned_at, trainer_comments and
--    returned_snapshot, so a trainer who is not the row's recipient needs
--    UPDATE. Widened only for rows carrying a group_id — a direct send is
--    untouched, and the client keeps its column whitelist in
--    utils/trainerStore.ts either way.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists shared_programs_update on public.shared_programs;
create policy shared_programs_update on public.shared_programs
  for update using (
    (select auth.uid()) in (sender_id, recipient_id)
    or (group_id is not null and public.coaches_group((select auth.uid()), group_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Marking a review done
--
--    An RPC rather than a column in the policy above, so "clear this from the
--    queue" is a thing only a COACH can do — the sender can update their own
--    row for other reasons and must not be able to close their own review.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_group_review_completed(p_share uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'set_group_review_completed: not authenticated';
  end if;

  select group_id into v_group from public.shared_programs where id = p_share;
  if v_group is null then
    raise exception 'set_group_review_completed: not a group program';
  end if;
  if not public.coaches_group(v_uid, v_group) then
    raise exception 'set_group_review_completed: not a coach of this group';
  end if;

  update public.shared_programs
     set completed_at = case when p_done then now() else null end
   where id = p_share;
end;
$$;
grant execute on function public.set_group_review_completed(uuid, boolean) to authenticated;
