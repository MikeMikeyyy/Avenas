// Putting a workout's exercises in a new order: the one sheet every page that
// reorders opens (the program builder, the Workout tab, the Journal's workout
// page and Log Workout; user request, 2026-10-29: four copies had drifted into
// four looks), and its list, which the builder's Workout Summary also shows for
// a day. Modelled on the builder's: each row is a drag handle, the exercise's
// number (NumberBadge, as on its card), its name, Change (the page's Change
// Exercise) and the red delete circle, which asks first. Built on SimpleSheet,
// so it drags down by its top, stops below the status bar and scrolls a long
// list, with Done pinned under it. The first time it opens, a guide to moving
// a row comes up over it (components/GuideCard.tsx).
//
// A row is moved by its left side, the lines, the number and the name (user
// request, 2026-10-30: the name used to open Change), picked up the moment
// it's touched. The held row follows the finger, the
// rows it passes slide a place the other way, and letting go hands the page
// the new order. Each row owns its offset and its touches (the view's own
// responder props, not a PanResponder made during render, which the React
// hooks lint flags), and tells the list only when it passes into another
// row's place, so the list redraws once per place, not once per frame.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from "react-native";
import * as Haptics from "expo-haptics";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import SimpleSheet from "./trainer/SimpleSheet";
import SheetPill from "./SheetPill";
import NumberBadge from "./NumberBadge";
import DeleteCircleButton, { DELETE_CIRCLE_SIZE } from "./DeleteCircleButton";
import { GuideBody, GuideDemo, GuideGotIt, GuideOverlay, GuideTitle } from "./GuideCard";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { PILL_RADIUS, PILL_SHADOW } from "../constants/buttons";
import { REORDER_GUIDE_KEY } from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";
import { getJSON, setJSON } from "../utils/storage";

/** The three lines a row is held by, and that the pages' Move buttons draw. */
export function DragHandleIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={12} viewBox="0 0 16 12" fill="none">
      <Path d="M1 1.5h14M1 6h14M1 10.5h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

// A row's height before it has measured itself: its 32pt controls and padding.
const ROW_H = 56;
// The first-time guide comes up this long after the sheet does, once it's in.
const GUIDE_DELAY_MS = 450;
// The rows' slide, the same spring the four copies used.
const SLIDE = { useNativeDriver: false, damping: 20, stiffness: 280 } as const;

/** A place up (-1) or down (1) to make room for the held row, or none. */
type Shift = -1 | 0 | 1;

