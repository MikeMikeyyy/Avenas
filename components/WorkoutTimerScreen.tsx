// components/WorkoutTimerScreen.tsx
//
// The Workout tab's timer (the stopwatch button, top right), full screen: a
// soft dial with the aurora ring (sky into mint) for the whole time and its 60
// ticks for the minute it's in, the time big in the middle, white −15s and +15s either side of the
// main button on Timer, Reset under it, and the set the session is up to at
// the foot with a tick. User design and decisions, 2026-10-15 (the Workout
// Timer canvas, option A). It replaced a small pop-up card that knew nothing of
// the workout.
//
// What the dial shows is utils/workoutTimer.ts's dialView:
//   * the REST whenever one runs: the pop-up's and the lock screen's own
//     countdown (RestTimerContext), so no pause, Skip in the middle, Reset to
//     start it over. A tick on the card starts it exactly as the set's
//     checkbox does, and a rest takes the dial over: your own countdown, if one
//     was running, stops;
//   * your own countdown (Timer), which pauses and resets, and whose time ±15s
//     or a tap on it sets before it starts. It isn't a rest: nothing else
//     shows it;
//   * the stopwatch, its ring going round once a minute.
// A rest that runs out with this open reads "Time's up", the ring full and
// glowing. The card moves on to the next set only with a tick.
//
// Your own countdown and the stopwatch live in utils/workoutTimerStore.ts, so
// they keep going with this closed and across the tab's two layouts.

import { useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, {
  Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import AuroraBackdrop from "./AuroraBackdrop";
import BounceButton from "./BounceButton";
import GlassButton, { GlassSurface } from "./GlassButton";
import NeuCard from "./NeuCard";
import StopwatchIcon from "./StopwatchIcon";
import { WheelPicker } from "./TimeWheelPicker";
import { BACK_LEFT, BACK_SIZE, BACK_TOP } from "./BackButton";
import { useRestTimer } from "../contexts/RestTimerContext";
import { useTimerState } from "../hooks/useWorkoutTimerStore";
import { updateTimerState } from "../utils/workoutTimerStore";
import {
  ADJUST_SEC,
  adjustCountdown,
  countdownPhase,
  dialView,
  lessEndsRest,
  newStopwatch,
  nextChangeIn,
  pauseCountdown,
  pauseStopwatch,
  resetCountdown,
  restRanOut,
  ringPlan,
  setCountdownDuration,
  startCountdown,
  startStopwatch,
  wheelsFor,
  wheelsSec,
  WHEEL_MINUTES,
  WHEEL_SECONDS,
  type AdjustButton,
  type ButtonState,
  type DialArgs,
  type DialView,
  type MainAction,
  type RingMotion,
  type TimerMode,
  type UpNext,
  type WheelPlace,
} from "../utils/workoutTimer";
import {
  ACCT, APP_DARK, APP_LIGHT, BTN_SLATE, BTN_SLATE_DARK, CARD_SHADE, CUE_INK, CUE_INK_DARK, FontFamily, NEU_BG_DARK,
  TIMER_GRADIENT, WARMUP_ORANGE, accentTextColor, replacedTextColor, timerDialInk,
} from "../constants/theme";
import { darkGlow, PILL_RADIUS } from "../constants/buttons";

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

const MAIN_W = 176;
const MAIN_H = 56;
const SIDE = 54;
const RESET_H = 40;
const TICK_DISC = 54;
/** The dial's size: as wide as the screen allows, and short enough on a small
 *  phone that the buttons and the card still fit under it. */
const DIAL_MAX = 300;
const DIAL_SHARE_OF_HEIGHT = 0.36;
/** How soon after a tick the card takes another. */
const TICK_SETTLE_MS = 700;
const TIME_HIT_SLOP = { top: 12, bottom: 12, left: 16, right: 16 };
/** How far past a second turning the dial renders, so a timer firing a touch
 *  early still lands after it. */
const CLOCK_SLACK_MS = 15;
/** How long the ring takes to ease onto the clock when its run changes. */
const RING_LEAD_MS = 300;
/** The mode switch, and its pill: half of it inside the 3pt padding. */
const SWITCH_W = 208;
const SWITCH_PAD = 3;
const SWITCH_HALF = (SWITCH_W - SWITCH_PAD * 2) / 2;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Once it has gone (iOS only): a sheet asked for while it was up opens. */
  onClosed?: () => void;
  isDark: boolean;
  /** The set the session is up to (the lock screen card's next set), or null:
   *  no session, or every set ticked. */
  upNext: UpNext | null;
  /** A session with every set ticked: the card says so, with no tick. */
  allDone: boolean;
  /** Ticks `upNext` as its own checkbox would, starting its rest. */
  onTick: () => void;
};

export default function WorkoutTimerScreen({ visible, onClose, onClosed, isDark, upNext, allDone, onTick }: Props) {
  const { restBannerActive } = useRestTimer();
  const { countdown } = useTimerState();

  // Your countdown's end: a buzz as it gets there, open or not.
  useEffect(() => {
    if (countdown.endsAt === null) return;
    const ms = countdown.endsAt - Date.now();
    if (ms <= 0) return;
    const id = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, ms);
    return () => clearTimeout(id);
  }, [countdown.endsAt]);

  // A rest starting takes the dial over, open or not: your own countdown, if
  // one was going, stops, so it can't go off in the middle of the rest.
  const restWasActive = useRef(restBannerActive);
  useEffect(() => {
    if (restBannerActive && !restWasActive.current) {
      updateTimerState(s => (countdownPhase(s.countdown, Date.now()) === "ready" ? s : { ...s, countdown: resetCountdown(s.countdown) }));
    }
    restWasActive.current = restBannerActive;
  }, [restBannerActive]);

  // What's on it is drawn only while it shows (a Modal's content mounts as it
  // opens and goes as it closes), so its clock starts on the moment it opens,
  // and a Time's up or a half-typed time doesn't wait there for next time.
  return (
    <Modal visible={visible} transparent presentationStyle="overFullScreen" statusBarTranslucent animationType="slide" onRequestClose={onClose} onDismiss={onClosed}>
      <TimerBody onClose={onClose} isDark={isDark} upNext={upNext} allDone={allDone} onTick={onTick} />
    </Modal>
  );
}

