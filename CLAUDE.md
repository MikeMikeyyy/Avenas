# Avenas

iOS-first React Native + Expo (SDK 54, New Architecture), TypeScript strict. Expo Router + NativeTabs. Shipped to App Store.

## Non-obvious rules

- **StyleSheet only** — no Tailwind, no styled-components.
- **Packages: `npx expo install`**, never `npm install`.
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
- `utils/workout.ts` — the **single source of truth** for resolving an active program's scheduled workout and for "previous values". `getTodaysWorkout(program)`, `getWorkoutForDate(program, "YYYY-MM-DD")` and `resolveTodayWorkout(program, override)` (honors a same-day change-day override) return `{ dayIndex, name, exercises } | null` via the documented cycle math; `resolveDayIndex(...)` exposes just the index. `buildPrevByName(history, beforeDate?)` builds the last-set-per-exercise map keyed by `normalizeExerciseName(name)` (trim + lowercase). Screens MUST call these instead of re-implementing the cycle math or prev-set lookup inline.
- `components/DumbbellIcon.tsx` — the canonical workout icon.
- `constants/programs.ts`, `constants/journal.ts`, `constants/exercises.ts` — storage keys + shared types live here. Do not hardcode storage keys in screens.

## Data contract (AsyncStorage)

All keys, their value shapes, and which screens write them:

| Key                                            | Shape                                                                                                                          | Writers                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `@avenas/programs`                             | `SavedProgram[]`. **At most one** entry with `status: "active"`.                                                               | new-program, workout (`extraWorkouts`), programs |
| `@avenas/workout_history`                      | `CompletedWorkout[]` — **newest first** (always prepended).                                                                    | workout, log-workout, workout (delete-redo) |
| `@avenas/workout_dates`                        | `string[]` of `"YYYY-MM-DD"`, deduped.                                                                                          | workout, log-workout                       |
| `@avenas/today_workout_override`               | `{ date: "YYYY-MM-DD"; workoutName: string }` — honored only when `date === todayYMD()`.                                       | workout                                    |
| `@avenas/workout_draft`                        | `{ date, workoutInfo, log, isometricExIds, notes, isFreeWorkout, freeWorkoutAddToProgram }` — **single global** in-progress draft. | workout                                    |
| `@avenas/log_draft:${date}:${workoutName}`     | Per-(date, workoutName) past-workout log draft.                                                                                 | log-workout                                |
| `@avenas/new_program_draft`                    | `ProgramDraft` — create/edit-in-progress state for the program builder.                                                         | new-program                                |
| `@avenas_custom_exercises`                     | `CustomExercise[]`. **Note:** `_` not `/` — historical, do not migrate.                                                         | create-custom-exercise, workout, new-program |
| `@avenas_journal_entries`                      | `JournalEntry[]`. **Note:** `_` not `/` — historical, do not migrate.                                                           | journal                                    |
| `@avenas/workout_timer_start`                  | `number` (epoch ms when the current workout timer started).                                                                     | `WorkoutTimerContext`                      |
| `@avenas/theme` / `@avenas/unit` / `avenas_streak_data` / `avenas_flame_preference` / `@avenas/account_type` | Small primitives managed by their respective contexts. | respective contexts                        |
| `@avenas/user_profile` / `@avenas/onboarding_complete` | `{ name, email }` (local profile, drives the Settings avatar) / `boolean` (first-launch onboarding done — set on signup **or** skip). | `UserProfileContext` (signup, onboarding) |
| `@avenas/terms_accepted` | `number` — the accepted `TERMS_VERSION` (`constants/onboarding.ts`). Recorded on the post-signup Terms step. | accept-terms |

### Active program → today's workout

1. Read `@avenas/programs`; find the entry with `status === "active"` (there's at most one).
2. `daysPassed = floor((midnight(today) - midnight(parseStoredDate(startDate))) / 1 day)`.
3. `dayIndex = (((daysPassed + (cycleOffset ?? 0)) mod cycleDays) + cycleDays) mod cycleDays` — handles negative results correctly.
4. `dayName = cyclePattern[dayIndex]`. If it's `"Rest"` or empty → no workout today.
5. `workoutKey = ${dayIndex}:${dayName}`. Exercises = `workouts[workoutKey] ?? []`.

The `:` in `${i}:${name}` is the separator between index and label. The matching `dayLabel` helper splits on `:` and rejoins with `slice(1).join(":")`, so a name containing `:` round-trips correctly — but prefer to avoid it.

### Override (change-day) flow

`@avenas/today_workout_override` stores `{ date, workoutName }`. Honor it only when `override.date === todayYMD()` — stale overrides from a previous day must be ignored. To resolve to a `workoutKey`, find `dayIndex = cyclePattern.indexOf(workoutName)` and rebuild `${dayIndex}:${workoutName}`. The override key is also used by the "free workout" flow to remember the user-chosen name across reloads.

### Save flow — what triggers Home / Journal updates

When the user taps **Finish** on a workout, in order:

1. Build a `CompletedWorkout` synchronously in memory (so the locked completed view can be set on the same tick).
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
- For `WorkoutMap` equality checks, use the sorted-keys form (see `workoutsEqual` in `new-program.tsx`). Plain `JSON.stringify` is order-sensitive and will produce phantom diffs.
- Never block the UI on a `setItem`. Optimistic-update + rollback-on-failure is the established pattern (see `journal.tsx:saveEntries`).
- Storage errors → `if (__DEV__) console.warn("[avenas]", op, key, err)`. Do not surface as user-facing Alerts (that would change behavior).
- When mutating shared keys (`workout_history`, `workout_dates`, `programs`), serialize the read→write pair with sequential `await`s. Never `getItem(...).then(setItem(...))` without an `await` in between — that pattern races concurrent writers.
