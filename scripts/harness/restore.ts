// A phone restored from the account's backup: the old phone's last backup (as
// lib/syncManager.ts pushes one), then a new phone, or the app deleted and
// installed again, signing in and reading it back, all through lib/cloud.ts.
// What the backup carries comes back. What the phone kept only for itself is
// gone: which send made which copy (the share meta), the cards it removed, its
// saved pages.
//
// Every backup mints new row ids, and a restore that took them for the
// programs' ids renamed every program: the next update or re-send of a program
// then made a second copy, and the client's sessions stayed on the first (user
// report, 2026-10-13). The flows restore a phone partway through to keep that
// from coming back.

import { freshApp, on, stubModule } from "./app";
import type { Person } from "./world";
import type * as Cloud from "../../lib/cloud";
import { UNIT_KEY } from "../../utils/units";

// Native (expo-notifications), and lib/cloud.ts only calls it to delete an account.
stubModule({ file: "lib/push.ts" }, { unregisterPushToken: async () => {} });

// eslint-disable-next-line @typescript-eslint/no-require-imports -- after the stub above, see freshApp
const cloud = freshApp(() => require("../../lib/cloud") as typeof Cloud);

/** What a new phone holds before the account's data comes down: who signed in. */
const SIGN_IN_KEYS = ["@avenas/account_type", UNIT_KEY];

/** `p` backs up, then moves to a new phone and restores. With no signal the
 *  backup fails first and nothing has changed (the sign-in screen says so). */
export async function restoreOntoNewPhone(p: Person): Promise<void> {
  await on(p, () => cloud.pushAllLocalDataToCloud(p.uid));
  p.store = new Map([...p.store].filter(([k]) => SIGN_IN_KEYS.includes(k)));
  const result = await on(p, () => cloud.reconcileOnSignIn(p.uid));
  if (result !== "replaced") throw new Error(`harness: a new phone's sign-in was "${result}", not a restore`);
}