function TimerBody({ onClose, isDark, upNext, allDone, onTick }: Omit<Props, "visible" | "onClosed">) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { restBannerActive, restTotal, restEndsAt, startRestTimer, adjustRestTimer, dismissRestTimer } = useRestTimer();
  const { mode, countdown, stopwatch } = useTimerState();
  // Setting your countdown's time: a tap on it before it starts turns it into
  // two wheels, which set it as they settle. `editFrom` is where they start;
  // the ref is where they are.
  const [editing, setEditing] = useState(false);
  const [editFrom, setEditFrom] = useState<WheelPlace>({ min: 1, sec: 0 });
  const wheelsAt = useRef<WheelPlace>({ min: 1, sec: 0 });

  // The clock the dial reads: from the moment it opens, then just past each
  // second turning while something on it moves (nextChangeIn), so the time
  // and its ticks change on the second. A press sets it too, so what the
  // press starts reads right at once; it used to look four times a second,
  // and ran up to a quarter of a second behind (user report, 2026-10-15).
  const [now, setNow] = useState(() => Date.now());
  // Coming back to the app puts the ring's run back on the clock (a run left
  // part way through a sequence would carry on from where it stopped).
  const [syncAt, setSyncAt] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => {
      if (s !== "active") return;
      const at = Date.now();
      setNow(at);
      setSyncAt(at);
    });
    return () => sub.remove();
  }, []);

  // Opened while a rest runs (from the pop-up, or after a tick on the Workout
  // page): straight to it. Only as it opens: a switch to the stopwatch
  // mid-rest stays put. A keyboard left up on the page goes.
  useEffect(() => {
    Keyboard.dismiss();
    if (restBannerActive) updateTimerState(s => (s.mode === "timer" ? s : { ...s, mode: "timer" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rest that runs out with this open reads Time's up, until anything else
  // is pressed or another rest starts; a Skip, or the workout ending, takes it
  // away without.
  const [restOver, setRestOver] = useState(false);
  const watchedEnd = useRef<number | null>(restBannerActive ? restEndsAt : null);
  useEffect(() => {
    if (restBannerActive) {
      if (watchedEnd.current === null) setRestOver(false);
      watchedEnd.current = restEndsAt;
      return;
    }
    const end = watchedEnd.current;
    watchedEnd.current = null;
    if (restRanOut(end, Date.now())) {
      setRestOver(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [restBannerActive, restEndsAt]);

  const dialArgs: DialArgs = {
    mode,
    rest: { active: restBannerActive, endsAt: restEndsAt, totalSec: restTotal },
    restOver,
    countdown,
    stopwatch,
    now,
  };
  const view = dialView(dialArgs);

  // The next render: just past the moment the time this render shows next
  // changes. Aimed at that moment, not a wait from now, so the renders in
  // between (the rest timer's, twice a second) re-arm it for the same moment,
  // and a render that's already past it catches up at once.
  useEffect(() => {
    const due = nextChangeIn(dialArgs);
    if (due === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, now + due + CLOCK_SLACK_MS - Date.now()));
    return () => clearTimeout(id);
  });

  const beginEdit = () => {
    const place = wheelsFor(countdown.durationSec);
    wheelsAt.current = place;
    setEditFrom(place);
    setEditing(true);
  };
  // A wheel settling sets the time; 00:00 stands for the shortest, 5 seconds.
  const onWheel = (part: keyof WheelPlace, index: number) => {
    wheelsAt.current = { ...wheelsAt.current, [part]: index };
    const sec = wheelsSec(wheelsAt.current);
    updateTimerState(s => (countdownPhase(s.countdown, Date.now()) === "ready"
      ? { ...s, countdown: setCountdownDuration(s.countdown, sec) }
      : s));
  };
  // The wheels go once anything else on the dial is pressed, as well as Done.
  const endEdit = () => setEditing(false);

  const onMain = (action: MainAction) => {
    const at = Date.now();
    endEdit();
    setNow(at);
    setRestOver(false);
    if (action === "skip") { dismissRestTimer(); return; }
    if (action === "restart") {
      if (view.source === "rest") startRestTimer(restTotal);
      else updateTimerState(s => ({ ...s, countdown: startCountdown(resetCountdown(s.countdown), at) }));
      return;
    }
    if (mode === "stopwatch") {
      updateTimerState(s => ({
        ...s,
        stopwatch: action === "pause" ? pauseStopwatch(s.stopwatch, at) : startStopwatch(s.stopwatch, at),
      }));
      return;
    }
    updateTimerState(s => ({
      ...s,
      countdown: action === "pause" ? pauseCountdown(s.countdown, at) : startCountdown(s.countdown, at),
    }));
  };

  // −15s / +15s. A rest's end moves (−15s with that or less left ends it,
  // which reads as it running out would); once a rest has run out, +15s is 15
  // seconds more of it; your countdown follows adjustCountdown.
  const onAdjust = (button: AdjustButton) => {
    const at = Date.now();
    const delta = button === "less" ? -ADJUST_SEC : ADJUST_SEC;
    endEdit();
    setNow(at);
    if (view.source === "rest" && restBannerActive) {
      setRestOver(button === "less" && lessEndsRest(restEndsAt, at));
      adjustRestTimer(delta);
      return;
    }
    setRestOver(false);
    if (view.source === "rest") {
      if (delta > 0) startRestTimer(ADJUST_SEC);
      return;
    }
    updateTimerState(s => ({ ...s, countdown: adjustCountdown(s.countdown, delta, at) }));
  };

  // Reset: the stopwatch to 00:00, stopped; your countdown back to its whole
  // time, ready; a rest over again from its full length (a rest never stops,
  // so it runs on); a rest's Time's up back to your countdown.
  const onReset = () => {
    setNow(Date.now());
    setRestOver(false);
    if (view.source === "stopwatch") {
      updateTimerState(s => ({ ...s, stopwatch: newStopwatch() }));
      return;
    }
    if (view.source === "rest") {
      if (restBannerActive) startRestTimer(restTotal);
      return;
    }
    updateTimerState(s => ({ ...s, countdown: resetCountdown(s.countdown) }));
  };
  const resetSpoken = view.source === "stopwatch"
    ? "Reset the stopwatch"
    : view.source === "rest" && restBannerActive ? "Start the rest over" : "Reset the timer";

  const switchMode = (next: TimerMode) => {
    setNow(Date.now());
    setRestOver(false);
    endEdit();
    updateTimerState(s => (s.mode === next ? s : { ...s, mode: next }));
  };

  // A tick here is a tick of the set, and its rest is what the dial shows next.
  // The card moves on to the next set under your finger, so a second tap
  // straight after (a double tap) isn't taken as ticking that one too.
  const lastTickAt = useRef(0);
  const tick = () => {
    const at = Date.now();
    if (at - lastTickAt.current < TICK_SETTLE_MS) return;
    lastTickAt.current = at;
    setNow(at);
    setRestOver(false);
    endEdit();
    updateTimerState(s => (s.mode === "timer" ? s : { ...s, mode: "timer" }));
    onTick();
  };

  const dialSize = Math.min(DIAL_MAX, width - 90, Math.round(height * DIAL_SHARE_OF_HEIGHT));
  const showCard = !!upNext || allDone;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <AuroraBackdrop dark={isDark} tint="aqua" />

      <View style={[styles.header, { paddingTop: insets.top + BACK_TOP }]}>
        <GlassButton onPress={onClose} size={BACK_SIZE} accessibilityLabel="Close the timer">
          <Ionicons name="close" size={20} color={t.tp} />
        </GlassButton>
        <View style={[styles.switchHolder, { top: insets.top + BACK_TOP }]} pointerEvents="box-none">
          <ModeSwitch mode={mode} onChange={switchMode} isDark={isDark} />
        </View>
      </View>

      <View style={styles.middle}>
        <Dial
          size={dialSize}
          view={view}
          isDark={isDark}
          syncAt={syncAt}
          editing={editing}
          editFrom={editFrom}
          onWheel={onWheel}
          onEdit={beginEdit}
          onDone={endEdit}
        />
        <View style={styles.buttons}>
          <View style={styles.controls}>
            <AdjustButtonView button="less" state={view.less} isDark={isDark} onPress={onAdjust} />
            <MainButton action={view.main} isDark={isDark} onPress={onMain} />
            <AdjustButtonView button="more" state={view.more} isDark={isDark} onPress={onAdjust} />
          </View>
          <ResetButton enabled={view.reset === "on"} spoken={resetSpoken} isDark={isDark} onPress={onReset} />
        </View>
      </View>

      {showCard ? (
        <ExerciseCard
          upNext={upNext}
          allDone={allDone}
          resting={restBannerActive}
          isDark={isDark}
          bottomInset={insets.bottom}
          onTick={tick}
        />
      ) : null}
    </View>
  );
}

// ─── Timer / Stopwatch ───────────────────────────────────────────────────────

/** The two modes, its green pill sliding between them as it always has, on a
 *  glass track on iOS 26 (components/GlassButton.tsx) beside the glass ✕. */
function ModeSwitch({ mode, onChange, isDark }: { mode: TimerMode; onChange: (m: TimerMode) => void; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const at = useSharedValue(mode === "timer" ? 0 : 1);
  useEffect(() => {
    at.value = withSpring(mode === "timer" ? 0 : 1, { damping: 22, stiffness: 300, mass: 0.9 });
  }, [mode, at]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: at.value * SWITCH_HALF }] }));
  return (
    <GlassSurface style={styles.switchTrack} solidStyle={{ backgroundColor: t.div }}>
      <Reanimated.View style={[styles.switchPill, darkGlow(styles.switchPill, isDark), pill]} />
      {(["timer", "stopwatch"] as const).map(m => (
        <Pressable
          key={m}
          style={styles.switchTab}
          onPress={() => { if (m !== mode) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(m); } }}
          accessibilityRole="button"
          accessibilityState={{ selected: m === mode }}
        >
          <Text style={[styles.switchText, { color: m === mode ? "#FFFFFF" : t.ts }]}>
            {m === "timer" ? "Timer" : "Stopwatch"}
          </Text>
        </Pressable>
      ))}
    </GlassSurface>
  );
}

// ─── The dial ────────────────────────────────────────────────────────────────

function Dial({
  size, view, isDark, syncAt, editing, editFrom, onWheel, onEdit, onDone,
}: {
  size: number;
  view: DialView;
  isDark: boolean;
  /** When the app last came back to the front: the ring's run starts again from the clock. */
  syncAt: number;
  editing: boolean;
  editFrom: WheelPlace;
  onWheel: (part: keyof WheelPlace, index: number) => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const ink = timerDialInk(isDark);
  const disc = Math.round(size * 0.733);
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;

  // The ring runs with the clock on the UI thread (ringPlan): eased onto the
  // clock when its run changes (a start, a pause, ±15s, a new rest), then
  // exactly with it, the stopwatch's going on round once a minute. It tells
  // the time, so it keeps moving under Reduce Motion; only the lead-in may
  // jump there.
  const progress = useSharedValue(view.fraction);
  const ringKey = JSON.stringify(view.ring);
  useEffect(() => {
    const { steps, repeatMinute } = ringPlan(JSON.parse(ringKey) as RingMotion, progress.value, Date.now(), RING_LEAD_MS);
    const runs = steps.map(step => withTiming(step.to, {
      duration: step.ms,
      easing: step.steady ? Easing.linear : Easing.out(Easing.cubic),
      reduceMotion: step.steady ? ReduceMotion.Never : ReduceMotion.System,
    }));
    if (repeatMinute) {
      runs.push(withRepeat(withSequence(
        withTiming(0, { duration: 0, reduceMotion: ReduceMotion.Never }),
        withTiming(1, { duration: 60_000, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      ), -1));
    }
    progress.value = runs.length === 1 ? runs[0] : withSequence(runs[0], ...runs.slice(1));
  }, [ringKey, syncAt, progress]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - progress.value) }));

  // The wheels, sized and rounded to sit inside the ring of ticks, where
  // their fades can't cover any.
  const rowH = Math.round(disc * 0.17);
  const wheelW = Math.round(rowH * 1.45);
  const wheelText = [styles.wheelText, { fontSize: Math.round(rowH * 0.7), color: t.tp }];

  // The ticks round the disc: a minute clock, lit to the seconds shown, while
  // the ring is the whole time (dialView's litTicks).
  const half = disc / 2;
  const outer = half - Math.round(disc * 0.04);
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const inner = outer - (major ? disc * 0.06 : disc * 0.036);
    return {
      key: i,
      x1: half + Math.cos(a) * inner, y1: half + Math.sin(a) * inner,
      x2: half + Math.cos(a) * outer, y2: half + Math.sin(a) * outer,
      w: major ? 2 : 1.5,
      color: i < view.litTicks ? ink.tickOn : ink.tickOff,
    };
  });

  const labelColor = view.tone === "paused"
    ? replacedTextColor(isDark)
    : view.tone === "done" ? accentTextColor(isDark) : isDark ? CUE_INK_DARK : CUE_INK;

  return (
    <View style={{ width: size, height: size }}>
      <NeuCard dark={isDark} variant="inset" bg={t.bg} radius={size / 2} fill style={{ width: size, height: size }} />
      {/* Its own layer for the glow: a shadow on a view with no fill follows
          what it draws, so only the ring glows. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.ringGlow, { shadowOpacity: view.glow ? 0.85 : isDark ? 0.4 : 0.5, shadowRadius: view.glow ? 12 : 6 }]}
      >
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="timerRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={TIMER_GRADIENT[0]} />
              <Stop offset="1" stopColor={TIMER_GRADIENT[1]} />
            </LinearGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={ink.track} strokeWidth={12} fill="none" />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="url(#timerRing)"
            strokeWidth={12}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[circ, circ]}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
            animatedProps={ringProps}
          />
        </Svg>
      </View>

      <NeuCard
        dark={isDark}
        radius={disc / 2}
        fill
        style={{ position: "absolute", left: (size - disc) / 2, top: (size - disc) / 2, width: disc, height: disc }}
      >
        <Svg width={disc} height={disc} style={StyleSheet.absoluteFill} pointerEvents="none">
          {ticks.map(k => (
            <Line key={k.key} x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} stroke={k.color} strokeWidth={k.w} strokeLinecap="round" />
          ))}
        </Svg>
        {editing ? (
          // Minutes and seconds as wheels in place of the time, one band
          // behind both for the time being set, and Done under them. They
          // replaced two typed boxes and a small tick (user request,
          // 2026-10-15).
          <View style={styles.dialCenter}>
            <View style={[styles.wheelRow, { height: rowH * 3, borderRadius: Math.round(rowH * 0.8) }]}>
              <View pointerEvents="none" style={[styles.wheelBand, { top: rowH, height: rowH, borderRadius: rowH / 2, backgroundColor: t.div }]} />
              <WheelPicker
                items={WHEEL_MINUTES}
                initialIdx={editFrom.min}
                onSelect={index => onWheel("min", index)}
                isDark={isDark}
                width={wheelW}
                rowH={rowH}
                textStyle={wheelText}
                band={false}
              />
              <Text style={[styles.wheelColon, { fontSize: Math.round(rowH * 0.62), color: t.tp }]}>:</Text>
              <WheelPicker
                items={WHEEL_SECONDS}
                initialIdx={editFrom.sec}
                onSelect={index => onWheel("sec", index)}
                isDark={isDark}
                width={wheelW}
                rowH={rowH}
                textStyle={wheelText}
                band={false}
              />
            </View>
            <BounceButton onPress={onDone} accessibilityRole="button" accessibilityLabel="Done setting the time">
              <View style={[styles.doneChip, darkGlow(styles.doneChip, isDark)]}>
                <Text style={styles.doneText}>Done</Text>
              </View>
            </BounceButton>
          </View>
        ) : (
          <View style={styles.dialCenter}>
            <View style={[styles.iconChip, { backgroundColor: isDark ? t.ctrl : APP_LIGHT.ctrl }]}>
              <StopwatchIcon size={18} color={t.tp} />
            </View>
            {/* The time and the "Tap to edit" under it are one target. */}
            <Pressable
              style={styles.timeTap}
              hitSlop={TIME_HIT_SLOP}
              disabled={!view.editable}
              onPress={onEdit}
              accessibilityRole={view.editable ? "button" : undefined}
              accessibilityLabel={view.editable ? `${view.time}, tap to set the time` : `${view.time}, ${view.label}`}
            >
              <Text style={[styles.time, { color: t.tp }]}>{view.time}</Text>
              <Text style={[styles.label, { color: labelColor }]}>{view.label}</Text>
            </Pressable>
          </View>
        )}
      </NeuCard>
    </View>
  );
}

