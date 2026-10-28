// Avenas workout Live Activity — lock screen card + Dynamic Island.
//
// Everything renders from WorkoutActivityAttributes.ContentState (see
// WorkoutActivitySupport.swift in this folder — a byte-identical copy of the
// app-side file; edit both together). Timers use Text(timerInterval:)/.timer
// styles so they keep counting natively while the app is suspended.
//
// It looks like the app (redesigned 2026-10-11 from a review canvas the user
// approved): the app's colours, in the app's own Dark Mode, never the phone's
// (a white card in light mode); SF Rounded standing in for Nunito; the
// in-app checkbox's white tick on green; the rest bar's time with REST beside
// it and −15s +15s Skip; the workout bar's dot, green running and amber
// paused; and the exercise's sets as dots, like the app's session track
// (warmups orange, working sets green). Every
// state fits in the 160pt iOS gives a lock-screen card: the old one, resting,
// was about 186pt and lost its rest buttons off the bottom. A long exercise
// name takes a second line rather than hide the weight and reps beside it
// (2026-10-15, RestBlock), still inside 160pt.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

typealias CardState = WorkoutActivityAttributes.ContentState

// ─── colours (constants/theme.ts) ────────────────────────────────────────────

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(.sRGB,
              red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255,
              opacity: opacity)
  }
}

/// ACCT.
let avenasAccent = Color(hex: 0x1DECA0)
/// ACCT_DEEP: the accent where it's small on white.
let avenasAccentDeep = Color(hex: 0x0C9F6E)
/// The workout bar's paused dot.
let pausedAmber = Color(hex: 0xF59E0B)
/// WARMUP_ORANGE: a warmup set, as the Workout tab marks one.
let warmupOrange = Color(hex: 0xFFBF0F)

/// The card's surface and text in the app's theme (APP_DARK / APP_LIGHT).
struct CardPalette {
  let bg: Color    // the card: APP_DARK.bg, or white like the light workout bar
  let tp: Color    // text
  let ts: Color    // quieter text
  let chip: Color  // the rest buttons: the workout bar's button fill
  let ring: Color  // a set still to come
  let isDark: Bool

  // Graphite on dark and Porcelain on light, as the app (2026-10-28).
  static let dark = CardPalette(
    bg: Color(hex: 0x111214), tp: Color(hex: 0xF3F4F6), ts: Color(hex: 0x9A9EA8),
    chip: .white.opacity(0.12), ring: Color(hex: 0x9A9EA8, opacity: 0.6), isDark: true)
  static let light = CardPalette(
    bg: .white, tp: Color(hex: 0x1E2738), ts: Color(hex: 0x5E6B82),
    chip: Color(hex: 0xEDF1F6), ring: Color(hex: 0xC4CAD3), isDark: false)
  /// The Dynamic Island is always black, whatever the theme.
  static let island = CardPalette(
    bg: .black, tp: .white, ts: Color(hex: 0x9A9EA8),
    chip: .white.opacity(0.14), ring: Color(hex: 0x9A9EA8, opacity: 0.6), isDark: true)

