// A custom exercise's "How to do it": its steps, numbered, in one card (user
// picks, 2026-11-12, the Custom Exercise Redesign canvas, D). A step reads as
// its words and is typed into in place once tapped; it moves by its handle on
// the right and is deleted with a swipe left, which shows a red Delete to tap
// (a swipe never deletes on its own). "Add step" is the card's last row.
//
// A step shows as words until it's tapped so a swipe never lands in a text box,
// which would take the touch for itself (typing, or the keyboard coming up).
// While one is being typed into it doesn't swipe; its handle still moves it.
//
// The drag is the reorder sheet's (components/ReorderExercisesSheet.tsx): the
// row's own responder props, an RN Animated offset (set before the frame that
// draws the new order, so nothing jumps back), the rows it passes sliding a
// place the other way, and the page's scroll held still while a row is held.
// Steps differ in height, so a place is worked out from each row's measured
// height, and the rows that make room slide by the held row's.
//
// VoiceOver can't drag or swipe, so each step also has Delete, Move up and
// Move down as actions.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Animated, Keyboard, Pressable, StyleSheet, Text, TextInput, View,
  type AccessibilityActionEvent, type GestureResponderEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import TrashIcon from "./TrashIcon";
import NumberBadge from "./NumberBadge";
import { DragHandleIcon } from "./ReorderExercisesSheet";
import { useTheme } from "../contexts/ThemeContext";
import {
  APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily, NEU_BG, NEU_BG_DARK, ON_FILL, accentTextColor,
} from "../constants/theme";
import { PILL_SHADOW } from "../constants/buttons";
import { moveItem, placeReached, slideFor } from "../utils/stepOrder";

/** One step, with an id of its own so its row keeps it as it moves. */
export type Step = { id: string; text: string };

let stepSeq = 0;
/** A step with an id of its own (a saved exercise's steps are plain words). */
export function newStep(text = ""): Step {
  return { id: `step_${Date.now().toString(36)}_${(stepSeq++).toString(36)}`, text };
}

/** How far a swipe opens a row: the red Delete behind it. */
const DELETE_W = 88;
/** A row's height before it has measured itself: one line and its padding. */
const ROW_H = 49;
/** The rows' slide, the reorder sheet's spring. */
const SLIDE = { useNativeDriver: false, damping: 20, stiffness: 280 } as const;

/** A place up (-1) or down (1) to make room for the held row, or none. */
type Shift = -1 | 0 | 1;

/** The held row's place when picked up, the place it has reached, and its height. */
type Drag = { from: number; over: number; height: number };

