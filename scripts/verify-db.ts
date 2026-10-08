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
//   4. SENDING A REVIEW BACK (0034): the builder's edits stay a draft until
//      the trainer sends it back; Send Update hands over the new version and
//      reopens Accept for a client who took the last one; only the review's
//      trainer (or an accepted trainer of its group) can do it.
//   5-6. The group limits (0042: groups made, groups joined, people in a
//      group) and people's units (0036).
//   7. ARCHIVING (0037): a send is archived by its sender or a trainer of its
//      group, a review by its trainer(s), and never by the person on the
//      other end; a whole send moves in one call, and restoring clears it.
//   8. CUSTOM EXERCISE MEDIA (0038): anyone reads a photo or clip a program
//      carries; only its author writes, and only inside their own folder. The
//      carried details themselves are in the round-trip's program (1).
//   9. WHICH COLUMNS (0039): through the API, each party to a shared program
//      may change only what the app changes for them; archiving, closing and
//      sending back are the security-definer functions' alone, and nobody can
//      re-address a row.
//
// Supabase-only pieces are stood in for by SUPABASE_STANDINS in
// scripts/harness/db.ts (the auth and storage schemas, pg_net, the API roles),
// shared with scripts/verify-program-flows.ts. Login is simulated: auth.uid()
// reads a setting the test switches between accounts, so most of this checks
// what the functions DO for a given caller; 8 and 9 also run as the API's own
// role, since there the policies and triggers are the rule.
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
import { migrationFiles, readMigration, SUPABASE_STANDINS } from "./harness/db";

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
  // A hold it came back from (0043): without it the program page loses every
  // session before the hold once a backup is restored.
  holds: [{ from: "2026-09-05", to: "2026-09-09", shift: 4, offsetShift: 4 }],
  archivedAt: "2026-09-20",
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
      sets: [{ type: "warmup", weightKg: "40", reps: "10" }, { type: "working", weightKg: "80", weightUnit: "lb", repMode: "range", repsMin: "6", repsMax: "8" }],
    }],
    "1:Pull": [
      { id: "e2", name: "Row", sets: [{ type: "working", weightKg: "60", repMode: "target", reps: "10" }] },
      // A trainer's custom exercise, carried with the program (0038): its
      // details ride in the workouts jsonb, so the backup must bring them back.
      {
        id: "e4", name: "Landmine Twist", sets: [{ type: "working", reps: "12" }],
        customDetails: {
          name: "Landmine Twist",
          muscles: ["Core", "Shoulders"],
          imageUri: `https://example.supabase.co/storage/v1/object/public/exercise-media/${TRAINER}/exercise_icon_1.jpg`,
          videoUri: `https://example.supabase.co/storage/v1/object/public/exercise-media/${TRAINER}/exercise_video_1.mp4`,
          muted: true,
          steps: ["Brace", "Rotate through the hips"],
          by: TRAINER,
        },
      },
    ],
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
  }, {
    // A timed hold: its reps are seconds, and the flag that says so must
    // survive a backup or a restored plank counts as reps again.
    name: "Plank",
    notes: "",
    sets: [{ type: "working", weight: "", reps: "60", done: true }],
    programExerciseId: "e4",
    isIsometric: true,
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
  for (const f of migrationFiles()) {
    try {
      await db.exec(readMigration(f));
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

  // ─── 4. Sending a review back (0034) ──────────────────────────────────────
  // Rows written straight in, as the app writes them through the API: the
  // request, then the builder's saves (a draft_snapshot patch), then the RPC.
  const askForReview = async (sender: string, recipient: string, groupId: string | null = null) =>
    (await db.query<{ id: string }>(
      `insert into public.shared_programs (sender_id, recipient_id, kind, sender_program_id, program_name, snapshot, sent_key, group_id)
       values ($1, $2, 'review', 'program_1', 'Original', '{"name":"Original"}'::jsonb, 'k', $3) returning id`,
      [sender, recipient, groupId])).rows[0].id;
  const saveDraft = (id: string, name: string) =>
    db.query(`update public.shared_programs set draft_snapshot = $2::jsonb where id = $1`, [id, JSON.stringify({ name })]);
  type ReviewState = { draft: string | null; returned: string | null; isReturned: boolean; isAccepted: boolean };
  const stateOf = async (id: string): Promise<ReviewState> => (await db.query<ReviewState>(
    `select draft_snapshot->>'name' as draft, returned_snapshot->>'name' as returned,
            returned_at is not null as "isReturned", accepted_at is not null as "isAccepted"
       from public.shared_programs where id = $1`, [id])).rows[0];
  const sendBack = async (as_: string | null, id: string): Promise<boolean> => {
    await as(as_);
    try { await db.query(`select public.return_shared_review($1)`, [id]); return true; } catch { return false; }
  };
  const accept = (id: string) => db.query(`update public.shared_programs set accepted_at = now() where id = $1`, [id]);

  // 1:1: CLIENT asks TRAINER.
  const direct = await askForReview(CLIENT, TRAINER);
  await saveDraft(direct, "Draft 1");
  eq(await stateOf(direct), { draft: "Draft 1", returned: null, isReturned: false, isAccepted: false },
    "review: a builder save is a draft, not something the client can see");
  eq(await sendBack(TRAINER, direct), true, "review: the trainer can send it back");
  eq(await stateOf(direct), { draft: null, returned: "Draft 1", isReturned: true, isAccepted: false },
    "review: Send Back hands over the draft and clears it");
  await accept(direct);
  await saveDraft(direct, "Draft 2");
  eq((await stateOf(direct)).returned, "Draft 1", "review: an edit after sending back doesn't reach the client until it's sent");
  eq(await sendBack(TRAINER, direct), true, "review: the trainer can send an update");
  eq(await stateOf(direct), { draft: null, returned: "Draft 2", isReturned: true, isAccepted: false },
    "review: Send Update hands over the new version and reopens Accept");
  eq(await sendBack(TRAINER, direct), true, "review: sending again with no new edits is allowed");
  eq((await stateOf(direct)).returned, "Draft 2", "review: ...and keeps what was sent, rather than blanking it");
  eq(await sendBack(CLIENT, direct), false, "review: the person who asked can't send their own request back");
  eq(await sendBack(STRANGER, direct), false, "review: nobody else can send it back");
  eq(await sendBack(null, direct), false, "review: signed out can't send it back");

  // A group review: GYM_USER asks the group STRANGER owns. It's addressed to
  // the owner, but any accepted trainer of the group may send it back.
  const gid = (await db.query<{ id: string }>(
    `insert into public.groups (owner_id, name) values ($1, 'Gym') returning id`, [STRANGER])).rows[0].id;
  await db.query(
    `insert into public.group_members (group_id, user_id, role, accepted_at) values
       ($1, $2, 'member', now()), ($1, $3, 'trainer', now()), ($1, $4, 'trainer', null)`,
    [gid, GYM_USER, COACHED_PT, PENDING_PT]);
  const inGroup = await askForReview(GYM_USER, STRANGER, gid);
  await saveDraft(inGroup, "Coach's edit");
  eq(await sendBack(PENDING_PT, inGroup), false, "review: a trainer who hasn't accepted the group's invite can't send it back");
  eq(await sendBack(GYM_USER, inGroup), false, "review: the member who asked can't send it back");
  eq(await sendBack(TRAINER, inGroup), false, "review: a trainer outside the group can't send it back");
  eq(await sendBack(COACHED_PT, inGroup), true, "review: a trainer of the group who isn't its owner can send it back");
  eq((await stateOf(inGroup)).returned, "Coach's edit", "review: ...handing over that trainer's edits");

  // ─── 5. The group limits (0042) ───────────────────────────────────────────
  // An account creates at most 3 groups and is in at most 3 of other people's,
  // the two counted apart. Only ACCEPTING counts toward the second, so an
  // invite can still be sent to someone at the limit. A group holds at most 10
  // people, its owner and anyone still to answer an invite included.
  const LIMITED = "ffffffff-0000-4000-8000-000000000007"; // runs groups and joins others'
  const INVITER = "ffffffff-0000-4000-8000-000000000008"; // invites LIMITED
  const INVITER2 = "ffffffff-0000-4000-8000-000000000009"; // ...and so does this one
  for (const id of [LIMITED, INVITER, INVITER2]) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, `${id}@example.com`]);
    await db.query(`update public.profiles set account_type = 'pt' where id = $1`, [id]);
  }
  await connect(INVITER, LIMITED);
  await connect(INVITER2, LIMITED);
  const newGroup = async (owner: string, name: string, members: string[] = []) => {
    await as(owner);
    return (await db.query<{ id: string }>(`select public.create_group($1, $2::uuid[]) as id`, [name, members])).rows[0].id;
  };
  const joinGroup = async (uid: string, groupId: string) => {
    await as(uid);
    await db.query(`select public.accept_group_invite($1)`, [groupId]);
  };
  const setMembers = async (owner: string, groupId: string, members: string[]) => {
    await as(owner);
    await db.query(`select public.set_group_members($1, $2::uuid[])`, [groupId, members]);
  };
  /** The refusal's message, or null when it went through. */
  const refusal = async (run: () => Promise<unknown>): Promise<string | null> => {
    try { await run(); return null; } catch (e) { return (e as Error).message; }
  };
  const ownedBy = async (uid: string) => (await db.query<{ n: number }>(
    `select count(*)::int as n from public.groups where owner_id = $1`, [uid])).rows[0].n;
  const joinedBy = async (uid: string) => (await db.query<{ n: number }>(
    `select count(*)::int as n from public.group_members m join public.groups g on g.id = m.group_id
      where m.user_id = $1 and m.accepted_at is not null and g.owner_id <> $1`, [uid])).rows[0].n;
  const isPending = async (groupId: string, uid: string) => (await db.query<{ p: boolean }>(
    `select accepted_at is null as p from public.group_members where group_id = $1 and user_id = $2`, [groupId, uid])).rows[0]?.p;
  const sizeOf = async (groupId: string) => (await db.query<{ n: number }>(
    `select count(*)::int as n from public.group_members where group_id = $1`, [groupId])).rows[0].n;

  // Creating: three, and no more.
  const own: string[] = [];
  for (let i = 1; i <= 3; i++) own.push(await newGroup(LIMITED, `Own ${i}`));
  eq(await refusal(() => newGroup(LIMITED, "Own 4")), "group_limit_reached", "group limits: creating a 4th is refused");
  eq((await db.query(`select 1 from public.groups where name = 'Own 4'`)).rows.length, 0,
    "group limits: ...and leaves no ownerless group behind");

  // Joining: three of other people's, whatever you've made yourself.
  const invites = [];
  for (const name of ["Invite A", "Invite B", "Invite C"]) invites.push(await newGroup(INVITER, name, [LIMITED]));
  const inviteD = await newGroup(INVITER2, "Invite D", [LIMITED]);
  eq(await joinedBy(LIMITED), 0, "group limits: pending invites don't count");
  for (const g of invites) eq(await refusal(() => joinGroup(LIMITED, g)), null, "group limits: joining up to three goes through");
  eq([await ownedBy(LIMITED), await joinedBy(LIMITED)], [3, 3],
    "group limits: ...beside three of your own, the two counted apart");
  eq(await refusal(() => joinGroup(LIMITED, inviteD)), "group_limit_reached", "group limits: accepting a 4th is refused");
  eq(await isPending(inviteD, LIMITED), true, "group limits: ...and the invite is still there to accept later");

  let inviteE = "";
  eq(await refusal(async () => { inviteE = await newGroup(INVITER2, "Invite E", [LIMITED]); }), null,
    "group limits: someone at the limit can still be invited");
  eq(inviteE ? await isPending(inviteE, LIMITED) : undefined, true, "group limits: ...as a pending invite");
  await db.query(`update public.group_members set role = 'trainer' where group_id = $1 and user_id = $2`, [invites[0], LIMITED]);
  eq(await joinedBy(LIMITED), 3, "group limits: a role change at the limit isn't refused");

  await db.query(`delete from public.group_members where group_id = $1 and user_id = $2`, [invites[0], LIMITED]);
  eq(await refusal(() => joinGroup(LIMITED, inviteD)), null, "group limits: leaving a group makes room to accept");
  await db.query(`delete from public.groups where id = $1`, [own[0]]);
  eq(await refusal(() => newGroup(LIMITED, "Own 4")), null, "group limits: deleting one of your groups makes room to create");
  eq([await ownedBy(LIMITED), await joinedBy(LIMITED)], [3, 3], "group limits: back at three and three");

  // A group's size: ten people, counting its owner and every invite.
  const crowd = Array.from({ length: 11 }, (_, i) => `ffffffff-0000-4000-8000-0000000003${String(i).padStart(2, "0")}`);
  for (const id of crowd) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, `${id}@example.com`]);
    await connect(INVITER2, id);
  }
  let ten = "";
  eq(await refusal(async () => { ten = await newGroup(INVITER2, "Ten", crowd.slice(0, 9)); }), null,
    "group size: an owner and nine others go in");
  eq(await sizeOf(ten), 10, "group size: ...ten people, the invites still pending among them");
  eq(await refusal(() => setMembers(INVITER2, ten, crowd.slice(0, 10))), "group_full", "group size: inviting an 11th is refused");
  eq(await sizeOf(ten), 10, "group size: ...and the save changes nothing else");
  eq(await refusal(() => db.query(`insert into public.group_members (group_id, user_id) values ($1, $2)`, [ten, crowd[10]])),
    "group_full", "group size: ...however the row arrives");
  eq(await refusal(() => setMembers(INVITER2, ten, crowd.slice(0, 9))), null,
    "group size: saving a full group as it is goes through (a rename, a new photo)");
  eq(await refusal(() => joinGroup(crowd[0], ten)), null, "group size: accepting into a full group goes through: the invite held the place");
  await as(crowd[1]);
  await db.query(`select public.decline_group_invite($1)`, [ten]);
  eq(await refusal(() => setMembers(INVITER2, ten, [crowd[0], ...crowd.slice(2, 10)])), null,
    "group size: an invite declined makes room for someone else");
  eq(await refusal(() => setMembers(INVITER2, ten, [crowd[0], ...crowd.slice(3, 11)])), null,
    "group size: taking one invite back and adding someone in the same save goes through");
  eq(await sizeOf(ten), 10, "group size: ...still ten");
  await db.query(`delete from public.groups where id = $1`, [inviteE]);
  eq(await refusal(() => newGroup(INVITER2, "Eleven", crowd.slice(0, 10))), "group_full", "group size: creating with ten others is refused");
  eq((await db.query(`select 1 from public.groups where name = 'Eleven'`)).rows.length, 0,
    "group size: ...and leaves no group behind");

  // ─── 6. Units (0036) ──────────────────────────────────────────────────────
  // A trainer reads a client's unit with their training, and the send /
  // review warnings read the unit of anyone they're connected to or share a
  // group with. Nobody else's comes back.
  const setUnit = async (uid: string, unit: "kg" | "lb") => {
    await as(uid); // the owner writes their own, as lib/cloud.ts pushUnit does
    await db.query(`update public.profiles set unit = $1 where id = auth.uid()`, [unit]);
  };
  await db.query(`update public.profiles set account_type = 'pt' where id = $1`, [TRAINER]);
  await setUnit(CLIENT, "lb");
  await setUnit(GYM_USER, "lb");
  await as(TRAINER);
  eq((await training(CLIENT))?.unit, "lb", "units: a client's training carries the unit they log in");
  await setUnit(CLIENT, "kg");
  await as(TRAINER);
  eq((await training(CLIENT))?.unit, "kg", "units: ...and follows a change to it");

  const unitsFor = async (viewer: string, ids: string[]) => {
    await as(viewer);
    const rows = (await db.query<{ user_id: string; unit: string }>(
      `select * from public.get_people_units($1::uuid[])`, [ids])).rows;
    return Object.fromEntries(rows.map(r => [r.user_id, r.unit]));
  };
  eq(await unitsFor(TRAINER, [CLIENT, STRANGER]), { [CLIENT]: "kg" }, "units: a connection's unit, and nobody unconnected");
  eq(await unitsFor(PENDING_PT, [CLIENT]), {}, "units: a pending connection gets nothing");
  eq(await unitsFor(COACHED_PT, [GYM_USER]), { [GYM_USER]: "lb" }, "units: someone you share a group with (not a connection)");
  eq(await unitsFor(PENDING_PT, [GYM_USER]), {}, "units: an invite you haven't accepted shares nothing");
  eq(await unitsFor(CLIENT, [CLIENT]), {}, "units: never your own, which the phone already knows");

  // ─── 7. Archiving (0037) ──────────────────────────────────────────────────
  // An archived SEND is hidden from the people it went to as well, so only
  // the sender or a trainer of its group may do it; an archived REVIEW only
  // tidies the trainers' list, so only they may, never the person who asked.
  // Rows the caller may not touch are skipped, and the count says so.
  const sendShare = async (sender: string, recipient: string, key: string, groupId: string | null = null) =>
    (await db.query<{ id: string }>(
      `insert into public.shared_programs (sender_id, recipient_id, kind, sender_program_id, program_name, snapshot, sent_key, group_id)
       values ($1, $2, 'share', 'program_9', 'Block', '{"name":"Block"}'::jsonb, $3, $4) returning id`,
      [sender, recipient, key, groupId])).rows[0].id;
  /** How many rows moved, or null when the call raised. */
  const setArchived = async (as_: string | null, ids: string[], archived = true): Promise<number | null> => {
    await as(as_);
    try {
      return (await db.query<{ n: number }>(`select public.set_share_archived($1::uuid[], $2) as n`, [ids, archived])).rows[0].n;
    } catch {
      return null;
    }
  };
  const archivedCount = async (ids: string[]) => (await db.query<{ n: number }>(
    `select count(*)::int as n from public.shared_programs where id = any($1::uuid[]) and archived_at is not null`, [ids])).rows[0].n;

  const direct1 = await sendShare(TRAINER, CLIENT, "send-1");
  eq(await setArchived(CLIENT, [direct1]), 0, "archive: the person a program was sent to can't archive the send");
  eq(await setArchived(STRANGER, [direct1]), 0, "archive: nor can anyone else");
  eq(await setArchived(TRAINER, [direct1]), 1, "archive: the sender can");
  eq(await archivedCount([direct1]), 1, "archive: ...and it's archived");
  eq(await setArchived(TRAINER, [direct1], false), 1, "archive: the sender can restore it");
  eq(await archivedCount([direct1]), 0, "archive: ...which clears it");

  // A group send: one row per member, sent by the owner. A trainer of the
  // group who didn't send it can archive it too, as they can remove it.
  const groupSend = [await sendShare(STRANGER, GYM_USER, "send-2", gid), await sendShare(STRANGER, COACHED_PT, "send-2", gid)];
  eq(await setArchived(GYM_USER, groupSend), 0, "archive: a member can't archive a group's send");
  eq(await setArchived(PENDING_PT, groupSend), 0, "archive: a trainer who hasn't accepted the invite can't");
  eq(await setArchived(TRAINER, groupSend), 0, "archive: a trainer outside the group can't");
  eq(await setArchived(COACHED_PT, groupSend), 2, "archive: a trainer of the group can, the whole send in one call");
  eq(await setArchived(STRANGER, groupSend, false), 2, "archive: the owner restores it, every row");
  eq(await setArchived(TRAINER, [direct1, ...groupSend]), 1, "archive: only the rows the caller may archive move");
  await setArchived(TRAINER, [direct1], false);

  // Reviews: `direct` is CLIENT asking TRAINER, `inGroup` GYM_USER asking the group.
  eq(await setArchived(CLIENT, [direct]), 0, "archive: the person who asked can't archive their own request");
  eq(await setArchived(TRAINER, [direct]), 1, "archive: the review's trainer can");
  eq(await setArchived(TRAINER, [direct], false), 1, "archive: ...and restore it");
  eq(await setArchived(GYM_USER, [inGroup]), 0, "archive: a member can't archive their own group review");
  eq(await setArchived(TRAINER, [inGroup]), 0, "archive: a trainer outside the group can't archive its review");
  eq(await setArchived(COACHED_PT, [inGroup]), 1, "archive: a trainer of the group can archive its review");
  eq(await setArchived(STRANGER, [inGroup], false), 1, "archive: another trainer of it can restore it");
  eq(await setArchived(null, [direct1]), null, "archive: signed out is an error");

  // ─── 8. Custom exercise media (0038) ──────────────────────────────────────
  // A custom exercise's photo and video go wherever its program goes, so
  // anyone may read them; only their author may write, and only in their own
  // folder. Storage has no functions to call, so the policies are the rule,
  // and they're checked here as the API's own `authenticated` role (Supabase
  // grants it the public tables; the group-photo policy reads groups).
  eq((await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'exercise-media'`)).rows[0],
    { public: true, file_size_limit: 52428800, allowed_mime_types: ["image/jpeg", "image/png", "video/mp4", "video/quicktime"] },
    "exercise media: a public bucket for photos and clips, capped at 50 MB");
  await db.exec(`
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
  `);
  /** Run as `uid` through the API role; the error message, or null. */
  const asApi = async (uid: string, sql: string, params: unknown[] = []) => {
    await as(uid);
    await db.exec("set role authenticated");
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      await db.exec("reset role");
    }
  };
  const putMedia = (uid: string, path: string) =>
    asApi(uid, `insert into storage.objects (bucket_id, name, owner) values ('exercise-media', $1, $2)`, [path, uid]);
  eq(await putMedia(TRAINER, `${TRAINER}/exercise_icon_1.jpg`), null, "exercise media: you can upload into your own folder");
  eq(/row-level security/.test((await putMedia(TRAINER, `${CLIENT}/exercise_icon_2.jpg`)) ?? ""), true,
    "exercise media: ...and not into anyone else's");
  eq(/row-level security/.test((await putMedia(TRAINER, `exercise_icon_3.jpg`)) ?? ""), true,
    "exercise media: ...nor outside a folder");
  await as(CLIENT);
  await db.exec("set role authenticated");
  const seen = (await db.query<{ n: number }>(
    `select count(*)::int as n from storage.objects where bucket_id = 'exercise-media' and name = $1`, [`${TRAINER}/exercise_icon_1.jpg`])).rows[0].n;
  await db.exec("reset role");
  eq(seen, 1, "exercise media: anyone can read it, which is how the client sees the trainer's photo");
  await asApi(CLIENT, `delete from storage.objects where bucket_id = 'exercise-media' and name = $1`, [`${TRAINER}/exercise_icon_1.jpg`]);
  eq((await db.query(`select 1 from storage.objects where name = $1`, [`${TRAINER}/exercise_icon_1.jpg`])).rows.length, 1,
    "exercise media: only its author can delete it");

  // ─── 9. Who may change which columns of a shared program (0039) ──────────
  // Through the API, with their own login, a party to a row could change any
  // of it. Now each may change only what the app changes for them; the rest
  // is the security-definer functions' alone. Run as the API role, which
  // Supabase grants every table in public (RLS still decides which rows).
  await db.exec(`
    grant insert, update, delete on all tables in schema public to authenticated;
    grant usage on schema auth to authenticated;
  `);
  const blocked =(msg: string | null) => msg !== null && /can't be changed here|can't start/.test(msg);
  const setRow = (uid: string, id: string, set: string, params: unknown[] = []) =>
    asApi(uid, `update public.shared_programs set ${set} where id = $1`, [id, ...params]);
  const rowOf = async (id: string) => (await db.query<Record<string, unknown>>(
    `select * from public.shared_programs where id = $1`, [id])).rows[0];

  const send9 = await sendShare(TRAINER, CLIENT, "send-9");
  eq(await setRow(CLIENT, send9, "accepted_at = now(), deleted_by_recipient_at = null"), null, "columns: a client accepts a send");
  eq(await setRow(CLIENT, send9, "deleted_by_recipient_at = now(), accepted_at = null"), null, "columns: ...and deletes their copy");
  eq(await setRow(TRAINER, send9, `snapshot = '{"name":"v2"}'::jsonb, program_name = 'v2', last_edited_at = now(), accepted_at = null`), null,
    "columns: the trainer sends an update, re-opening Accept");
  eq(await asApi(TRAINER, `select public.set_share_archived(array[$1]::uuid[], true)`, [send9]), null, "columns: the trainer archives it (the function)");
  eq(blocked(await setRow(CLIENT, send9, "archived_at = null")), true, "columns: the client can't un-archive it");
  eq((await rowOf(send9)).archived_at !== null, true, "columns: ...and it stays archived");
  eq(blocked(await setRow(CLIENT, send9, "sender_id = $2, recipient_id = $3", [CLIENT, STRANGER])), true,
    "columns: the client can't re-address it to someone they aren't connected to");
  eq(blocked(await setRow(TRAINER, send9, "recipient_id = $2", [STRANGER])), true, "columns: nor can the trainer");
  eq(blocked(await setRow(TRAINER, send9, "accepted_at = now()")), true, "columns: the trainer can't accept it for the client");
  eq(blocked(await setRow(CLIENT, send9, `snapshot = '{"name":"mine"}'::jsonb`)), true, "columns: the client can't rewrite what was sent");

  const review9 = (await db.query<{ id: string }>(
    `insert into public.shared_programs (sender_id, recipient_id, kind, sender_program_id, program_name, snapshot, sent_key)
     values ($1, $2, 'review', 'program_1', 'PPL', '{"name":"PPL"}'::jsonb, 'review-9') returning id`, [CLIENT, TRAINER])).rows[0].id;
  eq(await setRow(TRAINER, review9, `draft_snapshot = '{"name":"edit"}'::jsonb, program_name = 'edit', last_edited_at = now(), trainer_comments = 'Nice'`), null,
    "columns: the trainer saves a review in the builder");
  eq(blocked(await setRow(TRAINER, review9, `returned_snapshot = '{"name":"x"}'::jsonb, returned_at = now()`)), true,
    "columns: ...but can't send it back except through the function");
  eq(await asApi(TRAINER, `select public.return_shared_review($1)`, [review9]), null, "columns: the trainer sends it back (the function)");
  eq(await setRow(CLIENT, review9, "accepted_at = now()"), null, "columns: the client accepts the changes");
  eq(blocked(await setRow(CLIENT, review9, "returned_at = now()")), true, "columns: the client can't fake a send-back");
  eq(blocked(await setRow(CLIENT, review9, "completed_at = now()")), true, "columns: ...or close their own review");
  eq(await setRow(TRAINER, review9, "deleted_by_recipient_at = now()"), null, "columns: the trainer deletes it from their list");

  eq(blocked(await asApi(CLIENT,
    `insert into public.shared_programs (sender_id, recipient_id, kind, sender_program_id, program_name, snapshot, sent_key, returned_at)
     values ($1, $2, 'review', 'program_1', 'PPL', '{}'::jsonb, 'review-10', now())`, [CLIENT, TRAINER])), true,
    "columns: a new row can't arrive already sent back");
  eq(await asApi(CLIENT,
    `insert into public.shared_programs (sender_id, recipient_id, kind, sender_program_id, program_name, snapshot, sent_key)
     values ($1, $2, 'review', 'program_1', 'PPL', '{}'::jsonb, 'review-11')`, [CLIENT, TRAINER]), null,
    "columns: asking for a review still works");

  // Deleting a group nulls its sends' group_id: the database's own action, not
  // the caller's, so it isn't refused.
  const g9 = await newGroup(TRAINER, "Closing down", [CLIENT]);
  await joinGroup(CLIENT, g9);
  const groupSend9 = await sendShare(TRAINER, CLIENT, "send-10", g9);
  eq(await asApi(TRAINER, `delete from public.groups where id = $1`, [g9]), null, "columns: the owner can still delete a group with sends in it");
  eq((await rowOf(groupSend9))?.group_id ?? null, null, "columns: ...and its sends lose their group");

  // ─── 10. Blocks (0040) ────────────────────────────────────────────────────
  // A block is the blocker's alone to see and lift. It severs, takes the
  // person out of every group the BLOCKER OWNS (and nobody else's), and stops
  // their notifications reaching the blocker. Pushes are caught by swapping
  // pg_net's stand-in for one that records what it was asked to send.
  const B_OWNER = "ffffffff-0000-4000-8000-000000000010";   // runs two groups
  const B_MEMBER = "ffffffff-0000-4000-8000-000000000011";  // in both, and in B_OTHER's
  const B_PEER = "ffffffff-0000-4000-8000-000000000012";    // a member who blocks a trainer
  const B_POSTER = "ffffffff-0000-4000-8000-000000000013";  // a trainer of B_OWNER's group
  const B_INVITEE = "ffffffff-0000-4000-8000-000000000014"; // invited, not yet in
  const B_OTHER = "ffffffff-0000-4000-8000-000000000015";   // runs a group B_MEMBER is in
  for (const [id, type] of [
    [B_OWNER, "pt"], [B_MEMBER, "user"], [B_PEER, "user"], [B_POSTER, "pt"], [B_INVITEE, "user"], [B_OTHER, "pt"],
  ] as const) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, `${id}@example.com`]);
    await db.query(`update public.profiles set account_type = $2 where id = $1`, [id, type]);
  }
  for (const other of [B_MEMBER, B_PEER, B_POSTER, B_INVITEE]) await connect(B_OWNER, other);
  await connect(B_OTHER, B_MEMBER);
  const groupOf = async (owner: string, members: [string, "member" | "trainer", boolean][]) => {
    const g = (await db.query<{ id: string }>(
      `insert into public.groups (owner_id, name) values ($1, 'Blocks') returning id`, [owner])).rows[0].id;
    // The owner is a member of their own group, as create_group makes them.
    for (const [uid, role, accepted] of [[owner, "member", true] as const, ...members]) {
      await db.query(
        `insert into public.group_members (group_id, user_id, role, accepted_at) values ($1, $2, $3, ${accepted ? "now()" : "null"})`,
        [g, uid, role]);
    }
    return g;
  };
  const gMain = await groupOf(B_OWNER, [
    [B_MEMBER, "member", true], [B_PEER, "member", true], [B_POSTER, "trainer", true], [B_INVITEE, "member", false],
  ]);
  const gSecond = await groupOf(B_OWNER, [[B_MEMBER, "member", true]]);
  const gOthers = await groupOf(B_OTHER, [[B_MEMBER, "member", true]]);
  const inGroupNow = async (groupId: string, uid: string) => (await db.query(
    `select 1 from public.group_members where group_id = $1 and user_id = $2`, [groupId, uid])).rows.length === 1;
  const connected = async (a: string, b: string) => (await db.query(
    `select 1 from public.connections where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
    [a, b])).rows.length > 0;
  const block = (blocker: string, blockedId: string) =>
    asApi(blocker, `insert into public.blocks (blocker_id, blocked_id, name) values (auth.uid(), $1, 'Them')
                    on conflict do nothing`, [blockedId]);
  const blocksSeenBy = async (uid: string) => {
    await as(uid);
    await db.exec("set role authenticated");
    try {
      return (await db.query<{ n: number }>(`select count(*)::int as n from public.blocks`)).rows[0].n;
    } finally {
      await db.exec("reset role");
    }
  };

  await db.exec(`
    create table public._pushes (body jsonb);
    create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
      returns bigint language sql as $$ insert into public._pushes values (body); select 0::bigint $$;
  `);
  for (const uid of [B_OWNER, B_MEMBER, B_PEER, B_POSTER]) {
    await db.query(`insert into public.push_tokens (user_id, token) values ($1, $2)`, [uid, `tok-${uid}`]);
  }
  /** Who a push went to since the last call, by account. */
  const pushedSince = async () => {
    const rows = (await db.query<{ to: string }>(
      `select e->>'to' as to from public._pushes p, jsonb_array_elements(p.body) e`)).rows;
    await db.query(`delete from public._pushes`);
    return new Set(rows.map(r => r.to.replace(/^tok-/, "")));
  };
  const groupMessage = async (sender: string, groupId: string) => {
    await as(sender);
    await db.query(`insert into public.group_messages (group_id, sender_id, body) values ($1, $2, 'hi')`, [groupId, sender]);
  };
  await pushedSince();

  // The owner blocks a member: out of both their groups, not out of B_OTHER's.
  eq(await block(B_OWNER, B_MEMBER), null, "blocks: you can block someone");
  eq([await inGroupNow(gMain, B_MEMBER), await inGroupNow(gSecond, B_MEMBER)], [false, false],
    "blocks: the owner's block takes them out of every group the owner runs");
  eq(await inGroupNow(gOthers, B_MEMBER), true, "blocks: ...and out of nobody else's");
  eq(await connected(B_OWNER, B_MEMBER), false, "blocks: ...and severs the connection");
  eq(await block(B_OWNER, B_MEMBER), null, "blocks: blocking again is harmless");
  eq(await block(B_OWNER, B_INVITEE), null, "blocks: the owner blocks someone they've invited");
  eq(await inGroupNow(gMain, B_INVITEE), false, "blocks: ...and the invite is withdrawn");

  // A member blocks a trainer of the group: both stay, the trainer's
  // notifications stop reaching them, and nobody else's change.
  eq(await block(B_PEER, B_POSTER), null, "blocks: a member blocks a trainer of their group");
  eq([await inGroupNow(gMain, B_PEER), await inGroupNow(gMain, B_POSTER)], [true, true],
    "blocks: ...and both stay in the group, which isn't the member's to change");
  await groupMessage(B_POSTER, gMain);
  eq([...await pushedSince()], [B_OWNER], "blocks: their group messages notify everyone except whoever blocked them");
  await groupMessage(B_PEER, gMain);
  eq((await pushedSince()).has(B_POSTER), true, "blocks: one way: the blocker's messages still notify the person blocked");
  await sendShare(B_POSTER, B_PEER, "send-block", gMain);
  await sendShare(B_POSTER, B_OWNER, "send-block", gMain);
  eq([...await pushedSince()], [B_OWNER], "blocks: a program they send to the group doesn't notify whoever blocked them");
  const ownersReview = await askForReview(B_PEER, B_OWNER, gMain);
  await pushedSince();
  await db.query(`update public.shared_programs set draft_snapshot = '{"name":"x"}'::jsonb where id = $1`, [ownersReview]);
  await as(B_POSTER);
  await db.query(`select public.return_shared_review($1)`, [ownersReview]);
  eq((await pushedSince()).has(B_PEER), false, "blocks: nor does a review they send back");
  await db.query(`insert into public.connections (requester_id, addressee_id, status) values ($1, $2, 'pending')`, [B_MEMBER, B_OWNER]);
  eq((await pushedSince()).has(B_OWNER), false, "blocks: nor a connection request from them");

  // Only the blocker sees or lifts it.
  eq(await blocksSeenBy(B_POSTER), 0, "blocks: the person blocked can't see that they are");
  eq(await blocksSeenBy(B_PEER), 1, "blocks: the blocker sees their own");
  await asApi(B_POSTER, `delete from public.blocks where blocked_id = $1`, [B_POSTER]);
  eq(await blocksSeenBy(B_PEER), 1, "blocks: the person blocked can't lift it");
  eq(/row-level security/.test((await asApi(B_POSTER,
    `insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [B_PEER, B_OWNER])) ?? ""), true,
    "blocks: nobody can block on someone else's behalf");
  eq((await block(B_PEER, B_PEER)) !== null, true, "blocks: you can't block yourself");
  eq(await asApi(B_PEER, `delete from public.blocks where blocked_id = $1`, [B_POSTER]), null, "blocks: the blocker lifts it");
  await groupMessage(B_POSTER, gMain);
  eq((await pushedSince()).has(B_PEER), true, "blocks: ...and their messages notify them again");

  // ─── 11. Connection roles + switching account type (0041) ─────────────────
  // How a trainer files each trainer they're connected with is theirs alone.
  // Switching account type through change_account_type re-files and notifies
  // everyone connected; a bare write to the column (the launch-time drift
  // repair) does none of it.
  const R_X = "ffffffff-0000-4000-8000-000000000020";        // the trainer who switches
  const R_ONLY = "ffffffff-0000-4000-8000-000000000021";     // a trainer who has X as their trainer only
  const R_UNDECIDED = "ffffffff-0000-4000-8000-000000000022"; // ...who never chose
  const R_BOTH = "ffffffff-0000-4000-8000-000000000023";     // ...as trainer and client
  const R_CLIENT = "ffffffff-0000-4000-8000-000000000024";   // ...as their client only
  const R_GYM = "ffffffff-0000-4000-8000-000000000025";      // a gym user X coaches
  const R_ASKER = "ffffffff-0000-4000-8000-000000000026";    // a gym user waiting on a review from X
  const R_LATER = "ffffffff-0000-4000-8000-000000000027";    // a gym user connected once X is a gym user
  for (const [id, type] of [
    [R_X, "pt"], [R_ONLY, "pt"], [R_UNDECIDED, "pt"], [R_BOTH, "pt"], [R_CLIENT, "pt"],
    [R_GYM, "user"], [R_ASKER, "user"], [R_LATER, "user"],
  ] as const) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [id, `${id}@example.com`]);
    await db.query(`update public.profiles set account_type = $2, name = $3 where id = $1`, [id, type, `Person ${id.slice(-2)}`]);
  }
  for (const other of [R_ONLY, R_UNDECIDED, R_BOTH, R_CLIENT, R_GYM, R_ASKER]) await connect(other, R_X);
  const fileAs = (owner: string, other: string, role: string) =>
    asApi(owner, `insert into public.connection_roles (owner_id, other_id, role) values (auth.uid(), $1, $2)
                  on conflict (owner_id, other_id) do update set role = excluded.role`, [other, role]);
  const roleOf = async (owner: string, other: string) => (await db.query<{ role: string }>(
    `select role from public.connection_roles where owner_id = $1 and other_id = $2`, [owner, other])).rows[0]?.role ?? null;
  const noticeFor = async (reader: string, about: string) => (await db.query<{ kind: string; withdrawn_reviews: number; other_name: string }>(
    `select kind, withdrawn_reviews, other_name from public.connection_notices where user_id = $1 and other_id = $2`,
    [reader, about])).rows[0] ?? null;
  const countSeenBy = async (uid: string, table: string) => {
    await as(uid);
    await db.exec("set role authenticated");
    try {
      return (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n;
    } finally {
      await db.exec("reset role");
    }
  };
  const switchTo = (uid: string, type: string) => asApi(uid, `select public.change_account_type($1)`, [type]);
  const typeOf = async (uid: string) => (await db.query<{ t: string }>(
    `select account_type as t from public.profiles where id = $1`, [uid])).rows[0].t;

  eq(await fileAs(R_ONLY, R_X, "trainer"), null, "roles: a trainer files a connection as their trainer");
  eq(await fileAs(R_BOTH, R_X, "both"), null, "roles: ...as both");
  eq(await fileAs(R_CLIENT, R_X, "client"), null, "roles: ...as their client");
  eq(await fileAs(R_BOTH, R_X, "both"), null, "roles: filing again is harmless");
  eq(/row-level security/.test((await asApi(R_ONLY,
    `insert into public.connection_roles (owner_id, other_id, role) values ($1, $2, 'client')`, [R_BOTH, R_X])) ?? ""), true,
    "roles: nobody files a connection on someone else's behalf");
  eq((await fileAs(R_ONLY, R_X, "boss")) !== null, true, "roles: only trainer, client or both");
  eq(await countSeenBy(R_ONLY, "connection_roles"), 1, "roles: you see only your own filing");
  eq(/row-level security/.test((await asApi(R_ONLY,
    `insert into public.connection_notices (user_id, other_id, kind) values (auth.uid(), $1, 'new_trainer')`, [R_X])) ?? ""), true,
    "roles: nobody writes a note directly");

  // X's own state that the switch clears: a group, a program sent, a review
  // waiting on X, one X already sent back, and a filing of X's own.
  const xGroup = (await db.query<{ id: string }>(
    `insert into public.groups (owner_id, name) values ($1, 'X group') returning id`, [R_X])).rows[0].id;
  const xSend = await sendShare(R_X, R_GYM, "send-x");
  const waiting = await askForReview(R_ASKER, R_X);
  const answered = await askForReview(R_GYM, R_X);
  await db.query(`update public.shared_programs set returned_at = now(), returned_snapshot = '{"name":"b"}'::jsonb where id = $1`, [answered]);
  eq(await fileAs(R_X, R_ONLY, "client"), null, "roles: X files a trainer as their client");

  // The launch-time repair writes the column alone: nothing else moves.
  await db.query(`update public.profiles set account_type = 'user' where id = $1`, [R_X]);
  eq([await connected(R_X, R_GYM), await noticeFor(R_GYM, R_X), await roleOf(R_ONLY, R_X)], [true, null, "trainer"],
    "switch: a bare write to account_type severs nothing and notifies nobody");
  await db.query(`update public.profiles set account_type = 'pt' where id = $1`, [R_X]);

  eq(await switchTo(R_X, "user"), null, "switch: a trainer switches to a gym account");
  eq(await typeOf(R_X), "user", "switch: ...and their account type changes");
  eq([await roleOf(R_ONLY, R_X), (await noticeFor(R_ONLY, R_X))?.kind], ["trainer", "ex_trainer_choose"],
    "switch: a trainer who had them as trainer only is asked what to do, and they're in neither list meanwhile");
  eq([await roleOf(R_UNDECIDED, R_X), (await noticeFor(R_UNDECIDED, R_X))?.kind], ["trainer", "ex_trainer_choose"],
    "switch: ...so is one who never chose");
  eq([await roleOf(R_BOTH, R_X), (await noticeFor(R_BOTH, R_X))?.kind], ["client", "ex_trainer_client"],
    "switch: as both, they stay a client, with a note");
  eq([await roleOf(R_CLIENT, R_X), await noticeFor(R_CLIENT, R_X)], ["client", null],
    "switch: as a client only, nothing changes");
  eq([await connected(R_X, R_GYM), (await noticeFor(R_GYM, R_X))?.kind], [false, "ex_trainer_gone"],
    "switch: the gym users they coached are disconnected, with a note");
  eq((await noticeFor(R_GYM, R_X))?.other_name, "Person 20", "switch: ...which names them");
  eq([(await noticeFor(R_ASKER, R_X))?.withdrawn_reviews, (await rowOf(waiting)) ?? null], [1, null],
    "switch: a review still waiting on them is withdrawn, and the note says so");
  eq((await rowOf(answered)) !== undefined, true, "switch: one they already sent back stays");
  eq([(await db.query(`select 1 from public.groups where id = $1`, [xGroup])).rows.length, (await rowOf(xSend)) ?? null], [0, null],
    "switch: their groups and the programs they sent are deleted");
  eq(await roleOf(R_X, R_ONLY), null, "switch: a gym account keeps no filings of its own");
  eq(await connected(R_X, R_ONLY), true, "switch: trainers stay connected, to choose for themselves");
  eq(await countSeenBy(R_ONLY, "connection_notices"), 1, "switch: a note is read by the person it's for");
  eq(await countSeenBy(R_GYM, "connection_notices"), 1, "switch: ...each their own");
  eq(await asApi(R_BOTH, `delete from public.connection_notices where other_id = $1`, [R_X]), null, "switch: the reader dismisses it");
  eq(await noticeFor(R_BOTH, R_X), null, "switch: ...and it's gone");
  eq(await asApi(R_CLIENT, `delete from public.connection_notices where user_id = $1`, [R_ONLY]), null,
    "switch: someone else's delete runs...");
  eq(((await noticeFor(R_ONLY, R_X)) ?? null) !== null, true, "switch: ...and removes nothing");
  eq(await switchTo(R_X, "user"), null, "switch: switching to what you already are is harmless");

  // Back to a trainer.
  await connect(R_LATER, R_X);
  eq(await switchTo(R_X, "pt"), null, "switch: a gym user switches to a trainer account");
  eq([await roleOf(R_CLIENT, R_X), (await noticeFor(R_CLIENT, R_X))?.kind], ["client", "new_trainer_client"],
    "switch: a trainer coaching them keeps them as a client, with a note offering more");
  eq([await roleOf(R_BOTH, R_X), (await noticeFor(R_BOTH, R_X))?.kind], ["client", "new_trainer_client"],
    "switch: ...whatever they were before");
  eq([await roleOf(R_ONLY, R_X), await noticeFor(R_ONLY, R_X)], ["trainer", null],
    "switch: a trainer still deciding about them has them back as a trainer, and the note is out of date");
  eq((await noticeFor(R_LATER, R_X))?.kind, "new_trainer", "switch: a gym user connected to them is told they're a trainer now");
  eq(await roleOf(R_X, R_CLIENT), "trainer", "switch: their trainers are filed as trainers, so they aren't asked");

  // A connection that goes takes both filings with it.
  await db.query(`delete from public.connections where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)`,
    [R_CLIENT, R_X]);
  eq([await roleOf(R_CLIENT, R_X), await roleOf(R_X, R_CLIENT)], [null, null], "roles: disconnecting forgets both sides' filing");
  eq((await switchTo(R_X, "admin")) !== null, true, "switch: only pt or user");
  await as(null);
  eq(await refusal(() => db.query(`select public.change_account_type('user')`)) !== null, true, "switch: not without signing in");

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
