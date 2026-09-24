// The server side, against a real Postgres.
//
// Every file in supabase/migrations is applied, in order, to PGlite (Postgres
// compiled to WebAssembly, running in memory: no install, no server), and then
// the SQL nothing else tests is exercised with fake accounts:
//
//   1. BACKUP ROUND-TRIP. A program, workout, journal entry and custom exercise
//      with EVERY field filled in go through the app's own payload builder
//      (lib/mappers.ts) and replace_user_data, come back out through the app's
//      own row mappers, and must come back unchanged. replace_user_data lists
//      its insert columns by hand, and forgetting to add a new one silently
//      blanked it on every backup: paused_at, then skipped/pushed/pulled_dates.
//      The fixtures are typed `Required<...>`, so adding a field to SavedProgram
//      (or the others) fails the type-check here until it's added below, and
//      then this run fails until the backup actually carries it.
//   2. A custom exercise with no steps backs up. `steps: null` made every backup
//      from such an account fail outright, from 0004 until 0032.
//   3. WHO READS WHOSE TRAINING (0032): only a trainer with an accepted
//      connection; never a gym user, never someone unconnected or pending, and
//      not after the connection goes. What they read is the same data, with
//      each workout still pointing at its program.
//
// Supabase-only pieces are stood in for by SUPABASE_STANDINS below (the auth
// and storage schemas, pg_net, the API roles). Login is simulated: auth.uid()
// reads a setting the test switches between accounts, so this checks what the
// functions DO for a given caller, not the API's own role grants.
//
// Run:  npx tsx scripts/verify-db.ts
// Exits non-zero if a migration fails to apply or any assertion fails.

import { PGlite } from "@electric-sql/pglite";

import type { CompletedWorkout, SavedProgram } from "../constants/programs";
import type { JournalEntry } from "../constants/journal";
import type { CustomExercise } from "../constants/exercises";
import type { CustomExerciseRow, JournalRow, ProgramRow, WorkoutRow } from "../lib/database.types";
import {
  customFromRow,
  journalFromRow,
  programFromRow,
  toReplaceUserDataPayload,
  workoutFromRow,
} from "../lib/mappers";

let passed = 0;
const failures: string[] = [];
/** Key order ignored: jsonb stores an object's keys in its own order, and key
 *  order means nothing to the app (see workoutsEqual in new-program.tsx). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, canon(o[k])]));
  }
  return v;
}
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(canon(actual));
  const b = JSON.stringify(canon(expected));
  if (a === b) { passed += 1; return; }
  failures.push(`✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
}

// The app has no Node type definitions, and shouldn't: they'd change the
// globals every screen compiles against. So the little of Node this script
// uses is typed here instead (React Native already declares `require`).
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- an `import` would need @types/node, see above
const { readdirSync, readFileSync } = require("node:fs") as {
  readdirSync(dir: string): string[];
  readFileSync(file: string, encoding: "utf8"): string;
};

const MIGRATIONS = `${__dirname}/../supabase/migrations`;

/**
 * What hosted Supabase provides that plain Postgres doesn't, reduced to what
 * the migrations touch. auth.uid() reads `request.jwt.claim.sub`, the setting
 * Supabase's own version reads, which `as()` below sets per "request".
 */
