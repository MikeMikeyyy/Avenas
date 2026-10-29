// components/trainer/ProgramRow.tsx
//
// One program on the Trainer tab's program pages: the trainer's Programs page
// (app/trainer/programs.tsx) and a gym user's "From [trainer]" and "Sent for
// Review" pages (app/trainer/received.tsx, app/trainer/sent-reviews.tsx), so
// every program on either side of the tab opens the same way (user decisions,
// 2026-10-21, the Trainer Page canvas).
//
// A row is one line: the program, a line under it, then its one button or where
// it stands. Tapping it opens it in place (the shared ExpandReveal motion) on
// its cycle and the rest of what can be done with it. Rows sit one under the
// other in a single card, with a line between them.
//
// No Reanimated layout animation on any ancestor: a layout animation freezes the
// UI-thread height tween inside ExpandReveal, which is the whole animation.

import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";

import BounceButton from "../BounceButton";
import ChevronToggle from "../ChevronToggle";
import ExpandReveal, { useReveal } from "../ExpandReveal";
import TrashIcon from "../TrashIcon";
import { ACCT, APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily } from "../../constants/theme";
import { haloGlow, pillGlow, PILL_RADIUS, PILL_SHADOW } from "../../constants/buttons";
import { CARD_META, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, REVEAL_BLEED } from "../../constants/cards";
import { useTheme } from "../../contexts/ThemeContext";