  /// The app's Dark Mode, from the card. A card an older build put up has
  /// none, and reads light, the app's default.
  static func of(_ state: CardState) -> CardPalette {
    (state.isDark ?? false) ? .dark : .light
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func msDate(_ ms: Double) -> Date {
  Date(timeIntervalSince1970: ms / 1000)
}

func isResting(_ state: CardState) -> Bool {
  state.restEndMs > Date().timeIntervalSince1970 * 1000
}

func restInterval(_ state: CardState) -> ClosedRange<Date> {
  let end = msDate(state.restEndMs)
  let start = state.restStartMs > 0 ? msDate(min(state.restStartMs, state.restEndMs)) : Date()
  return start...end
}

/// The rest is what the card shows: one running, the card not stale (a rest
/// makes it stale as it ends, which is when iOS redraws it:
/// WorkoutActivityController.content), and sets still to do.
func showsRest(_ context: ActivityViewContext<WorkoutActivityAttributes>) -> Bool {
  !context.state.allDone && !context.isStale && isResting(context.state)
}

func formatFrozenElapsed(_ secs: Int) -> String {
  let h = secs / 3600
  let m = (secs % 3600) / 60
  let s = secs % 60
  return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

enum TimerState { case running, paused, notStarted }

func timerState(_ state: CardState) -> TimerState {
  if state.startedAtMs > 0 { return .running }
  return state.pausedElapsedSec > 0 ? .paused : .notStarted
}

/// The workout bar's dot: green while the clock runs, amber paused.
func timerDot(_ state: CardState, _ p: CardPalette) -> Color {
  switch timerState(state) {
  case .running: return avenasAccent
  case .paused: return pausedAmber
  case .notStarted: return p.ts
  }
}

/// The set's numbers in a line: "80 kg × 8", "80 kg", "8 reps", a hold's
/// "60 s", or "" when there's nothing to go on yet.
func setNumbersText(_ state: CardState) -> String {
  let hold = state.isHold ?? false
  let w = state.weight
  let r = state.reps
  if !w.isEmpty {
    let weight = "\(w) \(state.unit)"
    return r.isEmpty ? weight : "\(weight) × \(r)\(hold ? " s" : "")"
  }
  if !r.isEmpty { return hold ? "\(r) s" : "\(r) \(r == "1" ? "rep" : "reps")" }
  return ""
}

// ─── shared pieces ───────────────────────────────────────────────────────────

/// Live count-up while the workout timer runs; frozen while paused.
struct ElapsedTimer: View {
  let state: CardState
  var width: CGFloat = 70

  var body: some View {
    Group {
      if state.startedAtMs > 0 {
        Text(msDate(state.startedAtMs), style: .timer)
      } else {
        Text(formatFrozenElapsed(state.pausedElapsedSec))
      }
    }
    .monospacedDigit()
    .multilineTextAlignment(.trailing)
    .frame(maxWidth: width, alignment: .trailing)
  }
}

/// The set's numbers, big: the weight and reps the eye goes to mid-set, with
/// their units small beside them.
struct SetNumbers: View {
  let state: CardState
  let size: CGFloat
  let p: CardPalette

  var body: some View {
    let hold = state.isHold ?? false
    HStack(alignment: .firstTextBaseline, spacing: size * 0.15) {
      if !state.weight.isEmpty {
        number(state.weight)
        unit(state.unit)
        if !state.reps.isEmpty {
          Text("×")
            .font(.system(size: size * 0.62, weight: .heavy))
            .foregroundStyle(p.ts)
          number(state.reps)
          if hold { unit("s") }
        }
      } else if !state.reps.isEmpty {
        number(state.reps)
        unit(hold ? "s" : state.reps == "1" ? "rep" : "reps")
      } else {
        number("—")
      }
    }
    .lineLimit(1)
    .minimumScaleFactor(0.6)
  }

  private func number(_ s: String) -> some View {
    Text(s)
      .font(.system(size: size, weight: .black))
      .monospacedDigit()
      .foregroundStyle(p.tp)
  }

  private func unit(_ s: String) -> some View {
    Text(s)
      .font(.system(size: size * 0.5, weight: .heavy))
      .foregroundStyle(p.ts)
  }
}

/// The exercise's sets as the app's session dots, its warmups first in the
/// warmup orange, a little apart, then its working sets in green: done filled,
/// the one that's up glowing, the rest hollow (user request, 2026-10-21: on a
/// warmup nothing filled, as warmups had no dots). A card an older build put
/// up has no warmups and shows its working sets alone, as before. Past 11 dots
/// in all (the gap between takes about a twelfth's room) the warmups give way,
/// so the row is never wider than its old 12; past 12 working sets there are
/// none.
struct SetDots: View {
  let state: CardState
  let size: CGFloat
  let p: CardPalette
  @Environment(\.isLuminanceReduced) var dim

  var body: some View {
    let working = state.setDone ?? []
    let allWarmups = state.warmupDone ?? []
    let warmups = allWarmups.count + working.count <= 11 ? allWarmups : []
    let onWarmup = state.isWarmup ?? false
    let current = state.setIdx ?? -1
    if !(warmups.isEmpty && working.isEmpty) && working.count <= 12 {
      HStack(spacing: size * 0.6) {
        ForEach(0..<warmups.count, id: \.self) { i in
          dot(isDone: warmups[i], isCurrent: onWarmup && i == current, color: warmupOrange)
        }
        if !warmups.isEmpty && !working.isEmpty {
          Color.clear.frame(width: size * 0.3, height: 1)
        }
        ForEach(0..<working.count, id: \.self) { i in
          dot(isDone: working[i], isCurrent: !onWarmup && i == current, color: avenasAccent)
        }
      }
    }
  }

  @ViewBuilder
  private func dot(isDone: Bool, isCurrent: Bool, color: Color) -> some View {
    if isDone {
      Circle().fill(color).frame(width: size, height: size)
    } else if isCurrent {
      Circle()
        .strokeBorder(color, lineWidth: 1.5)
        .frame(width: size, height: size)
        .shadow(color: color.opacity(dim ? 0 : 0.75), radius: 3)
    } else {
      Circle().strokeBorder(p.ring, lineWidth: 1.5).frame(width: size, height: size)
    }
  }
}

/// The app's ticked checkbox, big: a white tick on green, glowing. On the
/// always-on display just its outline, so it doesn't glare.
struct TickDisc: View {
  let size: CGFloat
  @Environment(\.isLuminanceReduced) var dim

  var body: some View {
    Image(systemName: "checkmark")
      .font(.system(size: size * 0.42, weight: .heavy))
      .foregroundStyle(dim ? avenasAccent : .white)
      .frame(width: size, height: size)
      .background {
        if dim {
          Circle().strokeBorder(avenasAccent, lineWidth: 2)
        } else {
          Circle().fill(avenasAccent).shadow(color: avenasAccent.opacity(0.5), radius: size * 0.16)
        }
      }
  }
}

/// Ticks the set that's up (TickSetIntent), as the app's checkbox does.
struct TickButton: View {
  let size: CGFloat

  var body: some View {
    Button(intent: TickSetIntent()) {
      TickDisc(size: size)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Complete set")
  }
}

/// −15s / +15s, on the workout bar's button fill.
struct RestChip: View {
  let label: String
  let spoken: String
  let intent: AdjustRestIntent
  let p: CardPalette
  var wide = false

  var body: some View {
    Button(intent: intent) {
      Text(label)
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(p.tp)
        .padding(.horizontal, 11)
        .frame(maxWidth: wide ? .infinity : nil)
        .frame(height: 34)
        .background(Capsule().fill(p.chip))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(spoken)
  }
}

/// Skip, the app's green: outlined on the always-on display.
struct SkipChip: View {
  let p: CardPalette
  var wide = false
  @Environment(\.isLuminanceReduced) var dim

  var body: some View {
    Button(intent: SkipRestIntent()) {
      Text("Skip")
        .font(.system(size: 13, weight: .heavy))
        .foregroundStyle(dim ? avenasAccent : .white)
        .padding(.horizontal, 15)
        .frame(maxWidth: wide ? .infinity : nil)
        .frame(height: 34)
        .background {
          if dim {
            Capsule().strokeBorder(avenasAccent, lineWidth: 1.5)
          } else {
            Capsule().fill(avenasAccent).shadow(color: avenasAccent.opacity(0.4), radius: 4, y: 2)
          }
        }
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Skip the rest")
  }
}

/// The three rest buttons, in the app's order.
struct RestButtons: View {
  let p: CardPalette
  var wide = false

  var body: some View {
    RestChip(label: "−15s", spoken: "15 seconds less rest", intent: AdjustRestIntent(seconds: -15), p: p, wide: wide)
    RestChip(label: "+15s", spoken: "15 seconds more rest", intent: AdjustRestIntent(seconds: 15), p: p, wide: wide)
    SkipChip(p: p, wide: wide)
  }
}

/// The time left with REST beside it on its baseline, as in the app's rest bar.
/// A countdown's text is as wide as its widest value, so it's given the width
/// of "m:ss" (tabular digits make every one the same) for REST to sit beside it.
struct RestTime: View {
  let state: CardState
  let size: CGFloat
  let p: CardPalette

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: size * 0.18) {
      Text(timerInterval: restInterval(state), countsDown: true)
        .font(.system(size: size, weight: .black))
        .monospacedDigit()
        .foregroundStyle(p.tp)
        .multilineTextAlignment(.leading)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(width: size * 2.15, alignment: .leading)
      Text("REST")
        .font(.system(size: size * 0.32, weight: .heavy))
        .tracking(1.2)
        .foregroundStyle(p.ts)
    }
  }
}

/// The rest counting down as a line, draining from the right like the app's.
struct RestLine: View {
  let state: CardState

  var body: some View {
    ProgressView(timerInterval: restInterval(state), countsDown: true) {
      EmptyView()
    } currentValueLabel: {
      EmptyView()
    }
    .tint(avenasAccent)
  }
}

/// The rest as a ring, for the island's small spaces.
struct RestRing: View {
  let state: CardState

  var body: some View {
    ProgressView(timerInterval: restInterval(state), countsDown: true) {
      EmptyView()
    } currentValueLabel: {
      EmptyView()
    }
    .progressViewStyle(.circular)
    .tint(avenasAccent)
    .frame(width: 20, height: 20)
  }
}

/// The longest name the set that's next shows whole on the lock screen: the
/// longest in the exercise list. Only a custom exercise's can be longer, and
/// it's shortened, so a name and its numbers always fit in two lines.
let upNextNameMax = 32

/// "Bench Press · 80 kg × 8", the set that's next. `maxName` shortens a longer
/// name with an ellipsis, so the name gives way rather than its numbers.
func upNextLine(_ state: CardState, _ p: CardPalette, maxName: Int? = nil) -> Text {
  var shown = state.exerciseName
  if let maxName, shown.count > maxName {
    shown = String(shown.prefix(maxName - 1)).trimmingCharacters(in: .whitespaces) + "…"
  }
  let name: Text = Text(shown)
    .font(.system(size: 16, weight: .heavy))
    .foregroundStyle(p.tp)
  let numbers = setNumbersText(state)
  guard !numbers.isEmpty else { return name }
  let rest: Text = Text("  ·  \(numbers)")
    .font(.system(size: 16, weight: .bold))
    .foregroundStyle(p.ts)
  return name + rest
}

/// The set that's next on one line, for the island: its name is cut short
/// when the line is full, never its numbers.
struct UpNextOneLine: View {
  let state: CardState
  let p: CardPalette

  var body: some View {
    let numbers = setNumbersText(state)
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text(state.exerciseName)
        .font(.system(size: 16, weight: .heavy))
        .foregroundStyle(p.tp)
        .lineLimit(1)
      if !numbers.isEmpty {
        Text("  ·  \(numbers)")
          .font(.system(size: 16, weight: .bold))
          .foregroundStyle(p.ts)
          .lineLimit(1)
          .fixedSize()
      }
    }
  }
}

// ─── lock screen card ────────────────────────────────────────────────────────

/// The workout's line: its dot, its name, how far through, and the time.
struct CardHeader: View {
  let workoutName: String
  let state: CardState
  let p: CardPalette

  var body: some View {
    let dot = timerDot(state, p)
    let running = timerState(state) == .running
    HStack(spacing: 7) {
      Circle()
        .fill(dot)
        .frame(width: 8, height: 8)
        .shadow(color: dot.opacity(running || timerState(state) == .paused ? 0.6 : 0), radius: 3)
      Text(workoutName)
        .font(.system(size: 13, weight: .heavy))
        .foregroundStyle(p.tp)
        .lineLimit(1)
      Text(note)
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(p.ts)
        .lineLimit(1)
      Spacer(minLength: 6)
      ElapsedTimer(state: state)
        .font(.system(size: 15, weight: .heavy))
        .foregroundStyle(running ? p.tp : p.ts)
    }
    .frame(height: 18)
  }

  private var note: String {
    if timerState(state) == .paused && !state.allDone { return "· Paused" }
    guard state.totalCount > 0 else { return "" }
    return "· \(state.doneCount) of \(state.totalCount) sets"
  }
}

/// The set that's up: the exercise, its numbers big, its dots, and the tick.
/// A long name takes a second line and the card grows to hold it (about 155pt
/// at most, inside the 160pt iOS draws).
struct SetBlock: View {
  let state: CardState
  let p: CardPalette

  var body: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 1) {
        Text(state.exerciseName)
          .font(.system(size: 17, weight: .heavy))
          .foregroundStyle(p.tp)
          .lineLimit(2)
        SetNumbers(state: state, size: 32, p: p)
        HStack(spacing: 8) {
          SetDots(state: state, size: 8, p: p)
          Text(state.setLabel)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle((state.isWarmup ?? false) ? warmupOrange : p.ts)
            .lineLimit(1)
        }
        .padding(.top, 2)
      }
      Spacer(minLength: 0)
      TickButton(size: 56)
    }
  }
}