// ─── The buttons ─────────────────────────────────────────────────────────────

/** A soft white button (the dark card's colour in dark mode), sized by what's
 *  inside it: a NeuCard told to `fill` takes flex: 1, which collapses to
 *  nothing inside a button that sizes to its content, and that's how the
 *  first build's ±15s and Reset came out invisible. Dimmed, and not a button,
 *  while it has nothing to do. */
function SoftButton({
  enabled, spoken, radius, isDark, onPress, children,
}: {
  enabled: boolean;
  spoken: string;
  radius: number;
  isDark: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const face = (
    <NeuCard dark={isDark} radius={radius} bg={isDark ? NEU_BG_DARK : APP_LIGHT.ctrl} shadowSize="sm">
      {children}
    </NeuCard>
  );
  if (!enabled) {
    return (
      <View style={styles.idle} accessible accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ disabled: true }}>
        {face}
      </View>
    );
  }
  return <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken}>{face}</BounceButton>;
}

/** −15s or +15s either side of the main button; an empty place on the
 *  stopwatch, so the main button stays centred. */
function AdjustButtonView({ button, state, isDark, onPress }: { button: AdjustButton; state: ButtonState; isDark: boolean; onPress: (b: AdjustButton) => void }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (!state) return <View style={styles.sideSpace} />;
  return (
    <SoftButton
      enabled={state === "on"}
      spoken={button === "less" ? "15 seconds less" : "15 seconds more"}
      radius={SIDE / 2}
      isDark={isDark}
      onPress={() => onPress(button)}
    >
      <View style={styles.sideFace}>
        <Text style={[styles.sideText, { color: t.tp }]}>{button === "less" ? "−15s" : "+15s"}</Text>
      </View>
    </SoftButton>
  );
}

