# Avenas

iOS-first React Native + Expo (SDK 57, RN 0.86, New Architecture), TypeScript strict. Expo Router + NativeTabs. Shipped to App Store.

## Non-obvious rules

- **StyleSheet only** — no Tailwind, no styled-components.
- **Packages: `npx expo install`**, never `npm install`. This tree resolves with `--legacy-peer-deps` (an optional `react-native-windows` peer on `@react-native-community/datetimepicker` otherwise fails resolution), so pass `-- --legacy-peer-deps`.
- **Never import `@react-navigation/*`** — expo-router dropped react-navigation in SDK 56 and importing it fails the bundle. `useFocusEffect` and friends come from `expo-router`.
- **`StyleSheet.absoluteFill`**, not `absoluteFillObject` — the latter was removed in RN 0.86.
- **Lists:** `FlashList`. **Images:** `expo-image`. **Secrets/tokens:** `expo-secure-store` (not AsyncStorage).
- **Colors:** `constants/theme.ts` (`ACCT`, `APP_LIGHT`, `APP_DARK`, `NEU_BG`) — no hex literals in screens.
- **Safe areas:** `useSafeAreaInsets()` — never hardcode inset values.

## Components to reuse

- **Cards:** `NeuCard`. **Buttons:** `BounceButton` (primary = `ACCT` bg + `ACCT` shadow glow).
- **Dumbbell icon:** `components/DumbbellIcon.tsx` — the single canonical 3-path SVG. The variant inside `app/journal.tsx`'s local `WorkoutIcon` differs subtly in its `d` path and is intentionally left local until a pixel-diff confirms equivalence.
- **Liquid Glass:** only on functional surfaces (nav/tabs/modal chrome). Always guard with `isGlassEffectAPIAvailable()` + rgba fallback. Never set `opacity` on `GlassView` or its parents. `overflow: 'hidden'` on glass containers.
- **Animations:** Reanimated on UI thread. Haptics (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`) on every primary tap.

## Workflow

- 3+ step or architectural work: short plan, confirm before building.
- Root-cause fixes, no patches. No hardcoded colors/insets.

## Shared utilities

Pure logic lives outside `app/` and `components/`. Reach for these before reinventing:

- `utils/dates.ts` — `parseStoredDate(s) → Date | null`, `toYMD(d) → "YYYY-MM-DD"`, `todayYMD()`, `fmtDuration(secs)`, `MONTH_NAMES`, `MONTH_FULL`. `parseStoredDate` is **strict** — it returns `null` on unparseable input. Callers MUST treat `null` as "no active program / no workout today" rather than constructing a January-year-0 fallback.
- `utils/storage.ts` — `getJSON<T>(key, fallback)`, `setJSON<T>(key, value)`, `removeKey(key)`. Use these in any **new** screen. Existing screens still call `AsyncStorage` directly; do not bulk-retrofit — each call site has bespoke ordering / rollback.
- `utils/workout.ts` — the **single source of truth** for resolving an active program's scheduled workout and for "previous values". `getTodaysWorkout(program)`, `getWorkoutForDate(program, "YYYY-MM-DD")` and `resolveTodayWorkout(program, override)` (honors a same-day change-day override) return `{ dayIndex, name, exercises, programId, dayId } | null` via the documented cycle math; `resolveDayIndex(...)` exposes just the index (pause-gated), `cycleIndexForDate(...)` the raw cycle math (used only by the dayId backfill). `buildPrevByName(history, beforeDate?, day?)` builds the last-set-per-exercise map keyed by `normalizeExerciseName(name)` (trim + lowercase). `day` is a `PrevDayScope` built by `prevDayScopeFor(resolvedWorkout, sourceProgram)` — never assembled by hand, because it also resolves `absorbsUnidentified` against that program. With a scope the walk is **strict**: only sessions performed on that day count, matched exactly as `workoutMatchesDay` does (`dayId` + `programId`, name only for sessions that recorded no `dayId`, and then only onto the day that absorbs them). An exercise with no history on the day shows "—" rather than borrowing another day's numbers — two days called "Upper" read identically, so a borrowed figure is indistinguishable from the day's own. Screens MUST call these instead of re-implementing the cycle math or prev-set lookup inline.
- `utils/programDays.ts` — **day identity**. A workout day is identified by its `dayIds[i]` entry, never by its name: a cycle can schedule "Upper" twice, and a rename must not orphan the day's exercises or its logged sessions. `programDays(program) → ProgramDayRef[]` (one per training slot + extraWorkouts, **not** deduped by name), `dayIdAt(program, i)`, `indexOfDayId`, `normalizeDayIds(existing, length)` (grow/trim, keeping ids), `markDayRefLabels` (sets `absorbsUnidentified` / `duplicateLabel` across a scope), `historicalDays` (days reconstructed from sessions when the cycle no longer has them) and `forkChangedDayIds` (see "Editing a program that's already running"). Also owns the workouts-map key helpers — `workoutKey(i, label)`, `parseDayKey`, `dayLabel`, `trainingDayKeys`, and `canonicalizeWorkouts(map, names, isTraining)`, the rename-safe re-key pass every builder load/save path must go through.
- `utils/dayIdMigration.ts` — one-shot backfill (run from `app/_layout.tsx`, after the weight migration): fills `dayIds` on legacy programs and stamps `dayId` on history that predates it. See the module header for the attribution rules.
- `components/DumbbellIcon.tsx` — the canonical workout icon.
- `constants/programs.ts`, `constants/journal.ts`, `constants/exercises.ts` — storage keys + shared types live here. Do not hardcode storage keys in screens.

## Data contract (AsyncStorage)

All keys, their value shapes, and which screens write them:

| Key                                            | Shape                                                                                                                          | Writers                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `@avenas/programs`                             | `SavedProgram[]`. **At most one** entry with `status: "active"`. `dayIds` is parallel to `cyclePattern` (one stable id per slot, Rest included) — a day's real identity. Absent on pre-migration programs; `dayIdAt` supplies the same deterministic positional id (`d0`…`dN`) the backfill assigns, so the two never disagree. | new-program, workout (`extraWorkouts`), programs |
| `@avenas/workout_history`                      | `CompletedWorkout[]` — always prepended, so *mostly* newest-first; a backdated journal log is prepended too, so consumers sort by `completedAt` rather than trusting order (they all do). `dayId` records which cycle slot the session was performed on; absent on free workouts and on records the one-shot backfill couldn't attribute, which fall back to day-name matching. | workout, log-workout, workout (delete-redo) |
| `@avenas/workout_dates`                        | `string[]` of `"YYYY-MM-DD"`, deduped.                                                                                          | workout, log-workout                       |
| `@avenas/today_workout_override`               | `{ date: "YYYY-MM-DD"; workoutName: string; programId?: string; dayId?: string }` — honored only when `date` matches the effective day. `programId` = the chosen day's source program (change-day can pick from a non-active program); `dayId` = the exact slot, so a cycle with two same-named days resolves to the one the user tapped. Both absent on free-workout overrides and legacy records. | workout                                    |
| `@avenas/workout_draft`                        | `{ date, workoutInfo, log, unitIsKg, isometricExIds, notes, isFreeWorkout, freeWorkoutAddToProgram }` — **single global** in-progress draft. `log` weights are DISPLAY-unit strings; `unitIsKg` records which unit they're in so a restore (or a mid-session unit toggle) re-expresses them instead of reinterpreting them at Finish (weights only become canonical kg via `parseWeightToKg` at Finish). The notes text persists here; `sessionNotes` always commits whatever text was written at Finish (clearing the text drops the note). The session-notes card is a floating overlay opened from the bottom-left action cluster; its open/closed state (`showNotes`) is transient and not persisted. | workout                                    |
| `@avenas/log_draft:${date}:${workoutName}`     | Per-(date, workoutName) past-workout log draft: `{ exercises, notes, workoutTime, unitIsKg }` — same DISPLAY-unit + `unitIsKg` convention as `workout_draft`. | log-workout                                |
| `@avenas/new_program_draft`                    | `ProgramDraft` — create/edit-in-progress state for the program builder.                                                         | new-program                                |
| `@avenas/builder_default_sets`                 | `number` — the exercise picker's "sets per new exercise" stepper (1–10). Local-only preference, never synced.                   | ExercisePicker                             |
| `@avenas/workout_autofill`                     | `"1" \| "0"` — Settings toggle: typing a set value on the Workout screen fills the not-yet-done sets below (never overwrites `done` sets, never auto-ticks). Builder + log-workout always fill down, toggle-independent. Only *typed* input cascades; programmatic fills (checkbox copy-from-prev) stay single-set. Local-only, never synced. Workout re-reads on focus. | settings                                   |
| `@avenas/live_activity`                        | `"1" \| "0"` — Settings toggle (**default ON**: any value ≠ `"0"` counts as enabled): show the in-progress workout as an iOS lock-screen/Dynamic Island Live Activity with a tick-set button and rest-timer controls. Local-only, never synced. Workout re-reads on focus. Entirely inert in Expo Go / Android / iOS < 17 — see `tasks/live-activity.md` for the native architecture, the duplicated-Swift-file invariant, and the EAS dev-build story. | settings                                   |
| `@avenas/custom_exercises`                     | `CustomExercise[]` (`CUSTOM_KEY` in `constants/exercises.ts`) — slash form, unlike the journal key.                             | create-custom-exercise, workout, new-program, log-workout |
| `@avenas_journal_entries`                      | `JournalEntry[]`. **Note:** `_` not `/` — historical, do not migrate.                                                           | journal                                    |
| `@avenas/workout_timer_start`                  | `number` — the timer's **effective start** (epoch ms, shifted forward past pauses on every resume, so `elapsed = now − value`). Alone it fully encodes elapsed time across an app kill. | `WorkoutTimerContext`                      |
| `@avenas/workout_timer_paused_ms`              | `number` — accumulated elapsed ms while the workout timer is paused. Written *before* `timer_start` is removed (and vice versa on resume) so a kill mid-transition leaves both keys, never neither; hydration prefers this key. | `WorkoutTimerContext`                      |
| `@avenas/workout_view_mode`                    | `"focus" \| "list"` — the workout screen's view-mode preference.                                                                | workout, settings                          |
| `@avenas/cycle_pattern_coachmark_seen` / `@avenas/workouts_coachmark_seen` | `"1"` — one-shot flags: the builder's Step 1 tap-a-day coach mark / Step 2 add-exercises + warmup-badge coach mark has been shown. Local-only. | new-program                                |
| `@avenas/theme` / `@avenas/unit` / `avenas_streak_data` / `avenas_flame_preference` / `@avenas/account_type` | Small primitives managed by their respective contexts. | respective contexts                        |
| `@avenas/weight_kg_migration_done` / `@avenas/day_ids_migration_done` | `"1"` — one-shot migration flags. Both run at startup from `app/_layout.tsx`, in that order (both rewrite `programs` + `workout_history`, so they must not interleave), and the app is gated on them. | `utils/weightMigration.ts`, `utils/dayIdMigration.ts` |
| `@avenas/user_profile` / `@avenas/onboarding_complete` | `{ name, email }` (local profile, drives the Settings avatar) / `boolean` (first-launch onboarding done — set on signup **or** skip). | `UserProfileContext` (signup, onboarding) |
| `@avenas/terms_accepted` | `number` — the accepted `TERMS_VERSION` (`constants/onboarding.ts`). Recorded on the post-signup Terms step. | accept-terms |
| `@avenas/notification_prefs` | `NotificationPrefs` (`constants/notifications.ts`) — master + per-category toggles + `workoutReminderTime {hour,minute}`. Local-only (never in the cloud snapshot), but every write mirrors the **effective** `PUSH_CATEGORIES` values to the Supabase `push_tokens.categories` column via `lib/push.ts`, and rebuilds the on-device schedule via `utils/notificationScheduler.ts`. New delivery sites MUST gate through `isCategoryEnabled` / the scheduler helpers — never call `expo-notifications` directly from a screen. | notifications (via `NotificationPrefsContext`) |
| `@avenas/push_token` | `string` — the Expo push token this device last registered (needs EAS `projectId`; absent in Expo Go/simulator). Cleared + row deleted on sign-out and account-delete. | `lib/push.ts` |

### Active program → today's workout

1. Read `@avenas/programs`; find the entry with `status === "active"` (there's at most one).
2. `daysPassed = floor((midnight(today) - midnight(parseStoredDate(startDate))) / 1 day)`.
3. `dayIndex = (((daysPassed + (cycleOffset ?? 0)) mod cycleDays) + cycleDays) mod cycleDays` — handles negative results correctly.
4. `dayName = cyclePattern[dayIndex]`. If it's `"Rest"` or empty → no workout today.
5. `workoutKey = ${dayIndex}:${dayName}`. Exercises = `workouts[workoutKey] ?? []`.

The `:` in `${i}:${name}` is the separator between index and label. The matching `dayLabel` helper splits on `:` and rejoins with `slice(1).join(":")`, so a name containing `:` round-trips correctly — but prefer to avoid it.

### Day identity — a name is never an identity

The label in a workout key is decoration; the **index** makes the key unique, and `dayIds[index]` is what identifies the day to everything outside the program. Two consequences, both load-bearing:

- **A rename changes every key on that day.** Any path that rebuilds the builder's `WorkoutMap` MUST go through `canonicalizeWorkouts(map, names, isTraining)` (`utils/programDays.ts`), which carries exercises across by index. Looking the new key up directly resolves to `undefined`, and the `?? []` behind it deletes the day's exercises — that was a real data-loss bug across four separate load paths.
- **A cycle may schedule the same name twice.** Never `cyclePattern.indexOf(name)` to find a day, never dedupe a day list by name, and never match history on `workoutName` when a `dayId` is available. Use `programDays(program)` for lists and `indexOfDayId` for lookups; the Progress page matches sessions with `workoutMatchesDay` (`utils/progressStats.ts`), which prefers `dayId` and only falls back to the name for records that have none — and then only onto the day marked `absorbsUnidentified`, so an ambiguous record is counted once rather than on every same-named row.

### Editing a program that's already running

Logged history is a **snapshot and is never rewritten**. `CompletedWorkout` carries its own `exercises` and `workoutName`, and the Journal + workout-detail render those, so editing a program can't retroactively change what a past session says — same contract as swapping an exercise mid-session on the Workout screen. Only sessions logged *after* the edit use the new programming.

What the edit does change is how the Progress page groups things, decided entirely by whether the day's `dayId` survives the save (`forkChangedDayIds`, applied in `new-program.tsx:handleFinish` against `originalEdit.current`):

| Edit | `dayId` | Progress |
| --- | --- | --- |
| Day moved to another cycle slot | kept (ids permute with the day) | unchanged — the page doesn't care which cycle day a session fell on |
| Renamed only | kept | one row, relabelled; the pre-rename sessions stay on it |
| Exercises swapped only | kept | one row; the dropped exercise still lists, flagged `inProgram: false` ("Swapped out") |
| Renamed **and** exercises changed | **new id minted** | two rows: the replacement, plus the old day as a historical row |
| Day deleted from the cycle | leaves `dayIds` | its sessions become a historical row |

"Exercises changed" compares the SET of exercise names — editing sets, reps, weight or rest is programming, not a different workout, and must not fork.

Historical rows are **derived from history, not stored**: `historicalDays` reconstructs any `dayId` that has sessions but no longer exists in an in-scope program's cycle, labelling it from the most recent session's `workoutName`. They carry `isHistorical: true`, an empty `programExercises` (nothing on them can read as "swapped out" — there's no current prescription), and never absorb unidentified sessions ahead of a live day.

### Override (change-day) flow

`@avenas/today_workout_override` stores `{ date, workoutName, programId?, dayId? }`. Honor it only when `override.date` matches the effective day — stale overrides from a previous day must be ignored. Resolution goes through `resolveWorkoutForDate(program, override, dateYMD, allPrograms?)`: the day is looked up in its **source** program (`programId`, which change-day records because the user can pick a day from a non-active program), falling back to the active program when `programId` is absent (legacy override / free workout) or its program is gone. Pass the full `allPrograms` list or cross-program overrides degrade to name-only. Inside that program the slot is found by `dayId`; the `indexOf(name)` fallback (legacy / free-workout overrides) always lands on the first day of that name. A day resolved by id surfaces its CURRENT label, so a rename since the override was written shows the new name. The override key is also used by the "free workout" flow to remember the user-chosen name across reloads (no `programId` / `dayId`).

### Save flow — what triggers Home / Journal updates

When the user taps **Finish** on a workout, in order:

1. Build a `CompletedWorkout` synchronously in memory (so the locked completed view can be set on the same tick), stamping `programId` and `dayId` from the resolved workout.
2. Set `setTodaysCompletedWorkout(completed)` synchronously.
3. `await` a sequential pair of `getItem → setItem` against `@avenas/workout_history` to prepend the workout. Sequential awaits prevent rapid back-to-back finishes racing.
4. `await` the same pattern against `@avenas/workout_dates` to ensure the date is recorded once.
5. Refresh in-memory `prevByName` from the newly-written history so a same-session discard-and-restart gets correct previous-set suggestions.
6. Clear `@avenas/workout_draft` and stop the workout timer.
7. If `isFreeWorkout && addToProgram && activeProgram` is true, append the workout name to `activeProgram.extraWorkouts` in `@avenas/programs`.

Home and Journal pick up the new workout on their next `useFocusEffect`. They are read-only with respect to workout history (Journal can additionally delete journal entries, never workouts directly).

### Edit-flow change detection

`new-program.tsx` shows the "Update" button and the "Unsaved Changes" navigation prompt based on whether the working draft differs from `originalEdit.current`. **Both** surfaces must agree, so they call the same `workoutsEqual(a, b)` helper. The `WorkoutMap` comparison uses a sorted-keys JSON form because object-key insertion order is not significant.

## Conventions for new screens (e.g. the upcoming Program Page)

A new screen plugs into the contract by following these rules — break any of them and the four interlinked pages start to drift:

- Use date helpers from `utils/dates.ts`. Do not inline `MONTH_NAMES` arrays or hand-rolled `parseStoredDate`.
- Use `utils/storage.ts:getJSON/setJSON` for new persistence paths.
- Use `<DumbbellIcon />` from `components/`.
- Storage keys come from `constants/programs.ts` and `constants/journal.ts`. Do not hardcode key strings.
- Treat `parseStoredDate(...)` returning `null` as "no active program / no workout today". Never fall back to month 0.
- Identify a workout day by its `dayId`, never by its name — see "Day identity" above. Lists of days come from `programDays(program)`; lookups from `indexOfDayId`; history matching from `workoutMatchesDay`.
- For `WorkoutMap` equality checks, use the sorted-keys form (see `workoutsEqual` in `new-program.tsx`). Plain `JSON.stringify` is order-sensitive and will produce phantom diffs.
- Never block the UI on a `setItem`. Optimistic-update + rollback-on-failure is the established pattern (see `journal.tsx:saveEntries`).
- Storage errors → `if (__DEV__) console.warn("[avenas]", op, key, err)`. Do not surface as user-facing Alerts (that would change behavior).
- When mutating shared keys (`workout_history`, `workout_dates`, `programs`), serialize the read→write pair with sequential `await`s. Never `getItem(...).then(setItem(...))` without an `await` in between — that pattern races concurrent writers.