/// A rest between sets: its line counting down beside the workout's time, the
/// time left with the rest buttons, and the set that's next with its tick.
///
/// The set that's next reads on one line when it fits, as designed. When it
/// doesn't, it takes two rather than cut its numbers off ("Bench Pre…" hid the
/// weight and reps; user report, 2026-10-15), and the card's gaps close up to
/// make room, since iOS cuts a lock-screen card off at 160pt: about 154pt on
/// one line, 156pt on two. ViewThatFits takes the first layout whose width
/// fits, which only the set that's next can fail.
struct RestBlock: View {
  let state: CardState
  let p: CardPalette

  var body: some View {
    ViewThatFits(in: .horizontal) {
      RestLayout(state: state, p: p, twoLines: false)
      RestLayout(state: state, p: p, twoLines: true)
    }
  }
}

/// One of RestBlock's two layouts.
struct RestLayout: View {
  let state: CardState
  let p: CardPalette
  let twoLines: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: twoLines ? 8 : 12) {
      HStack(spacing: 10) {
        // Asks for no width of its own, so it never decides which layout fits.
        RestLine(state: state)
          .frame(minWidth: 0, idealWidth: 0, maxWidth: .infinity)
        ElapsedTimer(state: state, width: 60)
          .font(.system(size: 13, weight: .heavy))
          .foregroundStyle(p.ts)
      }
      .frame(height: 18)
      HStack(spacing: 6) {
        RestTime(state: state, size: 34, p: p)
        Spacer(minLength: 4)
        RestButtons(p: p)
      }
      .frame(height: 40)
      if !state.exerciseName.isEmpty {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: twoLines ? 2 : 3) {
            HStack(spacing: 8) {
              Text("UP NEXT")
                .font(.system(size: 11, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(p.ts)
              SetDots(state: state, size: 6, p: p)
              Text(state.setLabel)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle((state.isWarmup ?? false) ? warmupOrange : p.ts)
                .lineLimit(1)
            }
            if twoLines {
              // A custom name past the longest in the list is shortened, and
              // the middle of the last line is what gives way past that, so
              // the numbers at its end always show.
              upNextLine(state, p, maxName: upNextNameMax)
                .lineLimit(2)
                .truncationMode(.middle)
            } else {
              upNextLine(state, p).lineLimit(1)
            }
          }
          Spacer(minLength: 0)
          TickButton(size: 44)
        }
      }
    }
  }
}

