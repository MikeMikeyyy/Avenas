// components/progress/CompareSheet.tsx
//
// The Progress page's "Compare with" sheet: which program to compare with
// (blue: FINISHED programs only, the user's rule), or, from the green row of
// the compare header, which one shows in green (the current program, or a
// finished one). Each run is a SheetPill with its status, length and workouts;
// a program run more than once lists each run ("Push Pull Legs, 1st run").
// One sheet for both sides, so the page never has two up at once. While there's
// nothing to compare it opens locked: a preview with empty rows and the two
// steps comparing needs (user request, 2026-10-15, in place of hiding the
// button).

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableWithoutFeedback, ScrollView, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SheetPill from "../SheetPill";
import { Ionicons } from "@expo/vector-icons";
import { ACCT, APP_DARK, APP_LIGHT, CUE_INK, CUE_INK_DARK, FontFamily, accentTextColor, compareBlue } from "../../constants/theme";
import { PILL_RADIUS } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { runDates, runName, runStatus, runSummary } from "../../utils/programCompare";
import { sameRun, type ProgramRunView, type RunRef } from "../../utils/programRuns";

export type CompareSheetSide = "green" | "blue";

interface Props {
  /** Which side is being picked; null closes the sheet. */
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
  /** A trainer's view of a client: the checklist speaks of "their" programs. */
  forClient: boolean;
  onPick: (ref: RunRef) => void;
  onClose: () => void;
}

type Readiness = { finished: boolean; another: boolean };

function Marker({ side, isDark }: { side: CompareSheetSide; isDark: boolean }) {
  return side === "green"
    ? <View style={[styles.dot, { backgroundColor: ACCT }]} />
    : <View style={[styles.ring, { borderColor: compareBlue(isDark) }]} />;
}

/** Two rows where the programs would be, empty, so the sheet shows what it's
 *  for, then the two steps comparing needs, each ticked once done. */
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
          ? "Set their current program beside one they've finished, week by week and lift by lift."
          : "Set your current program beside one you've finished, week by week and lift by lift."}
      </Text>
      <View style={styles.ghostList} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1].map(i => (
          <View key={i} style={[styles.ghost, { borderColor: t.div, opacity: i === 0 ? 1 : 0.55 }]}>
            <View style={[styles.ring, { borderColor: compareBlue(isDark), opacity: 0.5 }]} />
            <View style={styles.ghostText}>
              <View style={[styles.ghostBar, { width: 128, backgroundColor: t.div }]} />
              <View style={[styles.ghostBar, styles.ghostSub, { backgroundColor: t.div }]} />
            </View>
          </View>
        ))}
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

export default function CompareSheet({ side, options, selected, other, todayYMD, locked, forClient, onPick, onClose }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  // The side it was opened for, and whether it opened locked, kept through
  // the slide-out.
  const [shown, setShown] = useState<CompareSheetSide>("blue");
  const [shownLocked, setShownLocked] = useState<Readiness | null>(null);
  const slideY = useRef(new Animated.Value(600)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  // Read as it opens, never a reason to open it again.
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (side) {
      setShown(side);
      setShownLocked(lockedRef.current);
      setMounted(true);
      slideY.setValue(600);
      backdrop.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slideY, { toValue: 600, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [side, mounted, slideY, backdrop]);

  // A pick opens nothing else, so it lands at once, under the sheet sliding
  // away.
  const choose = (ref: RunRef) => {
    if (!sameRun(ref, selected)) onPick(ref);
    onClose();
  };

  const cue = isDark ? CUE_INK_DARK : CUE_INK;
  const otherSide: CompareSheetSide = shown === "blue" ? "green" : "blue";
  // The other side as the header has it: a finished run by its dates, which
  // tells two of one name apart, the one going by where it's up to.
  const when = (v: ProgramRunView) => {
    if (v.finished) return runDates(v, todayYMD);
    const s = runStatus(v, todayYMD);
    return `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  };

  return (
    <Modal visible={mounted} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdrop }]} />
        </TouchableWithoutFeedback>
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16, transform: [{ translateY: slideY }] }]}
          >
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            <Text style={[styles.title, { color: t.tp }]}>{shown === "blue" ? "Compare with" : "Show in green"}</Text>
            {shownLocked ? (
              <LockedPreview readiness={shownLocked} forClient={forClient} />
            ) : other ? (
              <View style={styles.otherRow}>
                <Marker side={otherSide} isDark={isDark} />
                <Text style={[styles.other, { color: t.ts }]}>
                  {`${shown === "blue" ? "" : "Compared with "}${runName(other)}, ${when(other)}`}
                </Text>
              </View>
            ) : null}

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
                        icon={() => <Marker side={shown} isDark={isDark} />}
                        onPress={() => choose(v.ref)}
                        accessibilityState={{ selected: sel }}
                      />
                    );
                  })}
                </ScrollView>

                <Text style={[styles.note, { color: cue }]}>
                  {shown === "blue" ? "A program shows here once it's finished." : "Your current program, or a finished one."}
                </Text>
              </>
            )}
            <SheetPill label={shownLocked ? "Close" : "Cancel"} variant="cancel" onPress={onClose} style={{ marginTop: 16 }} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 4 },
  handleWrap: { paddingVertical: 12, alignItems: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)" },
  title: { fontFamily: FontFamily.bold, fontSize: 18, marginTop: 4, marginLeft: 4 },
  otherRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4, marginLeft: 4 },
  other: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  note: { fontFamily: FontFamily.regular, fontSize: 12, textAlign: "center", marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 2 },
  intro: { marginTop: 4, marginLeft: 4, lineHeight: 18 },
  ghostList: { gap: 12, marginTop: 20 },
  ghost: {
    minHeight: 56, borderRadius: PILL_RADIUS, borderWidth: 1.5, borderStyle: "dashed",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20,
  },
  ghostText: { alignItems: "center", gap: 6 },
  ghostBar: { height: 10, borderRadius: 5 },
  ghostSub: { width: 84, height: 7, borderRadius: 3.5 },
  stepsHead: { fontFamily: FontFamily.bold, fontSize: 15, marginTop: 24, marginLeft: 4 },
  step: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginLeft: 4 },
  stepMark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepNum: { fontFamily: FontFamily.bold, fontSize: 13 },
  stepLabel: { fontFamily: FontFamily.semibold, fontSize: 15 },
  stepSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
});
