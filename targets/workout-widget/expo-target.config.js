/** @type {import('@bacons/apple-targets').Config} */
// Widget-extension target for the workout Live Activity. Generated into the
// Xcode project by @bacons/apple-targets during `expo prebuild` (EAS does this
// automatically). Deployment target is iOS 17 because the card's buttons
// (tick / skip / ±15s) need interactive Live Activities.
//
// The app-group id here MUST match:
//   - app.json → ios.entitlements → com.apple.security.application-groups
//   - avenasAppGroupId in modules/avenas-live-activity/ios/WorkoutActivitySupport.swift
//     and its duplicate in this folder.
module.exports = {
  type: "widget",
  name: "AvenasWorkoutWidget",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.avenas.workout"],
  },
};