/// Every set ticked: the workout is finished in the app.
struct DoneBlock: View {
  let p: CardPalette

  var body: some View {
    HStack(spacing: 14) {
      TickDisc(size: 52).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text("All sets done")
          .font(.system(size: 20, weight: .black))
          .foregroundStyle(p.tp)
        Text("Open Avenas to finish your workout")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(p.ts)
          .lineLimit(1)
          .minimumScaleFactor(0.85)
      }
      Spacer(minLength: 0)
    }
  }
}

struct LockScreenCard: View {
  let workoutName: String
  let state: CardState
  let resting: Bool

  var body: some View {
    let p = CardPalette.of(state)
    VStack(alignment: .leading, spacing: 12) {
      if state.allDone {
        CardHeader(workoutName: workoutName, state: state, p: p)
        DoneBlock(p: p)
      } else if resting {
        RestBlock(state: state, p: p)
      } else {
        CardHeader(workoutName: workoutName, state: state, p: p)
        if !state.exerciseName.isEmpty {
          SetBlock(state: state, p: p)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .fontDesign(.rounded)
    .environment(\.colorScheme, p.isDark ? .dark : .light)
  }
}

// ─── Dynamic Island ──────────────────────────────────────────────────────────

/// Top left, expanded: the set that's up, or the rest's time left.
struct IslandLeading: View {
  let state: CardState
  let resting: Bool

  var body: some View {
    let p = CardPalette.island
    Group {
      if state.allDone {
        Text("All sets done")
          .font(.system(size: 15, weight: .heavy))
          .foregroundStyle(p.tp)
      } else if resting {
        RestTime(state: state, size: 26, p: p)
      } else {
        VStack(alignment: .leading, spacing: 2) {
          Text(state.exerciseName)
            .font(.system(size: 15, weight: .heavy))
            .foregroundStyle(p.tp)
            .lineLimit(1)
          HStack(spacing: 6) {
            SetDots(state: state, size: 6, p: p)
            Text(state.setLabel)
              .font(.system(size: 11, weight: .bold))
              .foregroundStyle((state.isWarmup ?? false) ? warmupOrange : p.ts)
              .lineLimit(1)
          }
        }
      }
    }
    .padding(.leading, 6)
    .fontDesign(.rounded)
  }
}

/// Top right, expanded: the workout bar's dot and the workout's time.
struct IslandTrailing: View {
  let state: CardState

  var body: some View {
    let p = CardPalette.island
    HStack(spacing: 5) {
      Circle().fill(timerDot(state, p)).frame(width: 7, height: 7)
      ElapsedTimer(state: state, width: 64)
        .font(.system(size: 15, weight: .heavy))
        .foregroundStyle(timerState(state) == .running ? p.tp : p.ts)
    }
    .padding(.trailing, 6)
    .fontDesign(.rounded)
  }
}

/// The bottom, expanded: the numbers and the tick, or the rest's line,
/// buttons and the set that's next.
struct IslandBottom: View {
  let state: CardState
  let resting: Bool

  var body: some View {
    let p = CardPalette.island
    Group {
      if state.allDone {
        HStack(spacing: 12) {
          Text("Open Avenas to finish your workout")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(p.ts)
          Spacer(minLength: 0)
          TickDisc(size: 40)
        }
      } else if resting {
        VStack(spacing: 10) {
          RestLine(state: state)
          HStack(spacing: 6) {
            RestButtons(p: p, wide: true)
          }
          if !state.exerciseName.isEmpty {
            HStack(spacing: 12) {
              VStack(alignment: .leading, spacing: 2) {
                Text("UP NEXT · \(state.setLabel.uppercased())")
                  .font(.system(size: 11, weight: .heavy))
                  .tracking(1.2)
                  .foregroundStyle(p.ts)
                  .lineLimit(1)
                UpNextOneLine(state: state, p: p)
              }
              Spacer(minLength: 0)
              TickButton(size: 40)
            }
          }
        }
      } else if !state.exerciseName.isEmpty {
        HStack(spacing: 14) {
          SetNumbers(state: state, size: 30, p: p)
          Spacer(minLength: 0)
          TickButton(size: 52)
        }
      }
    }
    .padding(.horizontal, 6)
    .fontDesign(.rounded)
  }
}

/// Compact, left: a ring counting the rest down, else what the workout's doing.
struct IslandCompactLeading: View {
  let state: CardState
  let resting: Bool

  var body: some View {
    if resting {
      RestRing(state: state)
    } else if state.allDone {
      Image(systemName: "checkmark")
        .font(.system(size: 14, weight: .heavy))
        .foregroundStyle(avenasAccent)
    } else if timerState(state) == .paused {
      Image(systemName: "pause.fill").foregroundStyle(pausedAmber)
    } else {
      Image(systemName: "dumbbell.fill").foregroundStyle(avenasAccent)
    }
  }
}

/// Compact, right: the rest's time left in green, else the workout's time.
struct IslandCompactTrailing: View {
  let state: CardState
  let resting: Bool

  var body: some View {
    Group {
      if resting {
        Text(timerInterval: restInterval(state), countsDown: true)
          .foregroundStyle(avenasAccent)
      } else if state.startedAtMs > 0 {
        Text(msDate(state.startedAtMs), style: .timer)
          .foregroundStyle(.white)
      } else {
        Text(formatFrozenElapsed(state.pausedElapsedSec))
          .foregroundStyle(CardPalette.island.ts)
      }
    }
    .font(.system(size: 14, weight: .heavy))
    .monospacedDigit()
    .fontDesign(.rounded)
    .multilineTextAlignment(.trailing)
    .frame(maxWidth: 44)
    .minimumScaleFactor(0.8)
  }
}

struct IslandMinimal: View {
  let state: CardState
  let resting: Bool

  var body: some View {
    if resting {
      RestRing(state: state)
    } else {
      Image(systemName: state.allDone ? "checkmark" : "dumbbell.fill")
        .foregroundStyle(avenasAccent)
    }
  }
}

// ─── widget ──────────────────────────────────────────────────────────────────

@main
struct AvenasWidgets: WidgetBundle {
  var body: some Widget {
    WorkoutLiveActivity()
  }
}

struct WorkoutLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
      LockScreenCard(
        workoutName: context.attributes.workoutName,
        state: context.state,
        resting: showsRest(context))
        .activityBackgroundTint(CardPalette.of(context.state).bg)
        .activitySystemActionForegroundColor(
          CardPalette.of(context.state).isDark ? avenasAccent : avenasAccentDeep)
        .widgetURL(URL(string: "avenas://workout"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          IslandLeading(state: context.state, resting: showsRest(context))
        }
        DynamicIslandExpandedRegion(.trailing) {
          IslandTrailing(state: context.state)
        }
        DynamicIslandExpandedRegion(.bottom) {
          IslandBottom(state: context.state, resting: showsRest(context))
        }
      } compactLeading: {
        IslandCompactLeading(state: context.state, resting: showsRest(context))
      } compactTrailing: {
        IslandCompactTrailing(state: context.state, resting: showsRest(context))
      } minimal: {
        IslandMinimal(state: context.state, resting: showsRest(context))
      }
      .keylineTint(avenasAccent)
    }
  }
}
