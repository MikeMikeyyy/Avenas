# Avenas

iOS-first React Native + Expo (SDK 57, RN 0.86, New Architecture), TypeScript strict, Expo Router. Shipped to the App Store.

**The full record of every rule, decision and why is in `docs/ARCHITECTURE.md`.** It is not loaded automatically. Before changing a feature, grep it for that feature's file or name and read its section: most rules there came from a real bug. Keep new detail there; add a one-liner here only for a rule that's easy to break.

## Workflow

- 3+ step or architectural work: short plan, confirm before building.
- Root-cause fixes, no patches. No hardcoded colors or insets.
- `npm run verify` runs the verify scripts (`scripts/verify-*.ts`). A new solo action goes in `scripts/harness/solo/flows.ts`; a new action on a sent program or review in `scripts/harness/flows/`; a new screen showing logged history gets a check in `scripts/harness/training/checks.ts`.

## Hard rules

- **StyleSheet only** (no Tailwind / styled-components). **Lists:** `FlashList`. **Images:** `expo-image`. **Secrets:** `expo-secure-store`.
- **Packages:** `npx expo install <pkg> -- --legacy-peer-deps`, never `npm install`.
- **Never import `@react-navigation/*`** (fails the bundle). `useFocusEffect` etc. come from `expo-router`.
- `StyleSheet.absoluteFill`, never `absoluteFillObject` (removed in RN 0.86).
- **An absolute child is placed in points, never a percentage** (`right: "100%"`, `top: "50%"`): RN's Yoga measures the percentage against the room the parent was given, not the parent, so it lands off (the PR trophy sat off the card; a tab divider sat 4pt high).
- **Content measured inside a view that collapses to 0 high is absolute while shut** (left/right 0): Yoga lays a flow child of a 0-high view out at 0, so it measures as empty (Progress's program cards never reopened, then opened without animating).
- **Safe areas:** `useSafeAreaInsets()`, never hardcoded.
- **Colors:** only from `constants/theme.ts`, no hex in screens. Lines/borders/dividers use `t.div` in both themes (no `isDark ? rgba : t.div`). Red: `DANGER_BRIGHT` for delete/remove, `DANGER` for warnings/report. Green words on a light card: `accentTextColor(isDark)`; orange words: `replacedTextColor(isDark)`; marks (bars, dots, fills) keep `ACCT` / `REPLACED_ORANGE`. Words on a filled button: `ON_FILL`.
- **Tab pages:** every tab page's default export goes through `tabScreen()` (`components/TabScreen.tsx`). Anything standing on the tab bar takes its position from `useTabBar()`, never a fixed height. Tab icons live in `constants/tabIcons.ts`; after changing one run `npx tsx scripts/build-tab-icons.ts`.
- **Workout bar:** a scrolling page's end padding is `scrollEndPadding(own, useFloatingBarsReach())` (`constants/floatingBars.ts`), so its last row clears the in-progress bar (and a rest in it). Never `useFloatingBars()` on a page: it re-renders every second.
- **Keyboard:** a focused field must end clear of the keyboard and its tools (`ABOVE_KEYBOARD_TOOLS`). Plain forms: `KeyboardAwareScrollView` with `bottomOffset`. Pages with animated-height cards (Workout tab, log-workout, workout-detail): plain `ScrollView` + `KeyboardAvoidingView` + `hooks/useFieldAboveKeyboard.ts`.
- **Photo/video picking:** `lib/photoPicker.ts:pickFromLibrary` only (no permission request first, `afterAlert` from an Alert button).
- **Changing an exercise:** `ExercisePicker` with `changing={oldName}` on every change flow.
- **Startup never waits on the server.** The splash waits only on local reads; every server call at launch runs in the background. Take tokens from `supabase.auth.getSession()`, never `useAuth()`. Every sign-out goes through `signOutHere()`.
- **Offline:** read connectivity only via `useOffline()` (`contexts/ConnectivityContext.tsx`). A server-only button gets `needsConnection` on its `BounceButton`. Server actions fail honestly (throw), never swallow. Nothing is queued except "deleted my copy".
- **Forgot Password is a code, never a link.**
- **Modals:** one RN Modal mounted per screen; bottom sheets use `presentationStyle="overFullScreen"`. A sheet's interactions are steps of one sheet.
- **Liquid Glass:** only on functional chrome, guarded by `isGlassEffectAPIAvailable()` with an rgba fallback; never `opacity` on `GlassView` or its parents; `overflow: 'hidden'`. A button that stays put over a page (corner, top bar, floating pill) is `GlassButton` (`components/GlassButton.tsx`), never a `t.ctrl` circle in `BounceButton`/`TouchableOpacity`; dim it with `disabled`/`needsConnection`, which fade only the icon.
- **Animations:** Reanimated on the UI thread. Light haptic on every primary tap. A `useAnimatedStyle`/`useAnimatedProps` callback reads every shared value itself and passes it to helpers as arguments.
- **Copy:** no em dashes in user-facing text.

## Components to reuse

`NeuCard` (cards; a fixed-size NeuCard inside a content-sized parent gets its size from a sized child, never `fill`), `BounceButton` (buttons), `GlassButton` / `GlassSurface` (a button that stays put over a page, Liquid Glass on iOS 26), `FilterChip` (a chip in a filter row; never under a fading parent), `BackButton` (every pushed screen), `SheetPill` / `SheetToggle` (buttons and settings in a sheet; every Cancel is `SheetPill cancel`), `AppSwitch` (every switch), `DeleteCircleButton` (row/card delete), `ProgramSnapshotView` + `ProgramHeaderCard` + `ProgramActionFabs` + `ProgramSummarySheet` (a program read-only), `DumbbellIcon`, `FavouriteStar`, `ExpandReveal`, `trainer/MemberStack`, `trainer/GroupAvatar`, `trainer/HubTile` (a Trainer page's two tiles), `trainer/GroupSendSheet` (sending to a group, either way), `OfflineBanner`, `ArchiveButton`, `SearchField` (a page's search field, the faded look), `PrTrophy` (a PR set's trophy, beside its number). Card/summary-row geometry: `constants/cards.ts`.

## Data rules

- **Storage keys** come from `constants/programs.ts`, `constants/journal.ts`, `constants/exercises.ts`; never hardcode. New persistence uses `utils/storage.ts` (`getJSON` / `setJSON` / `removeKey`). The full key table is in `docs/ARCHITECTURE.md` ("Data contract").
- Serialize read→write on shared keys (`workout_history`, `workout_dates`, `programs`) with sequential awaits. Never block the UI on `setItem`; optimistic update + rollback. Storage errors: `if (__DEV__) console.warn("[avenas]", op, key, err)`, no Alerts.
- **Dates:** `utils/dates.ts`. `parseStoredDate` returns `null` on bad input: treat as "no program / no workout", never a fallback date. Day arithmetic rounds, never floors (DST).
- **Weights** are stored in kg; `isKg` is a display lens. A prescribed weight shows in the unit it was typed in (`ProgramSet.weightUnit`); never convert a prescription.
- **A day is identified by `dayIds[i]`, never its name** (a cycle can repeat a name). Lists from `programDays(program)`, lookups via `indexOfDayId`, history matching via `workoutMatchesDay`. Every builder load/save path runs `canonicalizeWorkouts`; every path persisting a program runs `normalizeDriftDates`. `WorkoutMap` equality uses sorted keys (`workoutsEqual`).
- **Today's workout / previous values / notes hints:** always via `utils/workout.ts` (`resolveTodayWorkout`, `resolveWorkoutForDate`, `buildPrevSetsLookup`, `buildPrevNoteLookup`, `prevDayScopeFor`). Never re-implement cycle math. "Today" is `getEffectiveToday` (before 3am is still yesterday).
- **Exercise identity:** compare names with `exerciseKey`, exercises with `exerciseIdentity` / `sameExercise`, never `toLowerCase()`. Exercise list is `scripts/exercise-library.json` → `node scripts/build-exercises.mjs`.
- **Logged history is a snapshot**, never rewritten by program edits. `completedAt` is the real finish (stamped via `utils/sessionTime.ts:stampSession`); screens show `date`.
- **Deleting a program:** `keepDeletedProgramName(program)` (`utils/programDelete.ts`) first, so its sessions keep its name in Custom workouts.
- Other single sources of truth: `utils/streak.ts`, `utils/sessionTrack.ts`, `utils/exerciseChanges.ts`, `utils/programHistory.ts`, `utils/weekSchedule.ts`, `utils/achievements.ts`, `utils/skippedDates.ts`, `utils/cycleDrift.ts`, `utils/programHolds.ts`, `utils/programLifecycle.ts`, `utils/programCompare.ts`, `utils/nextSet.ts`, `utils/setRows.ts`, `utils/heldSession.ts`, `utils/units.ts`, `utils/roster.ts`, `utils/trainerStore.ts`, `utils/workoutImport.ts` + `utils/exerciseMatch.ts` + `utils/importStore.ts` (importing another app's history). Read their section in `docs/ARCHITECTURE.md` before changing them.

## Cloud / Supabase

- **A new synced field** needs: type + migration + `database.types` + mappers, AND the migration must recreate `replace_user_data` (it lists columns explicitly). Add it to the `Required<...>` fixtures in `scripts/verify-db.ts`.
- **A new table** grants its own access in its migration (`grant select, insert, update, delete ... to authenticated, service_role`) and enables RLS with policies.
- A new column the app patches on a share/review must be added to the `shared_programs_guard` trigger (0039).
- Message reads are newest-first (order descending, reverse in memory). Realtime channel names carry a per-call counter.
- A read that can pass 1000 rows pages with `.range()` (`lib/cloud.ts:selectEvery`): the API stops at 1000 without saying so, and a restore that did lost every older workout.
- Account-type switches only through the `change_account_type` RPC.
