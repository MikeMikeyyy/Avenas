// The server, in memory: every migration applied to PGlite (Postgres compiled
// to WebAssembly), with what hosted Supabase provides that plain Postgres
// doesn't stood in for. Shared by scripts/verify-db.ts and
// scripts/verify-program-flows.ts.

import { PGlite } from "@electric-sql/pglite";

// The app has no Node type definitions, and shouldn't: they'd change the
// globals every screen compiles against. So the little of Node used here is
// typed here instead (React Native already declares `require`).
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- an `import` would need @types/node, see above
const { readdirSync, readFileSync } = require("node:fs") as {
  readdirSync(dir: string): string[];
  readFileSync(file: string, encoding: "utf8"): string;
};

export const MIGRATIONS = `${__dirname}/../../supabase/migrations`;

/**
 * What hosted Supabase provides that plain Postgres doesn't, reduced to what
 * the migrations touch. auth.uid() reads `request.jwt.claim.sub`, the setting
 * Supabase's own version reads.
 */
export const SUPABASE_STANDINS = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create table auth.identities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    provider text
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

  -- pg_net (0012): the push trigger's HTTP call. Never reached here, since no
  -- test account registers a push token, but it has to exist.
  create schema net;
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
    returns bigint language sql as $$ select 0::bigint $$;
`;

/**
 * Supabase's own grants: everything created in `public` is granted to the API
 * roles by default, and Row Level Security is what actually decides. Needed
 * when queries run AS those roles (verify-program-flows.ts), so the policies
 * are what's tested rather than a missing grant. Applied before the
 * migrations, so a migration that revokes something still gets its way.
 */
export const SUPABASE_API_GRANTS = `
  grant usage on schema public to anon, authenticated, service_role;
  -- So a function running as the caller can call auth.uid(), as on Supabase.
  grant usage on schema auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

/** Statements only hosted Supabase can run, with the stand-in above doing the job. */
export function prepare(sql: string): string {
  return sql.replace(/create extension if not exists pg_net;/gi, "-- pg_net: see SUPABASE_STANDINS");
}

/** Every migration file, in order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort();
}

export function readMigration(file: string): string {
  return prepare(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
}

/** A fresh database with every migration applied. Throws on the first one
 *  that doesn't apply, naming it. */
export async function createDb(opts: { apiGrants?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  if (opts.apiGrants) await db.exec(SUPABASE_API_GRANTS);
  for (const f of migrationFiles()) {
    try {
      await db.exec(readMigration(f));
    } catch (e) {
      throw new Error(`migration ${f} failed to apply: ${(e as Error).message}`);
    }
  }
  return db;
}
