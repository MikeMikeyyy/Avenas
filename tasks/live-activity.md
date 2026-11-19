# Workout Live Activity — build & test guide

The lock-screen / Dynamic Island workout card (iOS Live Activity). Shows the
current exercise with a tick button (marks the set done and, like the in-app
checkbox, fills an empty set with last time's numbers: the ones the card
showed), the workout timer, and the rest timer with Skip / ±15s buttons. Settings toggle: **Settings → App → Lock Screen
Workout** (ON by default).

**Its look (redesigned 2026-10-11, from a review canvas the user approved):**
the set's weight × reps big, the exercise's sets as dots (done, the one up
glowing, to come: its warmups first in the warmup orange, a little apart, then
its working sets in green, `ContentState.warmupDone` / `setDone`, user request
2026-10-21; past 11 in all the warmups give way), the workout bar's dot
(green, amber paused); while
resting, the countdown with REST beside it and −15s +15s Skip as in the app's
rest bar, a line draining above, and the next set with its own tick. It's in
the APP's Dark Mode, never the phone's: a white card in light mode
(`ContentState.isDark`, from ThemeContext via the payload). SF Rounded stands
in for Nunito. **Every state must fit in 160pt**, the most iOS shows of a
lock-screen card: the old card, resting, was about 186pt and lost its rest
buttons. On the always-on display its green fills become outlines.

**This feature can NEVER run in Expo Go.** It needs a development build (or a
production build). In Expo Go everything silently no-ops, so day-to-day Expo Go
development is unaffected.

## What's where

| Piece | Path |
| --- | --- |
| Native module (JS ⇄ ActivityKit bridge) | `modules/avenas-live-activity/` |
| Shared Swift (attributes, intents, controller) | `modules/avenas-live-activity/ios/WorkoutActivitySupport.swift` |
| Widget extension (card UI, iOS 17+) | `targets/workout-widget/` |
| ⚠️ Duplicate of the shared Swift file | `targets/workout-widget/WorkoutActivitySupport.swift` |
| Pure payload builder | `utils/liveActivity.ts` |
| Lifecycle hook (push / end / replay actions) | `hooks/useWorkoutLiveActivity.ts` (when pushes go: `cardPushes` in `utils/liveActivity.ts`) |
| Screen wiring | `app/(tabs)/workout.tsx` ("Lock-screen Live Activity" block) |
| Settings toggle | `app/settings.tsx` (`LIVE_ACTIVITY_KEY`, default ON) |

### Invariants (breaking these breaks the feature)

1. **The two `WorkoutActivitySupport.swift` files must stay byte-identical.**
   ActivityKit/AppIntents match types across the app and widget processes by
   name + Codable shape. Verify after editing:
   `Get-FileHash modules/avenas-live-activity/ios/WorkoutActivitySupport.swift, targets/workout-widget/WorkoutActivitySupport.swift`
2. **The app-group id `group.com.avenas.workout` appears in 4 places** and must
   match everywhere: both Swift copies (`avenasAppGroupId`), `app.json →
   ios.entitlements`, `targets/workout-widget/expo-target.config.js`.
3. JS owns the truth. The widget never computes workout logic; it renders
   content state. The card's weight×reps preview is precomputed in
   `utils/liveActivity.ts` (typed values, else the previous-session hint) and
   queued in app-group defaults; intents pop the queue and log actions; the
   app replays them on foreground (`logWithLockScreenTicks`) as the in-app
   checkbox would tick: an empty set takes last time's numbers from the
   screen's own previous-set hints (`prevFillFor`, the same values the
   preview showed), and typed values stay. Until 2026-10-05 a replayed tick
   only marked the set done, leaving it empty for the user to fill in.

## One-time setup (before the first build)

1. **Set the real bundle id** in `app.json` → `ios.bundleIdentifier` (the id
   the shipped App Store app uses — check App Store Connect). Right now it's
   unset, so prebuild falls back to `com.example.avenas`, which would build a
   different app.
2. **Create `eas.json`** if the repo doesn't have one:

   ```json
   {
     "cli": { "appVersionSource": "remote" },
     "build": {
       "development": {
         "developmentClient": true,
         "distribution": "internal",
         "ios": { "resourceClass": "m-medium" }
       },
       "production": {}
     }
   }
   ```

3. `npm i -g eas-cli` and `eas login` with the Apple-developer-linked account.

## Build & install (no Mac needed — EAS cloud)

```
eas build --profile development --platform ios
```

- EAS syncs capabilities automatically: it registers the
  `group.com.avenas.workout` App Group and provisions the
  `AvenasWorkoutWidget` extension (it's declared under
  `extra.eas.build.experimental.ios.appExtensions` by the config plugin).
