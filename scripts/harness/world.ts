// The people the program flows are played out between, each on a phone of
// their own running their own copy of the app, and the group they share.
//
//   Tara  a trainer: sends programs, owns the group, reviews 1:1
//   Cole  a second trainer of Tara's group (the trainer role, not its owner)
//   Cara  a client of Tara's, in the group
//   Cody  another client of Tara's, in the group

import { freshApp, connectDb, warnings, type Phone } from "./app";
import { createDb } from "./db";
import type * as TrainerStore from "../../utils/trainerStore";
import type * as TrainerHub from "../../utils/trainerHub";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";
import type { PGlite } from "@electric-sql/pglite";

export type App = typeof TrainerStore & Pick<typeof TrainerHub, "receivedFromTrainers">;
export type Person = Phone & { accountType: "pt" | "user"; app: App; programs: SavedProgram[] };

const person = (uid: string, name: string, accountType: "pt" | "user"): Person => ({
  uid, name, accountType, store: new Map(), offline: false, programs: [],
  app: freshApp(() => ({
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per phone, see freshApp
    ...(require("../../utils/trainerStore") as typeof TrainerStore),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    receivedFromTrainers: (require("../../utils/trainerHub") as typeof TrainerHub).receivedFromTrainers,
  })),
});

export const TARA = person("aaaaaaaa-0000-4000-8000-00000000000a", "Tara", "pt");
export const COLE = person("cccccccc-0000-4000-8000-00000000000c", "Cole", "pt");
export const CARA = person("bbbbbbbb-0000-4000-8000-00000000000b", "Cara", "user");
export const CODY = person("dddddddd-0000-4000-8000-00000000000d", "Cody", "user");
export const EVERYONE = [TARA, COLE, CARA, CODY];

export let db: PGlite;
export let GROUP = "";

/** Accounts, Tara's connections to the other three, and the group, once. */
export async function setupWorld() {
  db = await createDb({ apiGrants: true });
  connectDb(db);
  for (const p of EVERYONE) {
    await db.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [p.uid, `${p.name}@example.com`]);
    await db.query(`update public.profiles set account_type = $2, name = $3 where id = $1`, [p.uid, p.accountType, p.name]);
  }
  for (const p of [COLE, CARA, CODY]) {
    await db.query(`insert into public.connections (requester_id, addressee_id, status) values ($1, $2, 'accepted')`, [TARA.uid, p.uid]);
  }
  const as = (uid: string) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await as(TARA.uid);
  GROUP = (await db.query<{ id: string }>(`select public.create_group('Mon Strength', $1::uuid[]) as id`,
    [[COLE.uid, CARA.uid, CODY.uid]])).rows[0].id;
  for (const p of [COLE, CARA, CODY]) {
    await as(p.uid);
    await db.query(`select public.accept_group_invite($1)`, [GROUP]);
  }
  await db.query(`update public.group_members set role = 'trainer' where group_id = $1 and user_id = $2`, [GROUP, COLE.uid]);
  await as("");
}

/** Every phone back to a fresh install of its account holding its own
 *  `programs`, and nothing sent between anyone. */
export async function resetWorld() {
  await db.exec("delete from public.shared_programs");
  for (const p of EVERYONE) {
    p.store = new Map([
      ["@avenas/account_type", p.accountType === "pt" ? "pt" : "gym_user"],
      ["@avenas/unit", "kg"],
      [PROGRAMS_KEY, JSON.stringify(p.programs)],
    ]);
    p.offline = false;
  }
  warnings.length = 0;
}

export async function closeWorld() {
  await db.close();
}
