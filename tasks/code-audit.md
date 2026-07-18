# Avenas Full Code & Security Audit — Tracker

Started 2026-07-02. Multi-session audit: security, bugs, dead/clashing code, and
cross-file integration. Each session: pick the next unchecked phase section, review
those files fully, log findings here, tick the boxes. Final deliverable at the end:
`docs/ARCHITECTURE.md` — how every part works in conjunction, so future changes
don't break other features.

**Severity legend:** 🔴 security / data-loss · 🟠 functional bug · 🟡 code smell / drift risk · ⚪ note

---

## Phase 1 — Security surface (auth, cloud sync, RLS, secrets, QR/connect) ✅ DONE (Session 1)

- [x] lib/supabase.ts
- [x] lib/auth.ts
- [x] lib/cloud.ts
- [x] lib/syncManager.ts
- [x] lib/mappers.ts
- [x] lib/connections.ts, lib/database.types.ts
- [x] contexts/AuthContext.tsx, contexts/AccountTypeContext.tsx
- [x] supabase/migrations/ (0001–0008, RLS policies)
- [x] app/login.tsx
- [x] app/signup.tsx
- [x] app/complete-profile.tsx
- [x] app/accept-terms.tsx
- [x] app/connect.tsx + components/connect/Scanner.tsx
- [x] app/cloud-test.tsx — REACHABLE IN PROD (see SEC-4)

## Phase 2 — Data layer & core workout flow ✅ DONE (Session 2)

- [x] utils/dates.ts, utils/storage.ts, utils/workout.ts
- [x] utils/progressStats.ts
- [x] constants/programs.ts, constants/journal.ts, constants/exercises.ts, constants/exerciseData.ts (catalogue — shape verified via types + tsc)
- [x] contexts/WorkoutTimerContext.tsx, StreakContext.tsx, UnitContext.tsx, ThemeContext.tsx, AccountTypeContext.tsx, RestTimerContext.tsx, UserProfileContext
- [x] app/(tabs)/workout.tsx (read in full)
- [x] app/log-workout.tsx
- [x] app/new-program.tsx
- [x] hooks/useDayRollover.ts
- [x] scripts/verify-data-layer.ts — matches reality; covers mappers + unit migration too. 89 assertions pass.

## Phase 3 — Read-side screens & progress stack

- [ ] app/(tabs)/home.tsx + components/InsightsCard.tsx + app/insights.tsx
- [ ] app/journal.tsx + components/JournalCalendar.tsx + components/ActivityCalendar.tsx
- [ ] app/programs.tsx, app/program-view.tsx, app/program-history.tsx, app/program-history-detail.tsx
- [ ] app/workout-detail.tsx
- [ ] app/(tabs)/progress.tsx + components/progress/ProgressView.tsx
- [ ] app/exercise-history.tsx, app/exercise-summary.tsx
- [ ] components/ExerciseProgressionChart.tsx, VolumeBarChart.tsx, StrengthRadarChart.tsx, utils/niceAxis.ts
- [ ] app/streak.tsx, contexts/StreakContext follow-ups

## Phase 4 — Trainer mode, messaging, settings, onboarding