- When it finishes, install on the iPhone via the QR code, then run
  `npx expo start` and open the project from the dev build (not Expo Go).

## Test checklist

1. Settings → App → **Lock Screen Workout** exists, ON by default.
2. Start a workout (tick a set or type a value), lock the phone → the card
   shows workout name, elapsed timer counting, current exercise, set label and
   the weight × reps preview, with a dot per set (warmups orange, working sets
   green). Tick two warmups from the lock screen → their dots fill orange, one
   then the other, before the first green one glows. In the app's light
   mode it's white, in its dark mode navy, whatever the phone is set to;
   switching the app's Dark Mode mid-workout changes it.
3. Tap the tick on an **empty** set from the lock screen → card advances to
   the next set; back in the app the set is **ticked with last time's
   numbers filled in**, the same weight × reps the card showed (anything
   typed before locking is kept; a set with no previous numbers stays empty).
3a. Type only a weight on a set (more than last time), leave its reps empty,
   lock and tick it → the card showed your weight with last time's reps, and
   back in the app the set has both (2026-11-14: each empty box fills, a typed
   one stays). The same with only reps typed: last time's weight goes in.
4. After a lock-screen tick, the rest takes the card (if that exercise has a
   rest time): countdown, line, −15s +15s Skip, and the next set below, none
   of it cut off. Skip and ±15s work; reopening the app shows the in-app rest
   banner in sync. Left alone, the rest ends and the card goes back to the set
   by itself (on a lit lock screen, at the next screen off and on: see the risk
   below).
4a. With Rest timer alerts on: tick from the lock screen, put the phone face
   down. At the rest's end "Rest complete" arrives (sound), the screen lights
   and the card shows the next set big. Skip cancels it, ±15s moves it, and
   opening the app mid-rest leaves one alert (the app's), never two.
5. Finish or discard the workout → card disappears. Toggle OFF in Settings →
   card disappears mid-workout and stays gone.
5a. Change a card's sets in the app (− the last set, turn a warmup into a
   working set) and lock the phone **at once** → the lock-screen card's dots
   and set match the page; the same leaving for the home screen (the Dynamic
   Island). A change waits 400ms to coalesce typing, and one still waiting
   goes as the app leaves the foreground (`cardPushes` flush). Before
   2026-10-28 it didn't, and a quick lock left the card a change behind.
6. Dynamic Island: compact shows the rest countdown while resting, elapsed
   otherwise; long-press expands to the full controls.

## Known iteration risks (first build)

- **Buttons render but do nothing:** App Intents metadata may not be extracted
  from the CocoaPods static lib on older Xcode images. Fix: bump the EAS build
  image (Xcode ≥ 16), or as a fallback move the app-side
  `WorkoutActivitySupport.swift` out of the pod and into the app target.
- **Plugin complains about a team id:** change the plugin entry in app.json to
  `["@bacons/apple-targets", { "appleTeamId": "YOURTEAMID" }]` (from
  developer.apple.com → Membership).
- **Card never appears:** confirm iOS 17+, and iPhone Settings → Avenas →
  Live Activities is allowed; then check `isLiveActivityAvailable()` logs.
- **Rest hits 0:00 and lingers on a lit lock screen:** expected, iOS's doing.
  A card with a rest running goes stale when the rest ends
  (`WorkoutActivityController.content`), and the card shows the rest only
  while it isn't (`showsRest`), but iOS applies the stale redraw lazily on the
  lock screen: when it next lays the screen out (screen off and on, unlock),
  not at the second (user report, 2026-11-14; others report the same). No
  app code can run then. What helps (user pick, 2026-11-14): a rest started,
  moved or skipped ON the card gets the app's "Rest complete" alert natively
  (`RestAlert`, in the shared Swift file), whose arrival lights a dark screen
  and so redraws the card in its next-set look. Under the app's Rest timer
  alerts setting, which the app mirrors to the app group
  (`AvenasSharedKeys.restAlerts`, `setLockScreenRestAlerts`, at launch and on
  every change), and the phone's notification permission (never asked for
  from the card). One rest alert at a time: the card's cancels any pending
  (the app's too, by its data's kind "restTimer"), and the app cancels the
  card's when it schedules its own or takes the rest back (`consumeActions`,
  `cancelLockScreenRestAlert`). On a screen already lit, the card can still
  wait for the next layout; the exact fix is a server push timed to the
  rest's end (ActivityKit push), not built.
- **New card fields are optional** (`ContentState` / `PendingSet` from
  `isWarmup` on): a card an older build put up must still decode after an
  update, so never add a required field to either.