function ReorderRow({ index, count, name, active, shift, divider, onHold, onOver, onLetGo, onChange, onRemove }: {
  index: number;
  count: number;
  name: string;
  /** This is the row being held. */
  active: boolean;
  shift: Shift;
  /** A hairline under it (every row but the last). */
  divider: boolean;
  onHold: (index: number) => void;
  onOver: (index: number) => void;
  /** `commit` false when the touch was taken away rather than let go. */
  onLetGo: (commit: boolean) => void;
  onChange: () => void;
  onRemove: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [y] = useState(() => new Animated.Value(0));
  const height = useRef(ROW_H);
  const drag = useRef({ y0: 0, over: index });

  // Drawn in a new place once the order changes: the offset that carried it
  // there goes before the frame is painted, so nothing jumps back.
  useLayoutEffect(() => { y.setValue(0); }, [index, y]);

  // Making room for the held row, or going back; and the held row, let go
  // where it started, settling back into its place.
  useEffect(() => {
    if (active) return;
    Animated.spring(y, { ...SLIDE, toValue: shift * height.current }).start();
  }, [active, shift, y]);

  const pickUp = (pageY: number) => {
    drag.current = { y0: pageY, over: index };
    onHold(index);
  };
  const follow = (e: GestureResponderEvent) => {
    const dy = e.nativeEvent.pageY - drag.current.y0;
    y.setValue(dy);
    const over = Math.max(0, Math.min(count - 1, Math.round(index + dy / height.current)));
    if (over !== drag.current.over) {
      drag.current.over = over;
      onOver(over);
    }
  };

  return (
    <Animated.View
      style={[
        styles.row,
        divider && { borderBottomWidth: 1, borderBottomColor: active ? "transparent" : t.sheetLine },
        { transform: [{ translateY: y }], zIndex: active ? 10 : 1 },
        active && [styles.held, { backgroundColor: t.field }],
      ]}
      onLayout={e => { if (e.nativeEvent.layout.height > 0) height.current = e.nativeEvent.layout.height; }}
    >
      {/* Everything from the three lines up to Change moves the row, picked
          up the moment it's touched (user requests, 2026-10-30: a moment's
          hold on the number and name, so a swipe there could scroll, read as
          those not moving at all, since a finger drags at once). A long list
          scrolls from Change, the delete, the gaps and the title. */}
      <View
        style={styles.dragArea}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // An enclosing scroll view can't take the drag back: a steal ends it
        // without a release, which would leave the sheet's scroll locked.
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => pickUp(e.nativeEvent.pageY)}
        onResponderMove={follow}
        onResponderRelease={() => onLetGo(true)}
        onResponderTerminate={() => onLetGo(false)}
        accessibilityLabel={`Hold and drag to move ${name}`}
      >
        <View style={styles.handle}>
          <DragHandleIcon color={t.ts} />
        </View>
        <NumberBadge n={index + 1} isDark={isDark} />
        <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{name}</Text>
      </View>
      {/* Another exercise in this one's place, keeping its sets. Its only way
          in from here: the name moves the row now. */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(); }}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={[styles.changeBtn, { backgroundColor: t.ctrl }, PILL_SHADOW]}
        accessibilityRole="button"
        accessibilityLabel={`Change ${name}`}
      >
        <Ionicons name="swap-horizontal" size={14} color={t.tp} />
        <Text style={[styles.changeText, { color: t.tp }]}>Change</Text>
      </TouchableOpacity>
      <DeleteCircleButton
        onPress={() =>
          Alert.alert("Remove Exercise", `Remove "${name}"?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: onRemove },
          ])
        }
        accessibilityLabel={`Remove ${name}`}
      />
    </Animated.View>
  );
}

export interface ReorderExerciseListProps<T> {
  items: T[];
  /** A key of its own for each exercise (its id), which its row keeps as it moves. */
  keyOf: (item: T, index: number) => string;
  nameOf: (item: T) => string;
  onReorder: (items: T[]) => void;
  /** Change Exercise for a row: its name or its Change pill. */
  onChange: (item: T, index: number) => void;
  /** A row's delete circle, once "Remove Exercise" is confirmed. */
  onRemove: (item: T, index: number) => void;
  /** True while a row is held, so whatever scrolls the list holds still. */
  onDragStateChange?: (dragging: boolean) => void;
}

/** The rows on their own, for a sheet of its own (the builder's Workout Summary). */
export function ReorderExerciseList<T>({ items, keyOf, nameOf, onReorder, onChange, onRemove, onDragStateChange }: ReorderExerciseListProps<T>) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  // The same, for the touch handlers, which may run before a redraw has
  // caught up with the last place passed.
  const dragNow = useRef<{ from: number; over: number } | null>(null);

  // Unmounted mid-drag (its sheet closed under the finger), the release never
  // comes, so hand the scroll lock back on the way out or the sheet stays frozen.
  const unlock = useRef(onDragStateChange);
  useEffect(() => { unlock.current = onDragStateChange; }, [onDragStateChange]);
  useEffect(() => () => { if (dragNow.current) unlock.current?.(false); }, []);

  const hold = (from: number) => {
    dragNow.current = { from, over: from };
    setDrag(dragNow.current);
    onDragStateChange?.(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const over = (to: number) => {
    if (!dragNow.current) return;
    dragNow.current = { ...dragNow.current, over: to };
    setDrag(dragNow.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const letGo = (commit: boolean) => {
    const d = dragNow.current;
    dragNow.current = null;
    if (d && commit && d.over !== d.from) {
      const next = [...items];
      const [moved] = next.splice(d.from, 1);
      next.splice(d.over, 0, moved);
      onReorder(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setDrag(null);
    onDragStateChange?.(false);
  };

  const shiftOf = (i: number): Shift => {
    if (!drag || i === drag.from) return 0;
    if (drag.over > drag.from && i > drag.from && i <= drag.over) return -1;
    if (drag.over < drag.from && i < drag.from && i >= drag.over) return 1;
    return 0;
  };

  return (
    <>
      {items.map((item, i) => (
        <ReorderRow
          key={keyOf(item, i)}
          index={i}
          count={items.length}
          name={nameOf(item)}
          active={drag?.from === i}
          shift={shiftOf(i)}
          divider={i < items.length - 1}
          onHold={hold}
          onOver={over}
          onLetGo={letGo}
          onChange={() => onChange(item, i)}
          onRemove={() => onRemove(item, i)}
        />
      ))}
    </>
  );
}

export default function ReorderExercisesSheet<T>({ visible, subtitle, closeOnRemove = false, onClose, onChange, onRemove, ...list }: Omit<ReorderExerciseListProps<T>, "onDragStateChange"> & {
  visible: boolean;
  /** Under the title: the day, or the workout's name. */
  subtitle?: string;
  /** Remove slides the sheet away first, on a page that removes an exercise
   *  by collapsing its card (the Workout tab, the Journal's workout page): the
   *  collapse is seen, and nothing is reordered under it while it runs. */
  closeOnRemove?: boolean;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [dragging, setDragging] = useState(false);
  // What a row asked for that has to wait for the sheet to go: Change opens
  // the page's picker, a second RN Modal, which can't present over this one.
  // It runs before onClose, so a page can tell a close that continues an edit
  // from a plain one (the Journal's workout page saves a move on a plain one).
  const after = useRef<(() => void) | null>(null);
  const closed = () => {
    setDragging(false);
    const next = after.current;
    after.current = null;
    next?.();
    onClose();
  };

  // The first-time guide to moving a row (user request, 2026-10-30): over the
  // sheet, a moment after it first comes up, on whichever page that is, until
  // it's done with (Got it, its X, or a tap outside it).
  const [guideDue, setGuideDue] = useState(false);
  const [guideShown, setGuideShown] = useState(false);
  useEffect(() => {
    let live = true;
    void getJSON<boolean>(REORDER_GUIDE_KEY, false).then(seen => { if (live && !seen) setGuideDue(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!visible || !guideDue) return;
    const timer = setTimeout(() => setGuideShown(true), GUIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, guideDue]);
  const doneWithGuide = () => {
    setGuideShown(false);
    setGuideDue(false);
    void setJSON(REORDER_GUIDE_KEY, true);
  };

  return (
    <SimpleSheet
      visible={visible}
      onClose={closed}
      scrollEnabled={!dragging}
      footer={close => (
        <View style={styles.doneRow}>
          <SheetPill label="Done" variant="primary" onPress={close} />
        </View>
      )}
      over={guideShown ? (
        <GuideOverlay onClose={doneWithGuide}>
          <GuideTitle>Move your exercises</GuideTitle>
          <GuideBody>
            Hold the left side of a row (its lines, number or name) and drag it up or down to change the order.
          </GuideBody>
          <GuideDemo>
            <View style={[styles.demoRow, { backgroundColor: t.field }]}>
              <DragHandleIcon color={t.ts} />
              <NumberBadge n={1} isDark={isDark} size={28} />
              <Text style={[styles.demoName, { color: t.tp }]}>Bench Press</Text>
              <Ionicons name="swap-vertical" size={18} color={ACCT} />
            </View>
          </GuideDemo>
          <GuideGotIt onPress={doneWithGuide} />
        </GuideOverlay>
      ) : null}
    >
      {close => (
        <>
          <View style={[styles.header, { borderBottomColor: t.sheetLine }]}>
            <Text style={[styles.title, { color: t.tp }]}>Reorder Exercises</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: t.ts }]} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <View style={styles.listWrap}>
            <ReorderExerciseList
              {...list}
              onDragStateChange={setDragging}
              onChange={(item, i) => { after.current = () => onChange(item, i); close(); }}
              onRemove={closeOnRemove
                ? (item, i) => { after.current = () => onRemove(item, i); close(); }
                : onRemove}
            />
          </View>
        </>
      )}
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  header:     { alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title:      { fontFamily: FontFamily.bold, fontSize: 16 },
  subtitle:   { fontFamily: FontFamily.regular, fontSize: 14, marginTop: 2 },
  listWrap:   { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4 },
  doneRow:    { paddingHorizontal: 20, paddingTop: 12 },
  row:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  // The held row, lifted off the others.
  held:       { borderRadius: 8, ...PILL_SHADOW, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  // The part of a row that moves it: the lines, the number and the name.
  dragArea:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  handle:     { padding: 4, justifyContent: "center", alignItems: "center" },
  name:       { fontFamily: FontFamily.regular, fontSize: 15, flex: 1 },
  // The guide's picture of a row, moving.
  demoRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 14, borderRadius: 14 },
  demoName:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  changeBtn:  { flexDirection: "row", alignItems: "center", gap: 4, height: DELETE_CIRCLE_SIZE, paddingHorizontal: 12, borderRadius: PILL_RADIUS },
  changeText: { fontFamily: FontFamily.semibold, fontSize: 13 },
});
