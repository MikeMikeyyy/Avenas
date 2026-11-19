// components/progress/FilterDock.tsx
//
// The Progress page's top buttons, drawn over the page so they can stay at its
// top (utils/filterDock.ts; user request and picks, 2026-11-15, the Progress
// Filter Dock mockup). The program and time-range filters and Compare (while
// comparing: the two programs and ✕) sit exactly where the page's rows put
// them, the page holding an unseen ghost of each in its place; as the page
// scrolls they merge into a row of small buttons at its top, Compare (✕) held
// in its corner once it gets there and the others shrinking and gliding up
// beside it with the scroll, no bounce. Scrolled back up they grow back into
// their places. The scroll is read on the UI thread off the page's own scroll
// view (useScrollOffset on its animated ref), so they move exactly with it.
//
// Every button is a GlassButton filling a box that moves and changes size, its
// ends staying round and its glass iOS's own (never faded or scaled). What's
// on it is the page's own face at its rest size, fading as it shrinks, and the
// small icon (a name, for a program) fading in. A comparing row rests in its
// card with no glass, so its glass dissolves in as it leaves (`shown`).

import { useCallback, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Reanimated, { runOnJS, useAnimatedReaction, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import GlassButton from "../GlassButton";
import { PILL_SHADOW } from "../../constants/buttons";
import {
  DOCK_GAP, DOCK_ITEM, bigFaceOpacity, dockLeadSlot, dockSlots, mergeBox, mergeProgress, mergeSpan, pinBox, smallFaceOpacity, type Box,
} from "../../utils/filterDock";

export type DockItem = {
  key: string;
  /** "pin": the corner one (Compare, ✕), held there once it reaches the row.
   *  "merge": one that shrinks into the row beside it. "lead": the left
   *  corner's (the back to where View Progress was tapped,
   *  utils/progressReturn.ts), held there as a pin is. */
  kind: "pin" | "merge" | "lead";
  /** Where it rests on the page: its box in the scroll content. Null until
   *  the page has measured it (it isn't drawn till then). */
  rest: Box | null;
  /** Its size in the row. Left out, a pill around `smallFace`, measured. */
  small?: { w: number; h: number };
  /** The page's own face for it, drawn at its rest size while it's big. A
   *  pin shows its small face throughout. */
  bigFace?: ReactNode;
  smallFace: ReactNode;
  /** No glass at rest (a comparing row, in its card): it dissolves in as the
   *  button leaves its place. */
  glassOnLeave?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

const NONE = { from: 0, to: 0 };

function DockButton({ item, rest, slot, own, leads, scroll }: {
  item: DockItem;
  rest: Box;
  slot: Box;
  own: { from: number; to: number };
  leads: { from: number; to: number }[];
  scroll: SharedValue<number>;
}) {
  const pin = item.kind !== "merge";
  const box = useAnimatedStyle(() => {
    const s = scroll.value;
    let p = 0;
    if (pin) {
      for (let i = 0; i < leads.length; i++) p = Math.max(p, mergeProgress(s, leads[i].from, leads[i].to));
    } else {
      p = mergeProgress(s, own.from, own.to);
    }
    const b = pin ? pinBox(rest, slot, s, p) : mergeBox(rest, slot, s, p);
    return { width: b.w, height: b.h, transform: [{ translateX: b.x }, { translateY: b.y }] };
  });
  const bigStyle = useAnimatedStyle(() => ({ opacity: bigFaceOpacity(mergeProgress(scroll.value, own.from, own.to)) }));
  const smallStyle = useAnimatedStyle(() => ({ opacity: smallFaceOpacity(mergeProgress(scroll.value, own.from, own.to)) }));

  // A row's glass, once it starts to leave its card (iOS dissolves it in).
  const [glassOn, setGlassOn] = useState(false);
  useAnimatedReaction(
    () => item.glassOnLeave === true && mergeProgress(scroll.value, own.from, own.to) > 0.04,
    (on, was) => { if (on !== was) runOnJS(setGlassOn)(on); },
    [item.glassOnLeave, own.from, own.to],
  );

  return (
    <Reanimated.View style={[styles.box, box]} pointerEvents="box-none">
      <GlassButton
        fill
        size={DOCK_ITEM}
        shown={item.glassOnLeave ? glassOn : undefined}
        onPress={item.onPress}
        style={StyleSheet.absoluteFill}
        solidStyle={PILL_SHADOW}
        accessibilityLabel={item.accessibilityLabel}
      >
        {/* Clipped inside the glass, never the glass itself (its swell). */}
        <View style={styles.clip}>
          {pin ? (
            <View style={styles.centre}>{item.smallFace}</View>
          ) : (
            <>
              <Reanimated.View style={[styles.bigFace, { width: rest.w, height: rest.h }, bigStyle]}>{item.bigFace}</Reanimated.View>
              <Reanimated.View style={[styles.centre, !item.small && styles.smallPad, smallStyle]}>{item.smallFace}</Reanimated.View>
            </>
          )}
        </View>
      </GlassButton>
    </Reanimated.View>
  );
}

export default function FilterDock({ items, scroll, top, right, left = 20 }: {
  items: DockItem[];
  /** The page's scroll, read on the UI thread. */
  scroll: SharedValue<number>;
  /** The row's top, in the page's frame. */
  top: number;
  /** The row's right edge (the corner button's own). */
  right: number;
  /** The page's left margin, which a long name's pill wraps short of. */
  left?: number;
}) {
  // A name's pill, measured as it'll be drawn, wrapping short of the room
  // there is (never "…", a program's name is whole).
  const [measured, setMeasured] = useState<Record<string, { w: number; h: number }>>({});
  const onMeasure = useCallback((key: string) => (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const size = { w: Math.ceil(width), h: Math.max(DOCK_ITEM, Math.ceil(height)) };
    setMeasured(prev => (prev[key]?.w === size.w && prev[key]?.h === size.h ? prev : { ...prev, [key]: size }));
  }, []);
  const toMeasure = items.filter(it => !it.small);
  const corners = items.filter(it => it.kind !== "merge").length;
  const room = right - left - corners * DOCK_ITEM - DOCK_GAP * Math.max(0, items.length - 1);
  const maxPill = toMeasure.length > 0 ? Math.max(DOCK_ITEM, Math.floor(room / toMeasure.length)) : 0;

  const sizes = items.map(it => it.small ?? measured[it.key] ?? { w: DOCK_ITEM, h: DOCK_ITEM });
  // The row from the right corner; a lead at the left, on the row's middle.
  const inRow = items.map(it => it.kind !== "lead");
  const rowSlots = dockSlots(sizes.filter((_, i) => inRow[i]), top, right);
  const rowH = sizes.reduce((m, z) => Math.max(m, z.h), 0);
  let next = 0;
  const slots = items.map((_, i) => (inRow[i] ? rowSlots[next++] : dockLeadSlot(sizes[i], top, left, rowH)));
  const spans = items.map((it, i) => (it.kind === "merge" && it.rest ? mergeSpan(it.rest.y, slots[i].y) : NONE));
  const leads = items.flatMap((it, i) => (it.kind === "merge" && it.rest ? [spans[i]] : []));
  // Drawn once every button's place on the page is known (the page shows its
  // own until then). A name's pill not yet measured is round meanwhile: at
  // rest, where it is then, the row isn't seen.
  const ready = items.every(it => it.rest);

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {toMeasure.map(it => (
        <View
          key={`measure-${it.key}`}
          onLayout={onMeasure(it.key)}
          style={[styles.measure, styles.smallPad, { maxWidth: maxPill }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {it.smallFace}
        </View>
      ))}
      {ready && items.map((it, i) => (
        <DockButton key={it.key} item={it} rest={it.rest as Box} slot={slots[i]} own={spans[i]} leads={leads} scroll={scroll} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 6 },
  box: { position: "absolute", left: 0, top: 0 },
  clip: { ...StyleSheet.absoluteFill, borderRadius: DOCK_ITEM / 2, overflow: "hidden" },
  bigFace: { position: "absolute", left: 0, top: 0 },
  centre: { ...StyleSheet.absoluteFill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  // A name's pill: its words in from the round ends.
  smallPad: { paddingHorizontal: 14 },
  measure: { position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row", alignItems: "center", gap: 8, minHeight: DOCK_ITEM, paddingVertical: 6 },
});
