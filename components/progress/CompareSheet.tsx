// components/progress/CompareSheet.tsx
//
// The Progress page's compare sheet. A comparison starts in two picks (user
// request, 2026-10-16): "Compare", the first program, which shows in green
// (the one on the go, or a finished one), then "Compare with", the one it's
// set beside, in blue (FINISHED programs only, the user's rule), with Back to
// the first. With only one program that can be green, it opens on the second.
// While comparing, each row of the compare header opens it for its own side.
// Each run is a SheetPill with its status, length and workouts; a program run
// more than once lists each run ("Push Pull Legs, 1st run"). One sheet for
// every step, so the page never has two up at once, and a step moves on in
// place rather than sliding away and back. While there's nothing to compare it
// opens locked: a small chart of what comparing looks like and the two steps
// comparing needs (user request, 2026-10-15, in place of hiding the button). A drag down on
// its top closes it, the locked card's being all of it but Close (user
// request, 2026-10-16).

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableWithoutFeedback, ScrollView, Animated, Easing, PanResponder } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SheetPill from "../SheetPill";
import { SHEET_DIM, SHEET_TOP_ROW, SheetCloseButton, SheetGlass, sheetFootGap, sheetSurface } from "../SheetChrome";
import { Ionicons } from "@expo/vector-icons";
import { ACCT, APP_DARK, APP_LIGHT, CUE_INK, CUE_INK_DARK, FontFamily, accentTextColor, compareBlue } from "../../constants/theme";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { useTheme } from "../../contexts/ThemeContext";
import { runDates, runName, runStatus, runSummary } from "../../utils/programCompare";
import { sameRun, type ProgramRunView, type RunRef } from "../../utils/programRuns";

/** "first": a comparison's first pick, green; "blue": the one it's compared
 *  with, or blue changed while comparing; "green": green changed while
 *  comparing. */
export type CompareSheetSide = "first" | "green" | "blue";

interface Props {
  /** Which step is up; null closes the sheet. */
  side: CompareSheetSide | null;
  options: ProgramRunView[];
  /** The run that side shows now, ticked. */
  selected: RunRef | null;
  /** The other side, named under the title. */
  other: ProgramRunView | null;
  todayYMD: string;
  /** Set while there's nothing to compare: the sheet opens as a preview, its
   *  programs drawn as empty rows, with what comparing needs and which of it is
   *  done (compareReadiness). Nothing can be picked. */
  locked: Readiness | null;
  /** A trainer's view of a client: the sheet speaks of "their" programs. */
  forClient: boolean;
  /** A pick. On "first" the sheet stays up for the second pick. */
  onPick: (ref: RunRef) => void;
  /** Back from the second pick to the first, offered when the first was made. */
  onBack: () => void;
  onClose: () => void;
}

type Readiness = { finished: boolean; another: boolean };

function Marker({ side, isDark }: { side: "green" | "blue"; isDark: boolean }) {
  return side === "green"
    ? <View style={[styles.dot, { backgroundColor: ACCT }]} />
    : <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />;
}

// The preview's chart, in its own points: six sessions across, the lift up.
// The program on the go climbs (green), a finished one more slowly (blue).
const PREVIEW_W = 300;
const PREVIEW_H = 92;
const PREVIEW_X = [14, 68, 122, 176, 230, 286];
const PREVIEW_GREEN = [64, 56, 48, 38, 30, 18];
const PREVIEW_BLUE = [76, 72, 68, 63, 60, 55];
const PREVIEW_R = 4.5;
const PREVIEW_GRID = [10, 46, 86];

/** What comparing looks like, drawn small with no numbers: the program on the
 *  go in green with dots beside a finished one in blue with rings, session by
 *  session, as the Compare page draws them (user report, 2026-11-05: the empty
 *  dashed rows it replaced were in t.div, which vanishes on the glass sheet,
 *  so all that showed was two blue rings). Glass has no colour to fill a ring
 *  with, so the blue line stops short of each ring rather than run through. */