function StepRow({
  index, count, step, editing, open, active, dragging, shift, heldHeight, divider,
  onEdit, onChangeText, onOpen, onDelete, onMove, onHold, onDrag, onLetGo, onHeight,
}: {
  index: number;
  count: number;
  step: Step;
  /** Being typed into. */
  editing: boolean;
  /** Swiped open, its Delete showing. */
  open: boolean;
  /** This is the row being held. */
  active: boolean;
  /** Some row is being held. */
  dragging: boolean;
  shift: Shift;
  /** How far a row making room slides: the held row's height. */
  heldHeight: number;
  /** A hairline under it (every row but the last step's, above Add step). */
  divider: boolean;
  onEdit: (editing: boolean) => void;
  onChangeText: (text: string) => void;
  onOpen: (open: boolean) => void;
  onDelete: () => void;
  onMove: (by: -1 | 1) => void;
  onHold: () => void;
  onDrag: (dy: number) => void;
  /** `commit` false when the touch was taken away rather than let go. */
  onLetGo: (commit: boolean) => void;
  onHeight: (height: number) => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const card = isDark ? NEU_BG_DARK : NEU_BG;
  const [y] = useState(() => new Animated.Value(0));
  const [x] = useState(() => new Animated.Value(0));
  const grab = useRef(0);
  const swipe = useRef({ x0: 0, y0: 0, from: 0 });

  // Drawn in a new place once the order changes: the offset that carried it
  // there goes before the frame is painted, so nothing jumps back.
  useLayoutEffect(() => { y.setValue(0); }, [index, y]);

  // Making room for the held row, or going back; and the held row, let go
  // where it started, settling back into its place.
  useEffect(() => {
    if (active) return;
    Animated.spring(y, { ...SLIDE, toValue: shift * heldHeight }).start();
  }, [active, shift, heldHeight, y]);

  // Open or shut as the list says (another row opened shuts this one).
  useEffect(() => {
    Animated.spring(x, { ...SLIDE, toValue: open ? -DELETE_W : 0 }).start();
  }, [open, x]);

  const settle = (toOpen: boolean) => {
    Animated.spring(x, { ...SLIDE, toValue: toOpen ? -DELETE_W : 0 }).start();
    onOpen(toOpen);
  };

  const n = index + 1;
  const actions = [
    { name: "delete", label: "Delete step" },
    ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
    ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
  ];
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "delete") onDelete();
    else if (e.nativeEvent.actionName === "moveUp") onMove(-1);
    else if (e.nativeEvent.actionName === "moveDown") onMove(1);
  };

  return (
    // Not clipped: the card is (NeuCard's clip layer), and a row's own clip
    // would cut off the held row's shadow.
    <Animated.View
      style={[
        divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: active ? "transparent" : t.div },
        { transform: [{ translateY: y }], zIndex: active ? 10 : 1 },
        active && [styles.held, { backgroundColor: card }],
      ]}
      onLayout={e => { if (e.nativeEvent.layout.height > 0) onHeight(e.nativeEvent.layout.height); }}
    >
      {/* Behind the step, shown by a swipe left. */}
      <View style={[styles.under, { backgroundColor: DANGER_BRIGHT }]}>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDelete(); }}
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel={`Delete step ${n}`}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          <TrashIcon size={20} color={ON_FILL} />
          <Text style={[styles.deleteText, { color: ON_FILL }]}>Delete</Text>
        </Pressable>
      </View>

      <Animated.View
        style={[styles.content, { backgroundColor: card, transform: [{ translateX: x }] }]}
        onTouchStart={(e: GestureResponderEvent) => {
          swipe.current = { ...swipe.current, x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY };
        }}
        // Sideways, and more sideways than down: a swipe. Never while typing
        // into it or while a row is held.
        onMoveShouldSetResponderCapture={(e: GestureResponderEvent) => {
          if (editing || dragging) return false;
          const dx = e.nativeEvent.pageX - swipe.current.x0;
          const dy = e.nativeEvent.pageY - swipe.current.y0;
          return Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4 && (dx < 0 || open);
        }}
        onResponderTerminationRequest={() => false}
        onResponderGrant={() => { swipe.current.from = open ? -DELETE_W : 0; }}
        onResponderMove={(e: GestureResponderEvent) => {
          const dx = e.nativeEvent.pageX - swipe.current.x0;
          x.setValue(Math.min(0, Math.max(-DELETE_W * 1.4, swipe.current.from + dx)));
        }}
        onResponderRelease={(e: GestureResponderEvent) => {
          const dx = e.nativeEvent.pageX - swipe.current.x0;
          settle(swipe.current.from + dx < -DELETE_W / 2);
        }}
        onResponderTerminate={() => settle(open)}
      >
        <NumberBadge n={n} isDark={isDark} size={24} wash />

        {editing ? (
          <TextInput
            style={[styles.words, styles.input, { color: t.tp }]}
            value={step.text}
            onChangeText={onChangeText}
            onBlur={() => onEdit(false)}
            placeholder={`Step ${n}`}
            placeholderTextColor={t.ts}
            multiline
            autoFocus
            scrollEnabled={false}
            textAlignVertical="top"
            accessibilityLabel={`Step ${n}`}
          />
        ) : (
          <Pressable
            style={styles.wordsTap}
            // Open, a tap shuts it rather than starting to type.
            onPress={() => (open ? settle(false) : onEdit(true))}
            accessibilityRole="button"
            accessibilityLabel={`Step ${n}: ${step.text.trim() || "empty"}`}
            accessibilityHint="Double tap to edit"
            accessibilityActions={actions}
            onAccessibilityAction={onAction}
          >
            <Text style={[styles.words, { color: step.text.trim() ? t.tp : t.ts }]}>
              {step.text.trim() || `Step ${n}`}
            </Text>
          </Pressable>
        )}

        {/* The handle: held, the row follows the finger. An enclosing scroll
            can't take the drag back (a steal ends it without a release, which
            would leave the page's scroll locked). */}
        <View
          style={styles.handle}
          hitSlop={10}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={e => { grab.current = e.nativeEvent.pageY; onHold(); }}
          onResponderMove={e => {
            const dy = e.nativeEvent.pageY - grab.current;
            y.setValue(dy);
            onDrag(dy);
          }}
          onResponderRelease={() => onLetGo(true)}
          onResponderTerminate={() => onLetGo(false)}
          accessibilityLabel={`Hold and drag to move step ${n}`}
        >
          <DragHandleIcon color={t.ts} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export default function StepsEditor({ steps, onChange, onDragStateChange }: {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  /** True while a step is held, so the page's scroll holds still. */
  onDragStateChange: (dragging: boolean) => void;
}) {
  const { isDark } = useTheme();
  const ink = accentTextColor(isDark);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // The held row, the place it has reached, and its height (how far the rows
  // making room slide), taken as it's picked up.
  const [drag, setDrag] = useState<Drag | null>(null);
  // The same, for the touch handlers, which may run before a redraw has
  // caught up with the last place passed.
  const dragNow = useRef<Drag | null>(null);
  const heights = useRef<Record<string, number>>({});

  // Unmounted mid-drag (the page left under the finger), the release never
  // comes, so hand the scroll back on the way out or the page stays frozen.
  const unlock = useRef(onDragStateChange);
  useEffect(() => { unlock.current = onDragStateChange; }, [onDragStateChange]);
  useEffect(() => () => { if (dragNow.current) unlock.current(false); }, []);

  const heightOf = (i: number) => heights.current[steps[i]?.id ?? ""] ?? ROW_H;

  const hold = (from: number) => {
    // Typing ends and an open row shuts: the held row is the only thing moving.
    Keyboard.dismiss();
    setEditingId(null);
    setOpenId(null);
    dragNow.current = { from, over: from, height: heightOf(from) };
    setDrag(dragNow.current);
    onDragStateChange(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // The place the held row's middle has reached, among the others' middles
  // where they stood when it was picked up (utils/stepOrder.ts).
  const dragTo = (dy: number) => {
    const d = dragNow.current;
    if (!d) return;
    const over = placeReached(steps.map((_, i) => heightOf(i)), d.from, dy);
    if (over !== d.over) {
      dragNow.current = { ...d, over };
      setDrag(dragNow.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const letGo = (commit: boolean) => {
    const d = dragNow.current;
    dragNow.current = null;
    if (d && commit && d.over !== d.from) {
      onChange(moveItem(steps, d.from, d.over));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setDrag(null);
    onDragStateChange(false);
  };

  const shiftOf = (i: number): Shift => (drag ? slideFor(i, drag.from, drag.over) : 0);

  const update = (id: string, text: string) => onChange(steps.map(s => (s.id === id ? { ...s, text } : s)));
  const remove = (id: string) => {
    setOpenId(null);
    onChange(steps.filter(s => s.id !== id));
  };
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    if (to < 0 || to >= steps.length) return;
    onChange(moveItem(steps, i, to));
  };
  const add = () => {
    const step = newStep();
    setOpenId(null);
    onChange([...steps, step]);
    setEditingId(step.id);
  };

  return (
    <>
      {steps.map((step, i) => (
        <StepRow
          key={step.id}
          index={i}
          count={steps.length}
          step={step}
          editing={editingId === step.id}
          open={openId === step.id}
          active={drag?.from === i}
          dragging={!!drag}
          shift={shiftOf(i)}
          heldHeight={drag?.height ?? 0}
          divider
          // Switching from one step to another, the first's blur can come
          // after the second has started: it only ends its own editing.
          onEdit={on => {
            if (on) { setOpenId(null); setEditingId(step.id); }
            else setEditingId(prev => (prev === step.id ? null : prev));
          }}
          onChangeText={text => update(step.id, text)}
          onOpen={on => setOpenId(prev => (on ? step.id : prev === step.id ? null : prev))}
          onDelete={() => remove(step.id)}
          onMove={by => move(i, by)}
          onHold={() => hold(i)}
          onDrag={dragTo}
          onLetGo={letGo}
          onHeight={h => { heights.current[step.id] = h; }}
        />
      ))}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); add(); }}
        style={styles.addRow}
        accessibilityRole="button"
        accessibilityLabel="Add step"
      >
        <Ionicons name="add-circle-outline" size={24} color={ink} />
        <Text style={[styles.addText, { color: ink }]}>Add step</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  // The held row, lifted off the others (the reorder sheet's).
  held:       { ...PILL_SHADOW, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  // The red Delete under the right of the row, shown as the step slides left.
  under:      { position: "absolute", top: 0, bottom: 0, right: 0, width: DELETE_W, alignItems: "center", justifyContent: "center" },
  deleteBtn:  { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: 3 },
  deleteText: { fontFamily: FontFamily.bold, fontSize: 12 },
  // What slides: the number, the words and the handle, on the card's colour.
  content:    { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  // The words' width in the row; their height is their lines (no flex on the
  // words themselves, which would size them to the tap area's minimum).
  wordsTap:   { flex: 1, minHeight: 21 },
  words:      { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 },
  // Typed into, the same words in the same place: no padding of its own.
  input:      { flex: 1, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, minHeight: 21 },
  handle:     { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  addRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  addText:    { fontFamily: FontFamily.bold, fontSize: 15 },
});
