// WorkoutActivitySupport.swift
//
// Shared definitions for the Avenas workout Live Activity.
//
// ⚠️  DUPLICATED FILE — an identical copy lives at
//     targets/workout-widget/WorkoutActivitySupport.swift.
//     ActivityKit and AppIntents match types across the app and the widget
//     extension by type name + Codable shape, and Apple's LiveActivityIntent
//     contract requires the intent definitions to be compiled into BOTH
//     targets (the button lives in the widget; perform() runs in the app's
//     process). Any edit here MUST be mirrored there byte-for-byte.
//
// Data flow:
//   JS (workout screen) ──startOrUpdate──▶ ActivityKit content state
//                        └─writes────────▶ App-Group defaults: pending-set queue
//   Lock-screen buttons ──LiveActivityIntent (app process)──▶ pops queue,
//     updates content state, appends to the actions log in App-Group defaults
//   JS (on foreground) ──consumeActions──▶ replays ticks into the workout draft
//     and re-syncs the rest timer.

import ActivityKit
import AppIntents
import Foundation

// Must match: targets/workout-widget/expo-target.config.js and app.json
// ios.entitlements (com.apple.security.application-groups).
public let avenasAppGroupId = "group.com.avenas.workout"

enum AvenasSharedKeys {
  static let queue = "avenas.liveactivity.queue"     // JSON [PendingSet]
  static let actions = "avenas.liveactivity.actions" // JSON [QueuedAction]
  static let restEnd = "avenas.liveactivity.restEndMs" // Double; 0 = no rest running
}

// ─── Activity attributes ─────────────────────────────────────────────────────

@available(iOS 16.2, *)
struct WorkoutActivityAttributes: ActivityAttributes {
  /// Everything the card renders. All strings are display-ready (weights are
  /// already in the user's unit) so the widget never does unit math.
  struct ContentState: Codable, Hashable {
    var exerciseName: String   // current exercise; "" once every set is done
    var setLabel: String       // "Set 2 of 4" / "Warmup 1"
    var weight: String         // preview shown by the set label ("" if none)
    var reps: String
    var unit: String           // "kg" | "lbs"
    var doneCount: Int
    var totalCount: Int
    var startedAtMs: Double    // effective workout-timer start (epoch ms); 0 = not running
    var pausedElapsedSec: Int  // shown frozen while startedAtMs == 0
    var restStartMs: Double    // 0 = no rest running
    var restEndMs: Double      // 0 = no rest running
    var allDone: Bool
  }

  var workoutName: String
}

// ─── App-Group payloads ──────────────────────────────────────────────────────

/// One not-yet-done set, in on-screen order. Head of the queue = the set the
/// lock-screen tick button marks done. `weight`/`reps` are a display-only
/// preview (values the user typed, else the previous-session hint) — the tick
/// never writes them into the workout log; the user enters the real numbers
/// after unlocking.
struct PendingSet: Codable {
  var exId: String
  var setType: String  // "warmup" | "working"
  var setIdx: Int      // index within that type's array
  var exerciseName: String
  var setLabel: String
  var weight: String
  var reps: String
  var restSeconds: Int // rest to start after ticking this set
  var isFinal: Bool    // ticking this completes the workout → no rest
}

/// A lock-screen action awaiting replay into the JS workout draft. The replay
/// only marks the set done; `weight`/`reps` echo the preview shown when the
/// tick ran (informational — JS ignores them).
struct QueuedAction: Codable {
  var kind: String     // "tick"
  var exId: String
  var setType: String
  var setIdx: Int
  var weight: String
  var reps: String
  var ts: Double       // epoch ms when the intent ran
}

// ─── Controller (shared by module + intents) ─────────────────────────────────

@available(iOS 16.2, *)
enum WorkoutActivityController {
  static var defaults: UserDefaults? { UserDefaults(suiteName: avenasAppGroupId) }

  static func loadQueue() -> [PendingSet] {
    guard let data = defaults?.data(forKey: AvenasSharedKeys.queue) else { return [] }
    return (try? JSONDecoder().decode([PendingSet].self, from: data)) ?? []
  }

  static func saveQueue(_ queue: [PendingSet]) {
    if let data = try? JSONEncoder().encode(queue) {
      defaults?.set(data, forKey: AvenasSharedKeys.queue)
    }
  }

