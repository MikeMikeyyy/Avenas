# Workout Live Activity — build & test guide

The lock-screen / Dynamic Island workout card (iOS Live Activity). Shows the
current exercise with a tick button (marks the set done — no numbers are
written; the user types them in after unlocking), the workout timer, and the
rest timer with Skip / ±15s buttons. Settings toggle: **Settings → App → Lock Screen
Workout** (ON by default).

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
| Lifecycle hook (push / end / replay actions) | `hooks/useWorkoutLiveActivity.ts` |
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
   app replays them on foreground as mark-done-only ticks — the preview
   numbers are never written into the log.

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
   the weight × reps preview.
3. Tap the tick on an **empty** set from the lock screen → card advances to
   the next set; back in the app the set is **ticked with the inputs still
   empty**, ready for the real numbers (anything typed before locking is
   kept — the card's weight×reps preview is guidance only, never committed).
4. After a lock-screen tick, the rest countdown + progress bar appear (if that
   exercise has a rest time). Skip and ±15s buttons work; reopening the app
   shows the in-app rest banner in sync.
5. Finish or discard the workout → card disappears. Toggle OFF in Settings →
   card disappears mid-workout and stays gone.
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
- **Rest hits 0:00 and lingers:** expected — ActivityKit can't self-update at
  expiry; the next tick/update clears it.