/** Reset, under the main button on both modes. */
function ResetButton({ enabled, spoken, isDark, onPress }: { enabled: boolean; spoken: string; isDark: boolean; onPress: () => void }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <SoftButton enabled={enabled} spoken={spoken} radius={RESET_H / 2} isDark={isDark} onPress={onPress}>
      <View style={styles.resetFace}>
        <Ionicons name="refresh" size={16} color={t.tp} />
        <Text style={[styles.resetText, { color: t.tp }]}>Reset</Text>
      </View>
    </SoftButton>
  );
}

const MAIN_COPY: Record<MainAction, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  start: { label: "Start", icon: "play" },
  pause: { label: "Pause", icon: "pause" },
  resume: { label: "Resume", icon: "play" },
  skip: { label: "Skip", icon: "play-skip-forward" },
  restart: { label: "Restart", icon: "refresh" },
};

/** The slate button, the app's Complete Workout one. */
function MainButton({ action, isDark, onPress }: { action: MainAction; isDark: boolean; onPress: (a: MainAction) => void }) {
  const ink = isDark ? APP_DARK.bg : "#FFFFFF";
  const { label, icon } = MAIN_COPY[action];
  return (
    <BounceButton onPress={() => onPress(action)} accessibilityRole="button" accessibilityLabel={action === "skip" ? "Skip the rest" : label}>
      {/* The fill on a view of its own: BounceButton puts a width and height
          on its touch area, not on what it paints. */}
      <View style={[styles.main, { backgroundColor: isDark ? BTN_SLATE_DARK : BTN_SLATE }, !isDark && styles.mainShadow]}>
        <Ionicons name={icon} size={19} color={ink} />
        <Text style={[styles.mainText, { color: ink }]}>{label}</Text>
      </View>
    </BounceButton>
  );
}