/** A program's cycle, day by day: what a row shows once it's open. */
export function CycleStrip({ cycle }: { cycle: string[] }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (cycle.length === 0) return null;
  return (
    <View style={styles.cycleGrid}>
      {cycle.map((day, i) => {
        const isTraining = day !== "Rest" && day !== "";
        return (
          <View
            key={i}
            style={[
              styles.cycleChip,
              isTraining
                ? { backgroundColor: `${ACCT}22`, borderColor: ACCT, borderWidth: 1 }
                : { backgroundColor: t.div },
            ]}
          >
            <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]} numberOfLines={1}>
              {day || "Rest"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The green Accept on a row that's waiting on me, its own button: white
 *  words, as the app's other green buttons (user decision, 2026-10-21). On a
 *  gym user's Programs page and a trainer's. */
export function AcceptButton({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  const { isDark } = useTheme();
  return (
    <BounceButton onPress={onPress} needsConnection accessibilityLabel={accessibilityLabel}>
      <View style={[rowButtonStyles.pill, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
        <Text style={rowButtonStyles.text}>Accept</Text>
      </View>
    </BounceButton>
  );
}

/** The pair a row shows once it's open: a white button and the red Remove,
 *  the same width, as the cards before them had. `accept` puts a green button
 *  between them: Accept, for a row whose own button isn't Accept (a group's
 *  program sent to a trainer of it, opened from its Programs page), or its
 *  `label` (Send, on a trainer's program from someone else, to pass it on). */
export function RowActions({ label, onOpen, onRemove, accessibilityLabel, removeLabel, removeNeedsConnection = true, accept }: {
  label: string;
  onOpen: () => void;
  onRemove: () => void;
  accessibilityLabel: string;
  removeLabel: string;
  /** False when Remove only hides it on this phone, which needs no signal. */
  removeNeedsConnection?: boolean;
  accept?: { onPress: () => void; accessibilityLabel: string; label?: string };
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={styles.actionRow}>
      <BounceButton style={{ flex: 1 }} onPress={onOpen} accessibilityLabel={accessibilityLabel}>
        <View style={[styles.actionBtn, { backgroundColor: t.ctrl }]}>
          <Text style={[styles.actionText, { color: t.tp }]}>{label}</Text>
        </View>
      </BounceButton>
      {accept ? (
        <BounceButton style={{ flex: 1 }} onPress={accept.onPress} needsConnection accessibilityLabel={accept.accessibilityLabel}>
          <View style={[styles.actionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
            <Text style={[styles.actionText, { color: "#fff" }]}>{accept.label ?? "Accept"}</Text>
          </View>
        </BounceButton>
      ) : null}
      <BounceButton style={{ flex: 1 }} onPress={onRemove} needsConnection={removeNeedsConnection} accessibilityLabel={removeLabel}>
        <View style={[styles.actionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT, 0.5, 6, isDark) }]}>
          <TrashIcon size={16} color="#fff" />
          <Text style={[styles.actionText, { color: "#fff" }]}>Remove</Text>
        </View>
      </BounceButton>
    </View>
  );
}

/** Where a program stands, as a small tinted pill: green once it's done (sent
 *  back, accepted), quiet while it waits. */
export function StatusPill({ label, done }: { label: string; done: boolean }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={[styles.statusPill, { backgroundColor: done ? `${ACCT}22` : t.div }]}>
      <Text style={[styles.statusText, { color: done ? ACCT : t.ts }]}>{label}</Text>
    </View>
  );
}

/**
 * One row. Its own component so it can hold a `useReveal` (a hook can't live
 * inside the map). The caller plays the tap's haptic, as it holds which rows
 * are open.
 */
export default function ProgramRow({ first, open, onToggle, accessibilityLabel, leading, title, meta, trailing, hideTrailingWhenOpen = false, children }: {
  /** The first row in its card has no line above it. */
  first: boolean;
  open: boolean;
  onToggle: () => void;
  /** What the row is, for VoiceOver, before "expand" or "collapse". */
  accessibilityLabel: string;
  /** An avatar, for a row that's from someone. */
  leading?: ReactNode;
  title: string;
  meta: string;
  /** Its one button, or where it stands. */
  trailing?: ReactNode;
  /** The button is the same one the open row shows bigger: fade it out as the
   *  row opens. It keeps its space, so the title doesn't jump. */
  hideTrailingWhenOpen?: boolean;
  /** What opening it shows. */
  children: ReactNode;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const reveal = useReveal();
  useEffect(() => { reveal.setOpen(open); }, [open, reveal]);
  const fade = reveal.fade;
  const trailingStyle = useAnimatedStyle(() => ({ opacity: hideTrailingWhenOpen ? 1 - fade.value : 1 }));
  const trailingHidden = hideTrailingWhenOpen && open;

  return (
    <View style={!first && { borderTopWidth: 1, borderTopColor: t.div }}>
      <Pressable
        onPress={onToggle}
        style={styles.rowInner}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${accessibilityLabel}, ${open ? "collapse" : "expand"}`}
      >
        <View style={styles.rowTop}>
          {leading}
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: t.tp }]} numberOfLines={1}>{title}</Text>
            <Text style={[styles.rowMeta, { color: t.ts }]} numberOfLines={1}>{meta}</Text>
          </View>
          {trailing != null && (
            // Hidden, a tap where it was falls through to the row and closes it.
            <Reanimated.View
              style={trailingStyle}
              pointerEvents={trailingHidden ? "none" : "auto"}
              accessibilityElementsHidden={trailingHidden}
              importantForAccessibility={trailingHidden ? "no-hide-descendants" : "auto"}
            >
              {trailing}
            </Reanimated.View>
          )}
          <ChevronToggle expanded={open} color={t.ts} upDown />
        </View>
        {/* bleed: room for the buttons' glow inside the reveal's clip, which
            otherwise cut it off in a straight line (constants/cards.ts). */}
        <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} bleed={REVEAL_BLEED} contentStyle={styles.revealBody}>
          {children}
        </ExpandReveal>
      </Pressable>
    </View>
  );
}

/** The row's own button (the trainer's white Review, a gym user's green
 *  Accept): a small filled pill. A coloured one has white words and its own
 *  colour's glow; the white one overrides both. */
export const rowButtonStyles = StyleSheet.create({
  pill: { height: 32, borderRadius: PILL_RADIUS, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  text: { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
});

const styles = StyleSheet.create({
  rowInner: { paddingHorizontal: 14, paddingVertical: 12 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { ...CARD_TITLE },
  rowMeta: { ...CARD_META },
  statusPill: { ...CARD_PILL },
  statusText: { ...CARD_PILL_TEXT },
  // No `gap` on the row: a closed ExpandReveal is a zero-height child, and a gap
  // would hold space open around it. The reveal's content carries its own top.
  revealBody: { gap: 10, paddingTop: 12 },
  cycleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip: { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10 },
  // Pills rather than NeuCards: these sit INSIDE a card, and a raised button on
  // a raised card reads as two stacked surfaces.
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, minHeight: 38, borderRadius: PILL_RADIUS, ...PILL_SHADOW },
  actionText: { fontFamily: FontFamily.bold, fontSize: 14 },
});
