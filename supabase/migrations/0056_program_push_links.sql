-- A program notification says which program it's about, so a tap opens it.
--
-- Every program notification carried one link, the Trainer tab ('/trainer-hub'),
-- whatever it was about: a program sent to you, a review asked of you, or a
-- review sent back to you. The app could only open the tab (a trainer's
-- Programs page), and you went looking for it (user request, 2026-11-06: the
-- notification should take you where it should take you).
--
-- Now each one also carries what it's about, beside the same link:
--
--   share  the shared_programs row
--   kind   'share' (a program) or 'review' (a program to review)
--   event  'sent' (sent to you) or 'returned' (a review you asked for, sent back)
--   group  the group it went through, or null
--
-- and the app opens that program over the page it's listed on (a gym user's
-- Programs or Sent for Review, a trainer's Programs, or the group's Programs),
-- the Trainer tab under them (utils/notificationRoute.ts). The link stays
-- '/trainer-hub', so a build from before this, which reads the link alone,
-- does exactly what it did.
--
-- Body unchanged from 0054 but for the data. Apply with `supabase db push` or
-- paste into the SQL editor, after 0055. Builds from before it keep working,
-- and so does the build that reads it before it's applied (its notifications
-- then open the tab, as now). Idempotent and non-destructive (one replaced
-- trigger function; no data changes).

create or replace function public.notify_shared_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_actor uuid;
  v_body  text;
begin
  if tg_op = 'INSERT' then
    if public.has_blocked(new.recipient_id, new.sender_id) then
      return new;
    end if;
    select name into v_name from public.profiles where id = new.sender_id;
    perform public.send_expo_push(
      new.recipient_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Someone'),
      case when new.kind = 'review'
        then 'Sent you "' || new.program_name || '" to review.'
        else 'Sent you a program: "' || new.program_name || '".'
      end,
      jsonb_build_object('url', '/trainer-hub', 'share', new.id, 'kind', new.kind, 'event', 'sent', 'group', new.group_id)
    );
  elsif tg_op = 'UPDATE' and new.returned_at is not null
        and new.returned_at is distinct from old.returned_at then
    -- The trainer acting, when there is one (return_shared_review runs as the
    -- caller's request); the row's recipient otherwise.
    v_actor := coalesce(auth.uid(), new.recipient_id);
    if public.has_blocked(new.sender_id, v_actor) then
      return new;
    end if;
    v_body := case
      when old.returned_at is null and old.draft_snapshot is null and old.returned_snapshot is null
        then 'Reviewed "' || new.program_name || '" with no changes.'
      when old.returned_at is null
        then 'Returned "' || new.program_name || '" with their changes.'
      when old.draft_snapshot is not null
        then 'Sent an update to "' || new.program_name || '".'
      when new.trainer_comments is not null
        then 'Left a comment on "' || new.program_name || '".'
    end;
    if v_body is null then
      return new;
    end if;
    select name into v_name from public.profiles where id = v_actor;
    perform public.send_expo_push(
      new.sender_id,
      'programShared',
      coalesce(nullif(trim(v_name), ''), 'Your trainer'),
      v_body,
      jsonb_build_object('url', '/trainer-hub', 'share', new.id, 'kind', new.kind, 'event', 'returned', 'group', new.group_id)
    );
  end if;
  return new;
end;
$$;
