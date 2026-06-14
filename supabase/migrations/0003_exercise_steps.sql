-- Adds per-custom-exercise how-to steps and a playback mute flag.
-- `steps` mirrors the bundled catalogue's `instructions` (one entry per numbered
-- step). `muted` controls whether the demo clip plays with sound. Both are
-- additive and nullable/defaulted, so existing rows and older app builds keep
-- working unchanged (older builds simply ignore the new columns).

alter table public.custom_exercises
  add column if not exists steps text[],
  add column if not exists muted boolean not null default false;
