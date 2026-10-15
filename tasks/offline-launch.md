# Opening the app offline, and backing up what was logged

**Built 2026-10-15**, as planned below, plus three things found while building it (all in CLAUDE.md's "Nothing on the way to Home waits on the server"):
- A sign-out with no signal didn't sign out: supabase-js keeps the session when it can't reach the server, and the next launch would have opened on it. Every sign-out now goes through `signOutHere()`.
- A backup whose `getSession()` couldn't renew the sign-in counted as "skipped", so it was never retried, and a sign-out offline skipped its backup check. It's "failed" now.
- Data & Sync says "Waiting to back up" while a backup is owed.

Not yet seen on a phone. Tested by `scripts/verify-offline-launch.ts`.

Planned 2026-10-14. A friend opened the app with no signal and it sat loading and never got in. Goal: open the app and log a workout with no signal, and have the workout back up the next time the phone is online, with the app open or on its next launch.

## Why it never got in

1. **The launch waits for the server to confirm the sign-in.** `contexts/AuthContext.tsx` keeps the splash up until `supabase.auth.getSession()` answers. A sign-in's access token lasts an hour. After that, `getSession()` renews it over the network before answering, retrying for up to 30s each time (`_refreshAccessToken`, `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3830`). Offline the renewal fails and `getSession()` answers "no session" (same file, :2439), even though the sign-in is still saved (a network error never removes it). So the splash stays up a long while, then `app/index.tsx` sends them to onboarding, where signing in can't work either. On a connection that hangs instead of failing (one bar, gym wifi with no internet), each try waits longer still.
2. **iPhone only: the update gate shows a spinner in place of every screen until the server answers** (`components/ForceUpdateGate.tsx`, `blocked === null`). It "fails open" offline, but only once `fetchMinIosVersion()` returns, and that read waits on `getSession()` first. On a hanging connection it never returns.

On the Android APK, only the first applies.

## What already works

- A workout logged offline is saved entirely on the phone, and the Workout page's offline banner says so.
- Back online with the app open, `retryFailedCloudPush` (`app/_layout.tsx`) re-sends a backup that failed.
- Nothing overwrites a session logged offline: a same-account sign-in runs `syncOnLogin` (`lib/cloud.ts`), which only fills a side that's empty.
- The launch migrations (`linkAcceptedCopies` included), the theme and the profile only read the phone.

## The gap

`lib/syncManager.ts` keeps a failed backup in memory only (`lastFailed`). If the app closes before the signal comes back, it forgets a backup is owed. The cloud, and a trainer's view, then miss that workout until the next change sends everything.

## Plan

### 1. Open on the saved sign-in (`contexts/AuthContext.tsx`, `lib/supabase.ts`)
- Pass `createClient` an explicit `storageKey`, the same key it already uses by default (`sb-<first label of the Supabase host>-auth-token`; check it against `SupabaseClient` in node_modules). That way nobody is signed out, and the app doesn't have to reach into auth-js internals for the key.
- At launch, read that key from AsyncStorage. A saved session with a user and a refresh token counts as signed in, however old its token. Set `session` and `loaded` from it, so nothing on the way to Home touches the network.
- Auth events: `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED` and `PASSWORD_RECOVERY` replace the session, and `SIGNED_OUT` clears it. A null `INITIAL_SESSION` (what auth-js reports when its renewal couldn't reach the server) changes nothing.
- The side jobs that run after `getSession()` today (last active, push token, pending reports) keep running, in the background.
- auth-js renews the token by itself while the app is open, so a new one arrives once there's signal. Check that its auto-refresh is running from launch: auth-js starts it after init on React Native (`_handleVisibilityChange`), and `lib/supabase.ts` only restarts it when the app state changes.
- When the server has really ended a sign-in (password changed elsewhere, account deleted), it shows up as `SIGNED_OUT` once online: go to the sign-in screen then. Check that Settings' Sign Out and Delete Account don't navigate a second time on top of that.
- Check for anything that reads `session.access_token` from `useAuth()` instead of `getSession()`: an expired token there would be refused until the renewal lands.

### 2. The update gate decides from the last minimum it saw (`components/ForceUpdateGate.tsx`, `lib/appConfig.ts`)
- Save the server's minimum on the phone (`@avenas/min_ios_version`). At launch, decide straight away from the saved one: none saved, or this build is new enough → the app; this build below it → the Update screen, offline too.
- Ask the server in the background at launch and on foreground, as now, save the answer, and block if it now says to. A failed read keeps the saved value.
- **To decide:** on the one launch where the minimum is first raised, the app shows for a moment before the Update screen. The spinner was there to avoid that, and offline it turned into forever.

### 3. Remember an owed backup across restarts (`lib/syncManager.ts`)
- A saved flag (`@avenas/backup_owed`). Every `scheduleCloudPush` sets it. Only two things clear it: a backup that went through with nothing scheduled since it began, and `clearLocalUserData`.
- Check it when the phone comes back online (where `retryFailedCloudPush` runs now), and once a couple of seconds after launch when signed in, never while the splash is up.
- Settings > Data & Sync can say "Not backed up yet" from it after a restart.

### 4. Tests and docs
- Put the rules in a util as pure functions, with `scripts/verify-offline-launch.ts` added to `npm run verify`:
  - the saved-session read (an expired one counts, a malformed one doesn't);
  - the auth events (a null `INITIAL_SESSION` keeps the session, `SIGNED_OUT` clears it);
  - the update gate's decision;
  - the owed flag (a change during a backup keeps it owed).
- CLAUDE.md: a rule that nothing on the way to Home may wait on the server, and the two new keys in the data table.
- On a phone (all JS, so Expo Go works):
  - Leave the app closed for over an hour after last using it (so the token has run out), turn on airplane mode, force quit and open. It should reach Home in about 2s.
  - Log a workout and force quit. Turn airplane mode off and open the app. Within seconds Settings > Data & Sync should show a fresh backup, and the trainer should see the session.
  - Repeat once on a connection that hangs rather than fails: gym wifi with no internet, or Network Link Conditioner's "100% Loss" if the phone has the Developer menu.
