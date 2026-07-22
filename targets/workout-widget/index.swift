// Avenas workout Live Activity — lock screen card + Dynamic Island.
//
// Everything renders from WorkoutActivityAttributes.ContentState (see
// WorkoutActivitySupport.swift in this folder — a byte-identical copy of the
// app-side file; edit both together). Timers use Text(timerInterval:)/.timer
// styles so they keep counting natively while the app is suspended.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// ACCT from constants/theme.ts (#1deca0).
let avenasAccent = Color(red: 29 / 255, green: 236 / 255, blue: 160 / 255)
// APP_DARK-ish card tint so the activity matches the app's dark surfaces.
let avenasCardTint = Color(red: 0.075, green: 0.086, blue: 0.165)

@main
struct AvenasWidgets: WidgetBundle {
  var body: some Widget {
    WorkoutLiveActivity()
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func msDate(_ ms: Double) -> Date {
  Date(timeIntervalSince1970: ms / 1000)
}

func isResting(_ state: WorkoutActivityAttributes.ContentState) -> Bool {
  state.restEndMs > Date().timeIntervalSince1970 * 1000
}

func restInterval(_ state: WorkoutActivityAttributes.ContentState) -> ClosedRange<Date> {
  let end = msDate(state.restEndMs)
  let start = state.restStartMs > 0 ? msDate(min(state.restStartMs, state.restEndMs)) : Date()
  return start...end
}

func formatFrozenElapsed(_ secs: Int) -> String {
  let h = secs / 3600
  let m = (secs % 3600) / 60
  let s = secs % 60
  return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

/// Parse a working-set label ("Set 3 of 4") into (completed, total) for the
/// per-exercise progress bar. `done` = sets finished before the current one, so
/// the bar advances as each set is ticked. Returns nil for warmups /
/// unrecognized labels — those fall back to showing the label text.
func workingProgress(_ label: String) -> (done: Int, total: Int)? {
  guard label.hasPrefix("Set ") else { return nil }
  let parts = String(label.dropFirst(4)).components(separatedBy: " of ")
  guard parts.count == 2,
        let current = Int(parts[0].trimmingCharacters(in: .whitespaces)),
        let total = Int(parts[1].trimmingCharacters(in: .whitespaces)),
        total > 0 else { return nil }
  return (min(max(current - 1, 0), total), total)
}

// ─── shared subviews ─────────────────────────────────────────────────────────

/// Applies a fixed max width only when one is given; nil lets the timer hug its
/// digits so an adjacent icon sits right next to the number.
struct MaybeMaxWidth: ViewModifier {
  let width: CGFloat?
  @ViewBuilder func body(content: Content) -> some View {
    if let width {
      content.frame(maxWidth: width, alignment: .trailing)
    } else {
      content
    }
  }
}

/// Live count-up while the workout timer runs; frozen mm:ss while paused.
/// `width: nil` hugs the digits (used in the lock-screen header so the stopwatch
/// icon sits tight against the time).
struct ElapsedTimer: View {
  let state: WorkoutActivityAttributes.ContentState
  var width: CGFloat? = 64

  @ViewBuilder var timerText: some View {
    if state.startedAtMs > 0 {
      Text(msDate(state.startedAtMs), style: .timer)
    } else {
      Text(formatFrozenElapsed(state.pausedElapsedSec))
    }
  }

  var body: some View {
    timerText
      .monospacedDigit()
      .multilineTextAlignment(.trailing)
      .modifier(MaybeMaxWidth(width: width))
  }
}

/// Current exercise + pending set preview + the tick button.
struct SetRow: View {
  let state: WorkoutActivityAttributes.ContentState

  var preview: String {
    let w = state.weight.isEmpty ? "—" : "\(state.weight) \(state.unit)"
    let r = state.reps.isEmpty ? "—" : state.reps
    return "\(w) × \(r)"
  }

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(state.exerciseName)
          .font(.headline)
          .lineLimit(1)
        // Per-exercise set progress: a bar that fills as each working set is
        // ticked. Warmups (no "of N") fall back to their label text.
        if let p = workingProgress(state.setLabel) {
          HStack(spacing: 8) {
            ProgressView(value: Double(p.done), total: Double(p.total))
              .tint(avenasAccent)
            Text("\(p.done)/\(p.total)")
              .font(.caption2.weight(.semibold))
              .monospacedDigit()
              .foregroundStyle(.secondary)
          }
        } else {
          Text(state.setLabel)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Text(preview)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(avenasAccent)
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      Button(intent: TickSetIntent()) {
        Image(systemName: "checkmark")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(.black)
          .frame(width: 42, height: 42)
          .background(Circle().fill(avenasAccent))
      }
      .buttonStyle(.plain)
    }
  }
}

/// Rest countdown + progress + skip / ±15s buttons.
struct RestRow: View {
  let state: WorkoutActivityAttributes.ContentState

  var body: some View {
    let interval = restInterval(state)
    VStack(spacing: 7) {
      HStack {
        HStack(spacing: 5) {
          Image(systemName: "timer")
            .font(.caption.weight(.semibold))
          Text("REST")
            .font(.caption.weight(.bold))
            .tracking(1)
        }
        .foregroundStyle(.secondary)
        Spacer()
        Text(timerInterval: interval, countsDown: true)
          .font(.title3.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(avenasAccent)
          .frame(maxWidth: 64, alignment: .trailing)
      }
      ProgressView(timerInterval: interval, countsDown: true) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
      .tint(avenasAccent)
      HStack(spacing: 8) {
        RestButton(label: "-15s", intent: AdjustRestIntent(seconds: -15))
        RestSkipButton()
        RestButton(label: "+15s", intent: AdjustRestIntent(seconds: 15))
      }
    }
  }
}

struct RestButton: View {
  let label: String
  let intent: AdjustRestIntent

  var body: some View {
    Button(intent: intent) {
      Text(label)
        .font(.footnote.weight(.semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(Capsule().strokeBorder(.white.opacity(0.35), lineWidth: 1))
    }
    .buttonStyle(.plain)
  }
}

struct RestSkipButton: View {
  var body: some View {
    Button(intent: SkipRestIntent()) {
      Text("Skip")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.black)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(Capsule().fill(avenasAccent))
    }
    .buttonStyle(.plain)
  }
}

struct AllDoneRow: View {
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(avenasAccent)
      Text("All sets done. Open Avenas to finish!")
        .font(.subheadline.weight(.semibold))
      Spacer()
    }
  }
}

// ─── lock screen card ────────────────────────────────────────────────────────

struct LockScreenCard: View {
  let workoutName: String
  let state: WorkoutActivityAttributes.ContentState

  var body: some View {
    VStack(spacing: 12) {
      HStack(spacing: 7) {
        Image("avenasLogo")
          .resizable()
          .scaledToFit()
          .frame(height: 15)
        Text(workoutName)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        if state.totalCount > 0 {
          Text("\(state.doneCount)/\(state.totalCount)")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        Spacer()
        HStack(spacing: 4) {
          Image(systemName: state.startedAtMs > 0 ? "stopwatch" : "pause.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
          // width: nil so the icon hugs the time instead of a gap.
          ElapsedTimer(state: state, width: nil)
        }
        .font(.subheadline.weight(.semibold))
      }
      if state.allDone {
        AllDoneRow()
      } else if !state.exerciseName.isEmpty {
        SetRow(state: state)
      }
      if isResting(state) {
        RestRow(state: state)
      }
    }
    .padding(14)
    .foregroundStyle(.white)
  }
}

// ─── widget ──────────────────────────────────────────────────────────────────

struct WorkoutLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
      LockScreenCard(workoutName: context.attributes.workoutName, state: context.state)
        .activityBackgroundTint(avenasCardTint.opacity(0.94))
        .activitySystemActionForegroundColor(avenasAccent)
        .widgetURL(URL(string: "avenas://workout"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Text(context.attributes.workoutName)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
            Text(context.state.allDone ? "All done" : context.state.exerciseName)
              .font(.headline)
              .lineLimit(1)
          }
          .padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.trailing) {
          HStack(spacing: 4) {
            Image(systemName: context.state.startedAtMs > 0 ? "stopwatch" : "pause.fill")
              .font(.caption)
              .foregroundStyle(.secondary)
            ElapsedTimer(state: context.state)
          }
          .font(.subheadline.weight(.semibold))
          .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 10) {
            if context.state.allDone {
              AllDoneRow()
            } else if !context.state.exerciseName.isEmpty {
              SetRow(state: context.state)
            }
            if isResting(context.state) {
              RestRow(state: context.state)
            }
          }
          .padding(.horizontal, 6)
          .padding(.top, 4)
          .foregroundStyle(.white)
        }
      } compactLeading: {
        Image("avenasLogo")
          .resizable()
          .scaledToFit()
          .frame(height: 15)
      } compactTrailing: {
        if isResting(context.state) {
          Text(timerInterval: restInterval(context.state), countsDown: true)
            .monospacedDigit()
            .font(.caption.weight(.semibold))
            .foregroundStyle(avenasAccent)
            .frame(maxWidth: 44)
            .minimumScaleFactor(0.8)
        } else if context.state.startedAtMs > 0 {
          Text(msDate(context.state.startedAtMs), style: .timer)
            .monospacedDigit()
            .font(.caption.weight(.semibold))
            .frame(maxWidth: 44)
            .minimumScaleFactor(0.8)
        } else {
          Image(systemName: "pause.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } minimal: {
        Image("avenasLogo")
          .resizable()
          .scaledToFit()
          .frame(height: 13)
      }
      .keylineTint(avenasAccent)
    }
  }
}