const SUPABASE_STANDINS = `
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
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
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

/** Statements only hosted Supabase can run, with the stand-in above doing the job. */
function prepare(sql: string): string {
  return sql.replace(/create extension if not exists pg_net;/gi, "-- pg_net: see SUPABASE_STANDINS");
}

// ─── Accounts ───────────────────────────────────────────────────────────────
const TRAINER    = "aaaaaaaa-0000-4000-8000-000000000001"; // connected to CLIENT and COACHED_PT
const CLIENT     = "bbbbbbbb-0000-4000-8000-000000000002"; // gym user, backs up below
const STRANGER   = "cccccccc-0000-4000-8000-000000000003"; // trainer, not connected to CLIENT
const GYM_USER   = "dddddddd-0000-4000-8000-000000000004"; // gym user, connected to STRANGER only
const COACHED_PT = "eeeeeeee-0000-4000-8000-000000000005"; // a trainer taken on as a client
const PENDING_PT = "ffffffff-0000-4000-8000-000000000006"; // trainer whose request CLIENT hasn't accepted

// ─── Fixtures: every field set ──────────────────────────────────────────────
// `Required<>` is the point: a new field on these types won't type-check here
// until it's given a value, and then the round-trip below has to carry it.

const fullProgram: Required<SavedProgram> = {
  id: "program_1",
  name: "Push Pull Legs",
  totalWeeks: 8,
  currentWeek: 3,
  status: "active",
  startDate: "01 Sep 2026",
  completedDate: "20 Oct 2026",
  cycleOffset: 2,
  pausedAt: "2026-09-18",
  trainingDays: 3,
  cycleDays: 4,
  cyclePattern: ["Push", "Pull", "Legs", "Rest"],
  dayIds: ["d0", "d1", "d2", "d3"],
  skippedDates: ["2026-09-10", "2026-09-12"],
  pushedDates: ["2026-09-10"],
  pulledDates: ["2026-09-14"],
  workouts: {
    "0:Push": [{
      id: "e1", name: "Bench Press", isIsometric: false, restSeconds: 120, programNotes: "Pause on the chest",
      sets: [{ type: "warmup", weightKg: "40", reps: "10" }, { type: "working", weightKg: "80", repMode: "range", repsMin: "6", repsMax: "8" }],
    }],
    "1:Pull": [{ id: "e2", name: "Row", sets: [{ type: "working", weightKg: "60", repMode: "target", reps: "10" }] }],
  },
  extraWorkouts: ["Arms"],
};

/** A second program, so program_index has something to tell apart, with the
 *  optional fields absent: they must come back absent, not as empty values. */
const bareProgram: SavedProgram = {
  id: "program_2",
  name: "Old Block",
  totalWeeks: 4,
  currentWeek: 0,
  status: "created",
  startDate: "",
  trainingDays: 2,
  cycleDays: 3,
  cyclePattern: ["Upper", "Lower", "Rest"],
  workouts: {},
  extraWorkouts: [],
};

const fullWorkout: Required<CompletedWorkout> = {
  id: "workout_1",
  date: "2026-09-02",
  completedAt: "2026-09-02T18:30:00.000Z",
  workoutName: "Push",
  durationSeconds: 3725,
  exercises: [{
    name: "Bench Press",
    notes: "Felt strong",
    sets: [{ type: "warmup", weight: "40", reps: "10", done: true }, { type: "working", weight: "82.5", reps: "6", done: false }],
    programExerciseId: "e1",
  }, {
    // Swapped in for the program's exercise: the record of what it replaced
    // must survive a backup, or the note stops reaching the original.
    name: "Dumbbell Fly",
    notes: "Cable machine was busy",
    sets: [{ type: "working", weight: "14", reps: "12", done: true }],
    swappedFrom: "Cable Fly",
    programExerciseId: "e3",
  }],
  sessionNotes: "Good session",
  programId: "program_1",
  dayId: "d0",
};
const oldBlockWorkout: CompletedWorkout = {
  id: "workout_2", date: "2026-08-01", completedAt: "2026-08-01T09:00:00.000Z", workoutName: "Upper",
  durationSeconds: 1800, exercises: [], programId: "program_2", dayId: "d0",
};
const freeWorkout: CompletedWorkout = {
  id: "workout_3", date: "2026-09-05", completedAt: "2026-09-05T07:15:00.000Z", workoutName: "Run",
  durationSeconds: 900, exercises: [], programId: "",
};
/** From before programId existed: no programId at all, so the app works out
 *  its program from the day name and dates. Must not come back as free (""),
 *  which counts towards no program (0033). */
const legacyWorkout: CompletedWorkout = {
  id: "workout_4", date: "2026-07-01", completedAt: "2026-07-01T17:00:00.000Z", workoutName: "Push",
  durationSeconds: 2400, exercises: [],
};

const fullEntry: Required<JournalEntry> = {
  id: "journal_1", title: "Week 1", body: "Solid start.\nSleep was good.", createdAt: "2026-09-03T07:30:00.000Z",
};

const fullCustom: Required<CustomExercise> = {
  name: "Band Pull-Apart",
  muscles: ["Back", "Shoulders"],
  imageUri: "file:///photo.jpg",
  videoUri: "file:///clip.mov",
  muted: true,
  steps: ["Grip the band", "Pull apart"],
  description: "Old single-paragraph description",
};
/** No steps: the case that failed every backup until 0032. */
const stepless: CustomExercise = { name: "Cable Fly", muscles: ["Chest"] };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Timestamps come back in Postgres's form ("+00:00"), so they're compared as instants. */
const INSTANT_FIELDS = new Set(["completedAt", "createdAt"]);

/** Field-by-field, so a failure names the field that didn't survive. */
function sameFields(label: string, actual: object, expected: object, skip: string[] = []) {
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(e)].filter(k => !skip.includes(k)));
  for (const k of keys) {
    if (INSTANT_FIELDS.has(k) && typeof a[k] === "string" && typeof e[k] === "string") {
      eq(Date.parse(a[k] as string), Date.parse(e[k] as string), `${label}: ${k}`);
    } else {
      eq(a[k], e[k], `${label}: ${k}`);
    }
  }
}

async function main() {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);

  // ─── Every migration applies, in order ────────────────────────────────────
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      await db.exec(prepare(readFileSync(`${MIGRATIONS}/${f}`, "utf8")));
      passed += 1;
    } catch (e) {
      failures.push(`✗ migration ${f} failed to apply: ${(e as Error).message}\n    (if it needs a Supabase-only feature, give it a stand-in in SUPABASE_STANDINS)`);
      break; // later migrations build on it
    }
  }
  if (failures.length > 0) return finish(db);

  const as = (uid: string | null) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  for (const [id, type] of [
    [TRAINER, "pt"], [CLIENT, "user"], [STRANGER, "pt"], [GYM_USER, "user"], [COACHED_PT, "pt"], [PENDING_PT, "pt"],
  ] as const) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, `${id}@example.com`]);
    await db.query(`update public.profiles set account_type = $2 where id = $1`, [id, type]);
  }
  const connect = (from: string, to: string, status = "accepted") =>
    db.query(`insert into public.connections (requester_id, addressee_id, status) values ($1, $2, $3)`, [from, to, status]);
  await connect(CLIENT, TRAINER);   // the client asked: direction must not matter
  await connect(STRANGER, GYM_USER);
  await connect(TRAINER, COACHED_PT);
  await connect(PENDING_PT, CLIENT, "pending");

  /** A backup exactly as lib/cloud.ts pushes one. */
  const backup = async (uid: string, programs: SavedProgram[], history: CompletedWorkout[], journal: JournalEntry[], custom: CustomExercise[]) => {
    await as(uid);
    const p = toReplaceUserDataPayload(programs, history, journal, custom, uid);
    await db.query(`select public.replace_user_data($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)`,
      [JSON.stringify(p.p_programs), JSON.stringify(p.p_workouts), JSON.stringify(p.p_journal), JSON.stringify(p.p_custom)]);
  };
  /**
   * One table's rows for `uid`, shaped the way the API hands them to the app.
   * The API serialises rows through Postgres's own JSON, so dates arrive as
   * "YYYY-MM-DD" and timestamps as ISO strings; read straight through PGlite
   * they'd be JavaScript Dates, which the app never sees.
   */
  const rowsOf = async <T>(table: string, uid: string, orderBy: string): Promise<T[]> =>
    (await db.query<{ rows: T[] }>(
      `select coalesce(jsonb_agg(to_jsonb(t) order by ${orderBy}), '[]'::jsonb) as rows from public.${table} t where t.user_id = $1`,
      [uid],
    )).rows[0].rows;
  /** The owner's own read, as lib/cloud.ts pulls it. */
  const pull = async (uid: string) => ({
    programs: (await rowsOf<ProgramRow>("programs", uid, "t.created_at")).map(programFromRow),
    workouts: (await rowsOf<WorkoutRow>("workouts", uid, "t.completed_at desc")).map(workoutFromRow),
    journal: (await rowsOf<JournalRow>("journal_entries", uid, "t.created_at desc")).map(journalFromRow),
    custom: (await rowsOf<CustomExerciseRow>("custom_exercises", uid, "t.name")).map(customFromRow),
  });

  // ─── 1 + 2. Backup round-trip ─────────────────────────────────────────────
  // Backed up TWICE: a backup replaces, so the second must leave one copy, not two.
  const backUpEverything = () => backup(
    CLIENT,
    [fullProgram, bareProgram],
    [fullWorkout, oldBlockWorkout, freeWorkout, legacyWorkout],
    [fullEntry],
    [fullCustom, stepless],
  );
  try {
    await backUpEverything();
    await backUpEverything();
  } catch (e) {
    // What a phone sees: the whole backup refused, so nothing of theirs is in
    // the cloud. Nothing below means anything without it.
    failures.push(`✗ backup: replace_user_data refused the backup outright: ${(e as Error).message}`);
    return finish(db);
  }
  const cloud = await pull(CLIENT);
  eq([cloud.programs.length, cloud.workouts.length, cloud.journal.length, cloud.custom.length], [2, 4, 1, 2],
    "backup: a second backup replaces the first rather than adding to it");

  const byName = new Map(cloud.programs.map(p => [p.name, p]));
  const full = byName.get(fullProgram.name);
  const bare = byName.get(bareProgram.name);
  if (!full || !bare) {
    failures.push("✗ backup: a program didn't come back at all");
  } else {
    // Program ids are re-minted by every backup; everything else must survive.
    sameFields("program with every field", full, fullProgram, ["id"]);
    sameFields("program with no optional fields", bare, bareProgram, ["id"]);

    const back = new Map(cloud.workouts.map(w => [Date.parse(w.completedAt), w]));
    const w1 = back.get(Date.parse(fullWorkout.completedAt));
    const w2 = back.get(Date.parse(oldBlockWorkout.completedAt));
    const w3 = back.get(Date.parse(freeWorkout.completedAt));
    const w4 = back.get(Date.parse(legacyWorkout.completedAt));
    if (!w1 || !w2 || !w3 || !w4) {
      failures.push("✗ backup: a workout didn't come back at all");
    } else {
      sameFields("workout with every field", w1, fullWorkout, ["id", "programId"]);
      eq(w1.programId, full.id, "workout: still points at its program after the ids are re-minted");
      eq(w2.programId, bare.id, "workout: a second program's session points at the second program");
      eq(w3.programId, "", "workout: a free workout stays free");
      eq(w4.programId, undefined, "workout: a legacy record stays legacy (still counted by name), not free");
    }
  }
  const entry = cloud.journal[0];
  if (entry) sameFields("journal entry", entry, fullEntry, ["id"]);
  const [bandPull, cableFly] = cloud.custom;
  if (bandPull) sameFields("custom exercise with every field", bandPull, fullCustom);
  if (cableFly) sameFields("custom exercise with no steps", cableFly, stepless);

  // Another account's backup never touches this one's rows.
  await backup(STRANGER, [], [freeWorkout], [], []);
  eq((await pull(CLIENT)).workouts.length, cloud.workouts.length, "backup: one account's backup leaves another's rows alone");

  // ─── 3. Who reads whose training ──────────────────────────────────────────
  const training = async (of: string) =>
    (await db.query<{ j: Record<string, unknown[]> & { backed_up_at: string | null } | null }>(
      `select public.get_client_training($1) as j`, [of])).rows[0].j;

  await as(TRAINER);
  const read = await training(CLIENT);
  eq(read !== null, true, "access: a connected trainer reads a client's training");
  if (read) {
    const programs = (read.programs as ProgramRow[]).map(programFromRow);
    const workouts = (read.workouts as WorkoutRow[]).map(workoutFromRow);
    eq([programs.length, workouts.length, read.journal.length, read.custom.length], [2, 4, 1, 2],
      "access: all four lists come through");
    eq(workouts.filter(w => w.programId).every(w => programs.some(p => p.id === w.programId)), true,
      "access: every program session points at a program in the same read");
    eq(workouts.map(w => w.workoutName), ["Run", "Push", "Upper", "Push"], "access: workouts newest first");
    eq(workouts.map(w => w.programId === undefined), [false, false, false, true],
      "access: the trainer sees the legacy session as legacy too, so it counts towards its program");
    const syncedAgo = Date.now() - Date.parse(read.backed_up_at ?? "");
    eq(syncedAgo >= 0 && syncedAgo < 60_000, true, "access: backed_up_at is the last backup's time");
  }
  const active = async (ids: string[]) =>
    (await db.query<{ user_id: string; name: string }>(`select * from public.get_clients_active_programs($1::uuid[])`, [ids])).rows;
  eq(await active([CLIENT, STRANGER, GYM_USER, COACHED_PT]), [{ user_id: CLIENT, name: fullProgram.name }],
    "access: active programs only for people the trainer may read");

  const coached = await training(COACHED_PT);
  eq(coached && [coached.programs.length, coached.backed_up_at], [0, null],
    "access: a trainer taken on as a client reads like anyone else (nothing backed up: empty, no sync time)");
  eq(await training(TRAINER), null, "access: nobody reads themselves through it");
  eq(await training("99999999-0000-4000-8000-000000000009"), null, "access: an unknown account gives nothing");

  await as(STRANGER);
  eq(await training(CLIENT), null, "access: an unconnected trainer gets nothing");
  eq(await active([CLIENT]), [], "access: ...and no active program either");
  await as(PENDING_PT);
  eq(await training(CLIENT), null, "access: a trainer whose request is still pending gets nothing");
  await as(CLIENT);
  eq(await training(TRAINER), null, "access: a gym user can't read their trainer");
  await as(GYM_USER);
  eq(await training(CLIENT), null, "access: a gym user can't read another gym user");
  await as(null);
  let refused = false;
  try { await training(CLIENT); } catch { refused = true; }
  eq(refused, true, "access: signed out is an error, not an empty answer");

  await db.query(`delete from public.connections where requester_id = $1 and addressee_id = $2`, [CLIENT, TRAINER]);
  await as(TRAINER);
  eq(await training(CLIENT), null, "access: removing the connection ends it");
  await connect(CLIENT, TRAINER);
  await db.query(`update public.profiles set account_type = 'user' where id = $1`, [TRAINER]);
  eq(await training(CLIENT), null, "access: a trainer who switches to gym user loses it");

  return finish(db);
}

async function finish(db: PGlite) {
  await db.close();
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`${passed} passed, 0 failed`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
