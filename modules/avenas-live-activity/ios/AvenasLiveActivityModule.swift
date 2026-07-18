// AvenasLiveActivityModule.swift
//
// JS ⇄ ActivityKit bridge. JS owns the truth (the workout draft); this module
// projects it into the Live Activity and hands back the lock-screen actions
// that accumulated while the app was backgrounded.

import ActivityKit
import ExpoModulesCore

struct PendingSetRecord: Record {
  @Field var exId: String = ""
  @Field var setType: String = "working"
  @Field var setIdx: Int = 0
  @Field var exerciseName: String = ""
  @Field var setLabel: String = ""
  @Field var weight: String = ""
  @Field var reps: String = ""
  @Field var restSeconds: Int = 0
  @Field var isFinal: Bool = false
}

struct ActivityPayloadRecord: Record {
  @Field var workoutName: String = ""
  @Field var unit: String = "kg"
  @Field var startedAtMs: Double = 0
  @Field var pausedElapsedSec: Int = 0
  @Field var restStartMs: Double = 0
  @Field var restEndMs: Double = 0
  @Field var doneCount: Int = 0
  @Field var totalCount: Int = 0
  @Field var queue: [PendingSetRecord] = []
}

public class AvenasLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AvenasLiveActivity")

    // Interactive Live Activities (Button(intent:)) need iOS 17, so the whole
    // feature is gated there rather than 16.x showing dead buttons.
    Function("isAvailable") { () -> Bool in
      if #available(iOS 17.0, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("startOrUpdate") { (payload: ActivityPayloadRecord) async in
      guard #available(iOS 17.0, *) else { return }

      let queue = payload.queue.map {
        PendingSet(
          exId: $0.exId, setType: $0.setType, setIdx: $0.setIdx,
          exerciseName: $0.exerciseName, setLabel: $0.setLabel,
          weight: $0.weight, reps: $0.reps,
          restSeconds: $0.restSeconds, isFinal: $0.isFinal)
      }
      WorkoutActivityController.saveQueue(queue)
      WorkoutActivityController.defaults?.set(payload.restEndMs, forKey: AvenasSharedKeys.restEnd)

      let head = queue.first
      let state = WorkoutActivityAttributes.ContentState(
        exerciseName: head?.exerciseName ?? "",
        setLabel: head?.setLabel ?? "",
        weight: head?.weight ?? "",
        reps: head?.reps ?? "",
        unit: payload.unit,
        doneCount: payload.doneCount,
        totalCount: payload.totalCount,
        startedAtMs: payload.startedAtMs,
        pausedElapsedSec: payload.pausedElapsedSec,
        restStartMs: payload.restStartMs,
        restEndMs: payload.restEndMs,
        allDone: head == nil && payload.totalCount > 0)

      // A workout-name change means a different session — replace the card.
      if let activity = WorkoutActivityController.currentActivity(),
         activity.attributes.workoutName != payload.workoutName {
        await activity.end(
          ActivityContent(state: activity.content.state, staleDate: nil),
          dismissalPolicy: .immediate)
      }

      if let activity = WorkoutActivityController.currentActivity() {
        await WorkoutActivityController.update(activity, state)
      } else {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
          _ = try Activity.request(
            attributes: WorkoutActivityAttributes(workoutName: payload.workoutName),
            content: ActivityContent(state: state, staleDate: nil))
        } catch {
          NSLog("[avenas] Live Activity request failed: %@", error.localizedDescription)
        }
      }
    }

    AsyncFunction("end") { () async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<WorkoutActivityAttributes>.activities {
        await activity.end(
          ActivityContent(state: activity.content.state, staleDate: nil),
          dismissalPolicy: .immediate)
      }
      let defaults = WorkoutActivityController.defaults
      defaults?.removeObject(forKey: AvenasSharedKeys.queue)
      defaults?.removeObject(forKey: AvenasSharedKeys.actions)
      defaults?.removeObject(forKey: AvenasSharedKeys.restEnd)
    }

    // Drains the lock-screen action log. Returns the actions in the order the
    // intents ran plus the current rest-end mirror so JS can re-sync its timer.
    AsyncFunction("consumeActions") { () -> [String: Any] in
      guard #available(iOS 16.2, *) else { return ["actions": [], "restEndMs": 0.0] }
      let actions = WorkoutActivityController.loadActions()
      if !actions.isEmpty {
        WorkoutActivityController.saveActions([])
      }
      let restEndMs = WorkoutActivityController.defaults?
        .double(forKey: AvenasSharedKeys.restEnd) ?? 0
      return [
        "actions": actions.map { a in
          [
            "kind": a.kind,
            "exId": a.exId,
            "setType": a.setType,
            "setIdx": a.setIdx,
            "weight": a.weight,
            "reps": a.reps,
            "ts": a.ts,
          ] as [String: Any]
        },
        "restEndMs": restEndMs,
      ]
    }
  }
}