- [ ] utils/trainerStore.ts, utils/chatStore.ts, utils/mockClientSeed.ts
- [ ] components/trainer/* (PTHome, MyPTHome, MyCoachesSection, MyTrainersSection, sheets)
- [ ] app/trainer/* (coaches, client/[id], chat/[id], review/[id], messages)
- [ ] hooks/useUnreadMessages.ts, constants/chat.ts, constants/community.ts
- [ ] app/settings.tsx, app/profile.tsx, app/privacy-security.tsx, app/blocked-accounts.tsx
- [ ] app/notifications.tsx, contexts/NotificationPrefsContext.tsx, utils/notifications.ts
- [ ] app/onboarding.tsx + components/onboarding/*
- [ ] app/help-faq.tsx, report-bug.tsx, request-feature.tsx, privacy-policy.tsx, terms-of-service.tsx

## Phase 5 — Shared components sweep + integration map

- [ ] components/ (NeuCard, BounceButton, ExercisePicker, DropdownPicker, TimeEditSheet,
      TimeWheelPicker, IntervalTimerModal, CollapsibleSection/Card, ExerciseImage, Avatar,
      GlassCard, FadeScreen, icons, misc)
- [ ] app/(tabs)/_layout.tsx, app/_layout.tsx, app/index.tsx (provider order, nav wiring)
- [ ] Dead-code / unused-export sweep (ts-prune or grep-based)
- [ ] Cross-check CLAUDE.md data contract vs. actual code (drift)
- [ ] **Write docs/ARCHITECTURE.md** — the "how it all works together" map
- [ ] Update CLAUDE.md if contract drifted

---

## Findings log

(append per session — file, severity, description, status: open/fixed/wontfix)

### Session 1 — 2026-07-02 (Phase 1)

_in progress_

### Session 2 — 2026-07-03 (Phase 2 + repo-wide dead-code sweep)

Global gates run first: `tsc --noEmit` clean · `npm run verify` 89+81 pass ·
`expo lint` 133 problems → **114** after fixes (0 unused-code warnings left;
remainder = 28 cosmetic `react/no-unescaped-entities` + intentional
`exhaustive-deps` in animation code).

**Fixed this session:**

- 🟡 **fixed** — CLAUDE.md data contract listed the custom-exercises key as
  `@avenas_custom_exercises` (underscore). The live key has always been
  `@avenas/custom_exercises` (`CUSTOM_KEY`, slash) — the underscore variant only
  ever existed in comments/docs (verified via `git log -S`). Fixed CLAUDE.md +
  the misleading comment in constants/journal.ts. (supabase/migrations/0001's
  "live key TBD" comment is resolved: slash — applied migration left untouched.)
- 🟡 **fixed** — CLAUDE.md contract was missing three real keys:
  `@avenas/workout_timer_paused_ms`, `@avenas/workout_view_mode`,
  `@avenas/cycle_pattern_coachmark_seen`. Added.
- 🟡 **fixed** — log-workout.tsx inlined its own `MONTH_FULL` (conventions say
  import from utils/dates). new-program.tsx hand-rolled the "DD Mon YYYY"
  format + months array in two places instead of `formatStoredDate`. Both now
  import from utils/dates.
- 🟡 **fixed** — dead code removed across the repo (all lint-verified unused):
  workout.tsx (`LayoutAnimation` import, `moveExercise` fn, `hasTarget` IIFE),
  new-program.tsx (`moveExercise` fn), log-workout.tsx (`TimeVal` import,
  `catch (_)` binding), settings.tsx (`supabase` import),
  program-history-detail.tsx (`ACCT` import, unused `startDate` destructure),
  progress/ProgressView.tsx (`ScrollView` import),
  trainer/RecipientPickerSheet.tsx (`recipientCount`),
  trainer/PTHome.tsx + MyPTHome.tsx (dead `openManage(Clients)` →
  `openRemovePicker`/`handleRemoveClient`/`removeTrainer` chains + the
  write-only `connByOtherId` refs + orphaned `removeCoach`/`disconnect`/
  `saveAssignedPT`/`PlusIcon`/`useRef` imports). Dead since b64a1d1 — the live
  disconnect UX is app/connect.tsx; block-flow disconnect is utils/moderation.
- ⚪ **fixed** — statement-position ternaries → if/else (workout.tsx ×2,
  ExercisePicker.tsx, WorkoutActiveBar.tsx) to clear `no-unused-expressions`.

**Open findings (need a decision / own change):**

- 🟠 **fixed** (Session 2, after sign-off) — workout.tsx cross-program
  change-day dropped the chosen program's exercises on refocus/relaunch.
  `DayOverride` now carries `programId?` (recorded by `handleSelectDay`);
  `resolveWorkoutForDate` gained an optional `allPrograms` param and resolves
  the override against its SOURCE program (falling back to the active program
  for legacy/free-workout overrides, and degrading to name-only if the source
  program is gone). workout.tsx `loadData` + home.tsx pass the full program
  list and take `programId` from the resolved value. CLAUDE.md contract +
  override-flow section updated; 5 new verify assertions (89 → 94), incl.
  backward-compat and deleted-program cases.
- 🟠 **fixed** (Session 2, after sign-off) — StreakContext now uses LOCAL day
  boundaries (`toYMD`) like the rest of the app, with a `dayBasis: "local"`
  flag on the record. One-shot legacy migration: a legacy (UTC-based) record
  with a gap of exactly 2 days is credited as consecutive (a positive-UTC
  morning open recorded yesterday's UTC date — never reset an honest streak),
  and `diff <= 0` (negative-UTC legacy date running a day ahead) is treated as
  same-day instead of a reset. Legacy `openedDates` entries may sit a day off —
  display-only, self-fading. Device-test on next app open recommended.
- 🟡 **open** — 28 `react/no-unescaped-entities` lint errors (copy apostrophes
  in trainer components/sheets). Cosmetic; fix during the Phase 4 file reviews.
- 🟡 **open** — ~84 `exhaustive-deps` warnings, mostly intentional
  mount-once/animation effects. Review per-file in later phases, never bulk-fix.
- ⚪ **note** — ThemeContext reads the system scheme once on mount when no
  preference is saved; a system theme change while the app runs isn't followed.
- ⚪ **note** — log-workout template lookup matches a day by
  `key.endsWith(":name")`; duplicate day names in one program → first wins.

### Session 3 — 2026-07-05 (cross-page integration: workout ↔ journal ↔ builder ↔ trainer)

Scope: workout.tsx re-read in full + traced every shared contract against
journal.tsx (full), new-program.tsx (logic paths), programs.tsx (write paths),
log-workout save path, utils/trainerStore.ts (full), MyPTHome / MyCoachesSection /
PTHome / program-view accept-share flows, JournalCalendar, syncManager.
Advances Phase 3 (journal) and Phase 4 (trainerStore + trainer components) —
boxes left unticked where files weren't read end-to-end (chatStore,
mockClientSeed, ActivityCalendar, remaining trainer screens).
Gates: `tsc --noEmit` clean · `npm run verify` 94+81 pass, before AND after fixes.

**Fixed this session:**

- 🟠 **fixed** — programs.tsx shipped a live "DEV SEED — remove after testing"
  effect that force-patched any program named exactly "TEST" to
  `paused`/week-3 on every mount — silently deactivating a user's active
  program of that name, forever. Removed.
- 🟠 **fixed** — journal.tsx attributed workout cards to programs by day NAME
  only (`programLookup` + `sessionNumbers` keyed on `workoutName`), ignoring
  `CompletedWorkout.programId` — free workouts and same-named days across
  programs got the active program's label and a shared session counter. Now
  attributes per-workout via the canonical
  `utils/progressStats.workoutBelongsToProgram` (exact id for new records,
  name-within-date-window for legacy), same rules as Progress; session numbers
  count within the owning program.
- 🟠 **fixed** — workout.tsx `finalizeComplete` never called
  `dismissRestTimer()`, so "Finish Anyway" mid-rest left the global rest
  countdown running over the locked completed view (handleDiscard already
  dismissed it).
- 🟠 **fixed** — programs.tsx `handleMakeActive` kept a stale `cycleOffset`
  from a previous run while resetting `startDate`/`currentWeek`, so
  re-activating a program started it on an arbitrary mid-cycle day. Now
  cleared on activation (duplicate/accept flows already did).
- 🟡 **fixed** — activating a program (programs.tsx `handleMakeActive` AND
  new-program create-and-activate) left `@avenas/today_workout_override` in
  place, so the workout tab kept showing the demoted program's overridden day
  until rollover. Both paths now clear the override.
- 🟡 **fixed** — new-program's create-and-activate demoted the old active
  program to `"paused"` unconditionally; programs.tsx was week-aware
  (completed / paused / created + currentWeek snapshot). Aligned to the
  programs.tsx logic so the two activation paths can't diverge.
- 🟡 **fixed** — workout.tsx header always labeled the session with the ACTIVE
  program (`activeProgram.name · Week N`), mislabeling cross-program
  change-day sessions and completed free workouts. New `headerProgram`
  resolves from the session's own `programId` (locked view uses the
  CompletedWorkout's; live view uses workoutInfo's; "" → no program line;
  legacy undefined → active program, as before).
- 🟡 **fixed** — synced-key writes that never scheduled a cloud push (only the
  app-background flush saved them): trainer accepts/apply
  (MyPTHome, MyCoachesSection, program-view → PROGRAMS_KEY via trainerStore),
  create-custom-exercise save (CUSTOM_KEY + cascaded program renames), and
  both `deleteCustomExercise` copies (workout.tsx, new-program.tsx). All now
  call `scheduleCloudPush()` per the syncManager contract.
- 🟡 **fixed** — inline `"DD Mon YYYY"` month-array formatting duplicated in
  trainerStore (×3) and programs.tsx `todayFormatted` → `formatStoredDate`
  from utils/dates (same drift Session 2 fixed in log-workout/new-program).
- ⚪ **fixed** — unused StyleSheet keys removed: workout.tsx ×16 (`headerLabel`,
  `repRangeHeader`, `addSetBtn`, `addSetText`, `editChipWrap`, `editChip`,
  `kbFloatRow`, `woOptionRow/Icon/Title/Sub`, `woPickerSection`,
  `exNotesHeader`, `exNotesDone`, `exDoneChip`, `exDoneText`), journal.tsx ×2
  (`pickerOption`, `workoutIconBg`). Lint doesn't flag unused style keys.
- ⚪ **fixed** — CLAUDE.md `workout_history` contract said "newest first";
  backdated journal logs are prepended out of order, and every consumer sorts
  by `completedAt`. Wording corrected.

**Notes (no action):**

- ⚪ workout.tsx `finalizeComplete`'s `extraWorkouts` write doesn't schedule its
  own push but lands well inside `persistCompletedWorkout`'s 2.5 s debounce —
  covered.
- ⚪ Journal timeline cards date-label from `completedAt` while the calendar
  keys off `w.date`; a grace-window (post-midnight) session can show different
  weekdays in the two places. Matches current design; revisit only if reported.
- ⚪ Pausing/deleting the active program while a workout draft is in progress
  drops the workout tab to its "No Active Program" empty state even though the
  draft survives (WorkoutActiveBar still shows the timer). Edge case; the
  session is recoverable by re-activating a program the same day.

**Verified solid (no action):** sequential-await read→write pairs present in
every shared-key writer (workout persist/delete-redo, log-workout save,
new-program saves); no hardcoded storage keys in screens (only new-program's
own `DRAFT_KEY` literal); effective-today / 3am-grace logic consistent across
workout.tsx, useDayRollover and the verify tests; kg-canonical weight lens
applied at every boundary (live log, past log, builder, locked view, prev
hints); Insights card/page wiring correct (modal route registered,
keyboard-controller already app-wide via KeyboardProvider).