// ─── The set the session is up to ────────────────────────────────────────────

function ExerciseCard({
  upNext, allDone, resting, isDark, bottomInset, onTick,
}: {
  upNext: UpNext | null;
  allDone: boolean;
  resting: boolean;
  isDark: boolean;
  bottomInset: number;
  onTick: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const quiet = isDark ? CUE_INK_DARK : CUE_INK;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: isDark ? NEU_BG_DARK : APP_LIGHT.ctrl, paddingBottom: bottomInset + 20 },
        isDark ? styles.cardShadowDark : styles.cardShadowLight,
      ]}
    >
      {!upNext ? (
        allDone ? (
          <View style={styles.doneRow}>
            <View style={[styles.tickDisc, darkGlow(styles.tickDisc, isDark)]}>
              <Ionicons name="checkmark" size={26} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardName, { color: t.tp }]}>All sets done</Text>
              <Text style={[styles.cardSub, { color: quiet }]}>{"Finish your workout when you're ready."}</Text>
            </View>
          </View>
        ) : null
      ) : (
        <>
          <View style={styles.cardTop}>
            <View style={[styles.chip, { borderColor: ACCT }]}>
              <Text style={[styles.chipText, { color: accentTextColor(isDark) }]}>Exercise {upNext.exerciseNumber}</Text>
              <Text style={[styles.chipOf, { color: quiet }]}>/ {upNext.exerciseCount}</Text>
            </View>
            {resting ? <Text style={[styles.eyebrow, { color: quiet }]}>UP NEXT</Text> : null}
          </View>
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardName, { color: t.tp }]} numberOfLines={2}>{upNext.exerciseName}</Text>
              <View style={styles.setRow}>
                {(() => {
                  // As the lock screen card draws them: the warmups in orange,
                  // a little apart, then the working sets in green; past 11 in
                  // all the warmups give way, past 12 working sets there are none.
                  const working = upNext.setDone;
                  const warmups = upNext.warmupDone.length + working.length <= 11 ? upNext.warmupDone : [];
                  if ((!warmups.length && !working.length) || working.length > 12) return null;
                  const dot = (done: boolean, now: boolean, color: string, key: string) => (
                    <View
                      key={key}
                      style={[
                        styles.dot,
                        done
                          ? { backgroundColor: color, borderColor: color }
                          : now
                            ? [{ borderColor: color }, styles.dotNow, { shadowColor: color }]
                            : { borderColor: isDark ? t.div : APP_LIGHT.div },
                      ]}
                    />
                  );
                  return (
                    <View style={styles.dots}>
                      {warmups.map((done, i) => dot(done, upNext.isWarmup && i === upNext.setIdx, WARMUP_ORANGE, `w${i}`))}
                      {warmups.length && working.length ? <View style={styles.dotsGap} /> : null}
                      {working.map((done, i) => dot(done, i === upNext.dot, ACCT, `s${i}`))}
                    </View>
                  );
                })()}
                <Text style={[styles.setLabel, { color: quiet }]}>{upNext.setLabel}</Text>
                {upNext.numbers ? (
                  <>
                    <Text style={[styles.setLabel, { color: quiet }]}>·</Text>
                    <Text style={[styles.numbers, { color: t.tp }]}>{upNext.numbers}</Text>
                  </>
                ) : null}
              </View>
            </View>
            <BounceButton onPress={onTick} accessibilityRole="button" accessibilityLabel={`Complete ${upNext.exerciseName}, ${upNext.setLabel}`}>
              <View style={[styles.tickDisc, darkGlow(styles.tickDisc, isDark)]}>
                <Ionicons name="checkmark" size={26} color="#FFFFFF" />
              </View>
            </BounceButton>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: BACK_LEFT },
  switchHolder: { position: "absolute", left: 0, right: 0, height: BACK_SIZE, alignItems: "center", justifyContent: "center" },
  // Exactly half its height rather than PILL_RADIUS: on iOS 26 the glass draws
  // its own corners from this number.
  switchTrack: { width: SWITCH_W, height: BACK_SIZE, borderRadius: BACK_SIZE / 2, padding: SWITCH_PAD, flexDirection: "row" },
  switchPill: {
    position: "absolute", top: SWITCH_PAD, left: SWITCH_PAD, bottom: SWITCH_PAD, width: SWITCH_HALF,
    borderRadius: PILL_RADIUS, backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
  switchTab: { flex: 1, alignItems: "center", justifyContent: "center" },
  switchText: { fontFamily: FontFamily.bold, fontSize: 14 },

  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: 30 },
  ringGlow: { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 } },
  dialCenter: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 2 },
  iconChip: {
    width: 34, height: 34, borderRadius: 17, marginBottom: 2, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,
  },
  time: { fontFamily: FontFamily.bold, fontSize: 50, lineHeight: 60, letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  wheelRow: { flexDirection: "row", alignItems: "center", marginBottom: 4, overflow: "hidden" },
  wheelBand: { position: "absolute", left: 0, right: 0 },
  wheelText: { fontFamily: FontFamily.bold, fontVariant: ["tabular-nums"] },
  wheelColon: { fontFamily: FontFamily.bold, marginTop: -3 },
  doneChip: {
    height: 28, paddingHorizontal: 18, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.45, shadowRadius: 6,
  },
  doneText: { fontFamily: FontFamily.bold, fontSize: 13, color: "#FFFFFF" },

  buttons: { alignItems: "center", gap: 16 },
  controls: { flexDirection: "row", alignItems: "center", gap: 18 },
  // A NeuCard's clip layer draws a 1pt edge, so a face 2pt under the size.
  sideSpace: { width: SIDE, height: SIDE },
  sideFace: { width: SIDE - 2, height: SIDE - 2, alignItems: "center", justifyContent: "center" },
  sideText: { fontFamily: FontFamily.bold, fontSize: 13 },
  resetFace: { height: RESET_H - 2, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 6 },
  resetText: { fontFamily: FontFamily.bold, fontSize: 14 },
  idle: { opacity: 0.4 },
  timeTap: { alignItems: "center", gap: 2 },
  main: { width: MAIN_W, height: MAIN_H, borderRadius: MAIN_H / 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  mainShadow: { shadowColor: BTN_SLATE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10 },
  mainText: { fontFamily: FontFamily.bold, fontSize: 17 },

  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 22, paddingHorizontal: 24, gap: 12 },
  cardShadowLight: { shadowColor: CARD_SHADE, shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.3, shadowRadius: 16 },
  cardShadowDark: { shadowColor: "#000", shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.35, shadowRadius: 16 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: { flexDirection: "row", alignItems: "baseline", gap: 5, paddingHorizontal: 13, paddingVertical: 5, borderRadius: PILL_RADIUS, borderWidth: 1.5 },
  chipText: { fontFamily: FontFamily.bold, fontSize: 13 },
  chipOf: { fontFamily: FontFamily.semibold, fontSize: 13 },
  eyebrow: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 1.2 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  cardName: { fontFamily: FontFamily.bold, fontSize: 24, lineHeight: 30 },
  cardSub: { fontFamily: FontFamily.semibold, fontSize: 14, marginTop: 4 },
  setRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9, marginTop: 8 },
  dots: { flexDirection: "row", gap: 5 },
  // A little more room between the warmups and the working sets.
  dotsGap: { width: 3 },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  dotNow: { shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 3 },
  setLabel: { fontFamily: FontFamily.semibold, fontSize: 14 },
  numbers: { fontFamily: FontFamily.bold, fontSize: 15 },
  tickDisc: {
    width: TICK_DISC, height: TICK_DISC, borderRadius: TICK_DISC / 2, alignItems: "center", justifyContent: "center", backgroundColor: ACCT,
    shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 16 },
});
