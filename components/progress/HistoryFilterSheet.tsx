// The Exercise History page's filter (user decision, 2026-10-22, the Exercise
// History Program Filter canvas, option C): one sheet for which programs and
// the time range. Every pill one size, a name each (no counts); the program
// running now first, its accent dot beside its name; as many picked as wanted
// (utils/exerciseHistory.ts togglePick); the range on the app's round
// segmented control. Nothing changes on the page until its button, which says
// how many sessions the choice lists; closed any other way, it's dropped.

import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
  Animated,
  Easing,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import SheetPill from "../SheetPill";
import { SHEET_DIM, SHEET_TOP_ROW, SHEET_TOP_ROW_H, SheetCloseButton, SheetGlass, sheetFootGap, sheetSurface } from "../SheetChrome";
import SegmentedControl from "../SegmentedControl";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { EXERCISE_RANGE_OPTIONS, type ExerciseRangeKey } from "../../constants/progress";
import type { SavedProgram } from "../../constants/programs";
import { useTheme } from "../../contexts/ThemeContext";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import {
  isPicked,
  pickLabel,
  togglePick,
  type HistoryFilterItem,
  type HistoryOptions,
  type HistoryPick,
} from "../../utils/exerciseHistory";
import { CUSTOM_WORKOUTS_NAME } from "../../utils/progressStats";

// What sits in the sheet besides the programs (the grabber row, title, the two
// headings, the range and the button), so the list scrolls rather than
// pushing the sheet past the top of the screen. 302 under a 28pt grabber row,
// plus whatever the shared one is (SheetChrome's, with room for the X).
const SHEET_CHROME = 302 + SHEET_TOP_ROW_H;

interface Props {
  visible: boolean;
  onClose: () => void;
  options: HistoryOptions;
  /** For the names of picks a program no longer lists. */
  programs: SavedProgram[];
  picks: HistoryPick[];
  range: ExerciseRangeKey;
  /** How many sessions a choice would list, for the button. */
  countFor: (picks: HistoryPick[], range: ExerciseRangeKey) => number;
  onApply: (picks: HistoryPick[], range: ExerciseRangeKey) => void;
}

export default function HistoryFilterSheet({ visible, onClose, options, programs, picks, range, countFor, onApply }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Built the way TimeEditSheet and ExercisePicker are, the sheets that open
  // on a phone: the page's `visible` is the Modal's, the slide-up starts once
  // it's open, and the slide-down plays before the page is told to close it.
  // Nothing animates while it's shut. (Its first build kept its own copy of
  // `visible` and slid "down" as the page loaded; on iOS it never appeared and
  // the empty modal left on the page took every tap but the back button.)
  const [slideY] = useState(() => new Animated.Value(600));
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [draft, setDraft] = useState<HistoryPick[]>(picks);
  const [draftRange, setDraftRange] = useState<ExerciseRangeKey>(range);
  // A close already sliding down: another tap mustn't start a second.
  const closing = useRef(false);

  // Each opening starts from what the page shows.
  useEffect(() => {
    if (!visible) return;
    closing.current = false;
    setDraft(picks);
    setDraftRange(range);
    slideY.setValue(600);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [visible, slideY, backdropOpacity]); // picks and range are read as they stand when it opens

  // Slides down, then hands over to the page, which closes it.
  const animateClose = (after: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(slideY, { toValue: 600, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => after());
  };
  const close = () => animateClose(onClose);
  const drag = useSheetDrag({ slideY, backdrop: backdropOpacity, onClose: close });

  const count = visible ? countFor(draft, draftRange) : 0;
  const tap = (item: HistoryFilterItem) => setDraft(d => togglePick(d, item, options));
  const pill = (key: string, label: string, item: HistoryFilterItem, active = false) => {
    const selected = isPicked(draft, item, options);
    return (
      <SheetPill
        key={key}
        label={label}
        selected={selected}
        // The program running now: its dot beside its name.
        icon={active ? () => <View style={[styles.activeDot, { backgroundColor: ACCT }]} /> : undefined}
        onPress={() => tap(item)}
        accessibilityState={{ selected }}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={close}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_DIM, opacity: backdropOpacity }]}
          />
        </TouchableWithoutFeedback>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.sheet,
              sheetSurface(t.bg),
              { paddingBottom: sheetFootGap(insets.bottom) + 16, transform: [{ translateY: slideY }] },
            ]}
          >
            <SheetGlass />
            {/* Held here and dragged down, it closes (hooks/useSheetDrag.ts). */}
            <View {...drag}>
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
              </View>
              <Text style={[styles.sheetTitle, { color: t.tp }]}>Filter sessions</Text>
            </View>

            <Text style={[styles.sectionLabel, { color: t.ts }]}>Program</Text>
            <ScrollView
              // Widened by the same amount its content is padded, so the
              // pills' shadows have room inside the scroll's clipped bounds.
              style={{ maxHeight: Math.max(200, height - insets.top - insets.bottom - SHEET_CHROME), marginHorizontal: -14 }}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            >
              {pill("all", "All programs", { kind: "all" })}
              {options.programs.map(o => (
                <View key={o.programId} style={styles.group}>
                  {pill(o.programId, o.name, { kind: "program", programId: o.programId }, o.active)}
                  {o.days.map(d => pill(
                    `${o.programId}|${d.key}`,
                    pickLabel(d.pick, options, programs),
                    { kind: "day", programId: o.programId, key: d.key },
                  ))}
                </View>
              ))}
              {options.free ? pill("free", CUSTOM_WORKOUTS_NAME, { kind: "free" }) : null}
            </ScrollView>

            <Text style={[styles.sectionLabel, styles.rangeLabel, { color: t.ts }]}>Time range</Text>
            <SegmentedControl<ExerciseRangeKey>
              options={EXERCISE_RANGE_OPTIONS}
              value={draftRange}
              onChange={setDraftRange}
            />

            <SheetPill
              variant="primary"
              label={count === 0 ? "No sessions to show" : `Show ${count} session${count === 1 ? "" : "s"}`}
              disabled={count === 0}
              onPress={() => animateClose(() => onApply(draft, draftRange))}
              style={styles.apply}
            />
            <SheetCloseButton onPress={close} />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  // The grabber row, with the X beside it (SheetChrome).
  handleWrap: {
    ...SHEET_TOP_ROW,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.4)",
  },
  sheetTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    marginTop: 4,
    marginBottom: 16,
    marginLeft: 4,
  },
  // ProgramScopePicker's section label.
  sectionLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginLeft: 6,
    marginBottom: 10,
  },
  rangeLabel: { marginTop: 20 },
  list: { paddingVertical: 4, paddingHorizontal: 14, gap: 12 },
  // A program and its days, the same gap between them as between programs.
  group: { gap: 12 },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  apply: { marginTop: 20 },
});
