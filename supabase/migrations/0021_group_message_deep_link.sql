-- Point group-message notifications at the conversation, not the group page.
--
-- 0016 deep-linked these to '/trainer/group/<id>', which was the chat at the
-- time. That route is now the group's own page (its member roster), and the
-- conversation moved one level down to '/trainer/group/<id>/chat'.
--
-- Without this, tapping a "new message" notification drops the user on the
-- roster and they have to find their way into the thread they were told about.
--
-- Only the URL changes; the body, category and fan-out are as they were.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent
-- (CREATE OR REPLACE); the trigger from 0016 keeps pointing at this function,
-- so nothing else needs recreating.

create or replace function public.notify_new_group_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
  v_group  text;
  v_member uuid;
begin
  select name into v_sender from public.profiles where id = new.sender_id;
  select name into v_group  from public.groups   where id = new.group_id;

  for v_member in
    select m.user_id from public.group_members m
     where m.group_id = new.group_id and m.user_id <> new.sender_id
  loop
    perform public.send_expo_push(
      v_member,
      'coachMessages',
      coalesce(nullif(trim(v_group), ''), 'Group'),
      coalesce(nullif(trim(v_sender), ''), 'Someone') || ': ' || left(new.body, 120),
      jsonb_build_object('url', '/trainer/group/' || new.group_id || '/chat')
    );
  end loop;
  return new;
end;
$$;