  static func loadActions() -> [QueuedAction] {
    guard let data = defaults?.data(forKey: AvenasSharedKeys.actions) else { return [] }
    return (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? []
  }

  static func saveActions(_ actions: [QueuedAction]) {
    if let data = try? JSONEncoder().encode(actions) {
      defaults?.set(data, forKey: AvenasSharedKeys.actions)
    }
  }

  static func appendAction(_ action: QueuedAction) {
    var actions = loadActions()
    actions.append(action)
    saveActions(actions)
  }

  static func currentActivity() -> Activity<WorkoutActivityAttributes>? {
    Activity<WorkoutActivityAttributes>.activities.first
  }

  static func update(_ activity: Activity<WorkoutActivityAttributes>,
                     _ state: WorkoutActivityAttributes.ContentState) async {
    await activity.update(ActivityContent(state: state, staleDate: nil))
  }

  /// Lock-screen tick: complete the head pending set (mark-done only — the
  /// queued action's weight/reps are informational). Starts the exercise's
  /// rest timer (unless this set finishes the workout — then rest is cleared,
  /// same as startRestAfterSet), and starts the workout timer on the first
  /// tick.
  static func tickHeadSet() async {
    guard let activity = currentActivity() else { return }
    var queue = loadQueue()
    guard !queue.isEmpty else { return }
    let head = queue.removeFirst()
    saveQueue(queue)

    let nowMs = Date().timeIntervalSince1970 * 1000
    appendAction(QueuedAction(
      kind: "tick", exId: head.exId, setType: head.setType, setIdx: head.setIdx,
      weight: head.weight, reps: head.reps, ts: nowMs))

    var state = activity.content.state
    state.doneCount = min(state.doneCount + 1, state.totalCount)
    if let next = queue.first {
      state.exerciseName = next.exerciseName
      state.setLabel = next.setLabel
      state.weight = next.weight
      state.reps = next.reps
      state.allDone = false
    } else {
      state.allDone = true
      state.exerciseName = ""
      state.setLabel = ""
      state.weight = ""
      state.reps = ""
    }

    if head.isFinal || queue.isEmpty || head.restSeconds <= 0 {
      state.restStartMs = 0
      state.restEndMs = 0
      defaults?.set(0.0, forKey: AvenasSharedKeys.restEnd)
    } else {
      state.restStartMs = nowMs
      state.restEndMs = nowMs + Double(head.restSeconds) * 1000
      defaults?.set(state.restEndMs, forKey: AvenasSharedKeys.restEnd)
    }

    // First tick starts the workout timer (in-app tick calls startTimer()).
    // A paused timer (pausedElapsedSec > 0) is deliberately left paused.
    if state.startedAtMs <= 0 && state.pausedElapsedSec <= 0 {
      state.startedAtMs = nowMs
    }

    await update(activity, state)
  }

  static func skipRest() async {
    guard let activity = currentActivity() else { return }
    var state = activity.content.state
    state.restStartMs = 0
    state.restEndMs = 0
    defaults?.set(0.0, forKey: AvenasSharedKeys.restEnd)
    await update(activity, state)
  }

  /// ±deltaSeconds on the running rest timer. Mirrors adjustRestTimer: shifting
  /// the end at/past "now" dismisses the rest.
  static func adjustRest(by deltaSeconds: Int) async {
    guard let activity = currentActivity() else { return }
    var state = activity.content.state
    let nowMs = Date().timeIntervalSince1970 * 1000
    guard state.restEndMs > nowMs else { return }
    let newEnd = state.restEndMs + Double(deltaSeconds) * 1000
    if newEnd <= nowMs {
      state.restStartMs = 0
      state.restEndMs = 0
    } else {
      state.restEndMs = newEnd
    }
    defaults?.set(state.restEndMs, forKey: AvenasSharedKeys.restEnd)
    await update(activity, state)
  }
}

// ─── App Intents (lock-screen buttons) ───────────────────────────────────────
//
// LiveActivityIntent: the system performs these in the APP's process (waking it
// in the background if needed) without foregrounding it — which is what lets
// them call ActivityKit update APIs. They must be compiled into both targets.

@available(iOS 17.0, *)
struct TickSetIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Complete Set"
  static var isDiscoverable: Bool = false

  func perform() async throws -> some IntentResult {
    await WorkoutActivityController.tickHeadSet()
    return .result()
  }
}

@available(iOS 17.0, *)
struct SkipRestIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Skip Rest"
  static var isDiscoverable: Bool = false

  func perform() async throws -> some IntentResult {
    await WorkoutActivityController.skipRest()
    return .result()
  }
}

@available(iOS 17.0, *)
struct AdjustRestIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Adjust Rest"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Seconds")
  var seconds: Int

  init() {}

  init(seconds: Int) {
    self.seconds = seconds
  }

  func perform() async throws -> some IntentResult {
    await WorkoutActivityController.adjustRest(by: seconds)
    return .result()
  }
}