function PreviewChart({ isDark }: { isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const blue = compareBlue(isDark);
  const gap = PREVIEW_R + 2;
  const blueSegments = PREVIEW_X.slice(1).map((x2, i) => {
    const x1 = PREVIEW_X[i];
    const y1 = PREVIEW_BLUE[i];
    const y2 = PREVIEW_BLUE[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    return { x1: x1 + ux * gap, y1: y1 + uy * gap, x2: x2 - ux * gap, y2: y2 - uy * gap };
  });
  return (
    <Svg width={PREVIEW_W} height={PREVIEW_H}>
      {PREVIEW_GRID.map(y => <Line key={y} x1={0} y1={y} x2={PREVIEW_W} y2={y} stroke={t.sheetLine} strokeWidth={1} />)}
      {blueSegments.map((s, i) => <Line key={`b${i}`} {...s} stroke={blue} strokeWidth={2.5} strokeLinecap="round" />)}
      {PREVIEW_X.map((x, i) => <Circle key={`r${i}`} cx={x} cy={PREVIEW_BLUE[i]} r={PREVIEW_R} fill="none" stroke={blue} strokeWidth={2} />)}
      <Polyline
        points={PREVIEW_X.map((x, i) => `${x},${PREVIEW_GREEN[i]}`).join(" ")}
        fill="none" stroke={ACCT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
      />
      {PREVIEW_X.map((x, i) => <Circle key={`d${i}`} cx={x} cy={PREVIEW_GREEN[i]} r={PREVIEW_R} fill={ACCT} />)}
    </Svg>
  );
}

/** What comparing looks like (PreviewChart, with its key), so the sheet shows
 *  what it's for, then the two steps comparing needs, each ticked once done. */
function LockedPreview({ readiness, forClient }: { readiness: Readiness; forClient: boolean }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const cue = isDark ? CUE_INK_DARK : CUE_INK;
  const steps = [
    {
      label: "Finish a program",
      sub: forClient ? "Marked complete in their My Programs" : "Mark it complete in My Programs",
      done: readiness.finished,
    },
    {
      label: "Start another program",
      sub: forClient ? "Their next one, or the same one again" : "Your next one, or the same one again",
      done: readiness.another,
    },
  ];
  return (
    <View>
      <Text style={[styles.other, styles.intro, { color: t.ts }]}>
        {forClient
          ? "Compare two of their programs week by week and lift by lift: the one they're on beside one they've finished, or two they've finished."
          : "Compare two programs week by week and lift by lift: the one you're on beside one you've finished, or two you've finished."}
      </Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <Marker side="green" isDark={isDark} />
            <Text style={[styles.legendText, { color: t.ts }]}>{forClient ? "Their current program" : "Your current program"}</Text>
          </View>
          <View style={styles.legendItem}>
            <Marker side="blue" isDark={isDark} />
            <Text style={[styles.legendText, { color: t.ts }]}>{forClient ? "One they've finished" : "One you've finished"}</Text>
          </View>
        </View>
        <View style={styles.preview}>
          <PreviewChart isDark={isDark} />
          <View style={styles.previewAxis}>
            <Text style={[styles.previewAxisText, { color: t.ts }]}>Session 1</Text>
            <Text style={[styles.previewAxisText, { color: t.ts }]}>Session 6</Text>
          </View>
        </View>
      </View>
      <Text style={[styles.stepsHead, { color: t.tp }]}>To compare programs</Text>
      {steps.map((s, i) => (
        <View
          key={s.label}
          style={styles.step}
          accessible
          accessibilityLabel={`${s.label}, ${s.done ? "done" : s.sub}`}
        >
          {s.done ? (
            <View style={[styles.stepMark, { backgroundColor: ACCT, borderColor: ACCT }]}>
              <Ionicons name="checkmark" size={15} color="#fff" />
            </View>
          ) : (
            <View style={[styles.stepMark, { borderColor: cue }]}>
              <Text style={[styles.stepNum, { color: cue }]}>{i + 1}</Text>
            </View>
          )}
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.stepLabel, { color: s.done ? t.ts : t.tp }]}>{s.label}</Text>
            <Text style={[styles.stepSub, { color: s.done ? accentTextColor(isDark) : t.ts }]}>{s.done ? "Done" : s.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function CompareSheet({ side, options, selected, other, todayYMD, locked, forClient, onPick, onBack, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  // The step it's on, whether it opened locked, and whether the first pick was
  // made in it (so the second offers Back), all kept through the slide-out.
  const [shown, setShown] = useState<CompareSheetSide>("blue");
  const [shownLocked, setShownLocked] = useState<Readiness | null>(null);
  const [madeFirst, setMadeFirst] = useState(false);
  // Up or on its way up: a new step while it is moves on in place.
  const open = useRef(false);
  const slideY = useRef(new Animated.Value(600)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  // Read as it opens, never a reason to open it again.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Read as a drag lets go, never a reason to rebuild the drag.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // The top of the card follows a finger down, as every sheet's handle does
  // (components/trainer/SimpleSheet.tsx): let go past 100pt, or flicked, it
  // closes, the slide-out below carrying on from where the finger left it;
  // short of that it springs back.
  const [drag] = useState(() => {
    const settle = () =>
      Animated.parallel([
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
        Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          slideY.setValue(g.dy);
          backdrop.setValue(Math.max(0, 1 - g.dy / 300));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.8) onCloseRef.current();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  });

  useEffect(() => {
    if (side) {
      setShown(side);
      if (side === "first") setMadeFirst(true);
      if (open.current) return;
      open.current = true;
      if (side !== "first") setMadeFirst(false);
      setShownLocked(lockedRef.current);
      setMounted(true);
      slideY.setValue(600);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else if (open.current) {
      open.current = false;
      Animated.parallel([
        Animated.timing(slideY, { toValue: 600, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start(() => {
        // Taken away when it's down, and also when anything but opening again
        // cuts the slide short: a sheet cut short used to stay up for good.
        if (!open.current) setMounted(false);
      });
    }
  }, [side, slideY, backdrop]);

  // The first pick moves the sheet on to the second. Any other opens nothing
  // else, so it lands at once, under the sheet sliding away.
  const choose = (ref: RunRef) => {
    if (shown === "first") {
      onPick(ref);
      return;
    }
    if (!sameRun(ref, selected)) onPick(ref);
    onClose();
  };

  const cue = isDark ? CUE_INK_DARK : CUE_INK;
  // Green's dot on the first pick and on green's own; blue's ring on blue's.
  const markerSide = shown === "blue" ? "blue" : "green";
  const otherSide = markerSide === "blue" ? "green" : "blue";
  const title = shownLocked ? "Compare programs" : shown === "first" ? "Compare" : shown === "blue" ? "Compare with" : "Show in green";
  const greenNote = forClient ? "Their current program, or one they've finished." : "Your current program, or one you've finished.";
  const backShown = shown === "blue" && madeFirst && !shownLocked;
  // The other side as the header has it: a finished run by its dates, which
  // tells two of one name apart, the one going by where it's up to.
  const when = (v: ProgramRunView) => {
    if (v.finished) return runDates(v, todayYMD);
    const s = runStatus(v, todayYMD);
    return `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  };

  return (
    <Modal visible={mounted} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onClose}>
      {/* Sliding away, it takes no touches. A quick tap on its top sprang it
          back up after the page had closed it, a sheet nothing could close
          over a page that took no taps (user report, 2026-10-23), and a tap
          on a row picked whichever row had slid under the finger. */}
      <View style={{ flex: 1 }} pointerEvents={side ? "auto" : "none"}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_DIM, opacity: backdrop }]} />
        </TouchableWithoutFeedback>
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[styles.sheet, sheetSurface(t.bg), { paddingBottom: sheetFootGap(insets.bottom) + 16, transform: [{ translateY: slideY }] }]}
          >
            <SheetGlass />
            {/* What takes the drag: the handle, the title and what's under it,
                never the list, which scrolls, or a button. */}
            <View {...drag.panHandlers}>
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
              </View>
              <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
              {shownLocked ? (
                <LockedPreview readiness={shownLocked} forClient={forClient} />
              ) : shown === "first" ? (
                <View style={styles.otherRow}>
                  <Marker side="green" isDark={isDark} />
                  <Text style={[styles.other, { color: t.ts }]}>Pick the first program. It shows in green.</Text>
                </View>
              ) : other ? (
                <View style={styles.otherRow}>
                  <Marker side={otherSide} isDark={isDark} />
                  <Text style={[styles.other, { color: t.ts }]}>
                    {`${shown === "blue" ? "" : "Compared with "}${runName(other)}, ${when(other)}`}
                  </Text>
                </View>
              ) : null}
            </View>

            {shownLocked ? null : (
              <>
                <ScrollView
                  style={{ maxHeight: 420, marginHorizontal: -14, marginTop: 12 }}
                  contentContainerStyle={{ paddingTop: 8, paddingBottom: 8, paddingHorizontal: 14, gap: 12 }}
                  showsVerticalScrollIndicator={false}
                >
                  {options.map(v => {
                    const sel = sameRun(v.ref, selected);
                    return (
                      <SheetPill
                        key={`${v.ref.programId}|${v.ref.run}`}
                        label={runName(v)}
                        sub={v.finished ? runSummary(v, todayYMD) : `${runStatus(v, todayYMD)} · ${v.sessions.length} ${v.sessions.length === 1 ? "workout" : "workouts"}`}
                        selected={sel}
                        icon={() => <Marker side={markerSide} isDark={isDark} />}
                        onPress={() => choose(v.ref)}
                        accessibilityState={{ selected: sel }}
                      />
                    );
                  })}
                </ScrollView>

                <Text style={[styles.note, { color: cue }]}>
                  {shown === "blue" ? "A program shows here once it's finished." : greenNote}
                </Text>
              </>
            )}
            {backShown ? <SheetPill label="Back" onPress={onBack} style={{ marginTop: 16 }} /> : null}
            <SheetPill label={shownLocked ? "Close" : "Cancel"} variant="cancel" onPress={onClose} style={{ marginTop: backShown ? 12 : 16 }} />
            <SheetCloseButton onPress={onClose} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 4 },
  // The grabber row, with the X beside it (SheetChrome).
  handleWrap: { ...SHEET_TOP_ROW },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  title: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 4, marginLeft: 4 },
  otherRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4, marginLeft: 4 },
  other: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  note: { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 2 },
  intro: { marginTop: 4, marginLeft: 4, lineHeight: 18 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 18, marginLeft: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  // The chart at its own size, centred: it fits the narrowest sheet (an SE's).
  preview: { width: PREVIEW_W, alignSelf: "center", marginTop: 12 },
  previewAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  previewAxisText: { fontFamily: FontFamily.regular, fontSize: 11 },
  stepsHead: { fontFamily: FontFamily.bold, fontSize: 15, marginTop: 20, marginLeft: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginLeft: 4 },
  stepMark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepNum: { fontFamily: FontFamily.bold, fontSize: 13 },
  stepLabel: { fontFamily: FontFamily.semibold, fontSize: 15 },
  stepSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
});
