-- Reportable profiles: names and photos (Apple Guideline 1.2 — Safety / UGC).
--
-- 0014 covered reports against a person ('user') and a single message
-- ('message'). Neither is much use for an offensive display name or profile
-- picture:
--
--   * an operator reading "Inappropriate or offensive" against a user has no
--     idea whether to review the messages, the name, or the photo; and
--   * unlike a message — whose text 0014 snapshots precisely because the row can
--     be deleted — a name and avatar_url are LIVE fields the reported account
--     can change the moment they're reported, so the evidence is gone before
--     anyone looks at it.
--
-- So: a 'profile' kind, plus snapshot columns capturing what the reporter
-- actually saw at the moment they filed.
--
-- Apply with `supabase db push` or paste into the SQL editor. Idempotent and
-- non-destructive (adds two nullable columns and widens one CHECK).

alter table public.reports
  add column if not exists reported_name       text,
  add column if not exists reported_avatar_url text;

comment on column public.reports.reported_name is
  'Display name at report time. Snapshotted because profiles.name is mutable.';
comment on column public.reports.reported_avatar_url is
  'Avatar URL at report time. Snapshotted because profiles.avatar_url is mutable; the object may since have been replaced or deleted.';

-- Widen the kind check to admit 'profile'. Drop-and-recreate is the only way to
-- alter a CHECK; the constraint name is the default Postgres assigns, and the
-- guarded block keeps this safe to re-run.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_kind_check'
  ) then
    alter table public.reports drop constraint reports_kind_check;
  end if;

  alter table public.reports
    add constraint reports_kind_check check (kind in ('user', 'message', 'profile'));
end $$;
