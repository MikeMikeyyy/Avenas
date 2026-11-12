// The floating pair at the bottom of a program view: the builder on the left,
// Summary on the right.
//
// Same geometry, colours and positions as the program builder's own pair (the
// slate Create pill and the Summary pill, which is this file's SummaryPill),
// because they do the same two jobs — take me to the editor, show me the whole
// thing at a glance — and a person moving between "my programs" and a program
// someone sent shouldn't have to look for them twice. The builder button is
// slate, the primary; Summary is clear (user request, 2026-11-12: it was
// green everywhere, review included, which read as the thing to press). On
// iOS 26 both are glass (components/GlassButton.tsx), the builder's tinted.
//
// Left side is omitted when there's nothing to edit: a program someone sent you
// isn't yours to open in the builder until you've accepted it.

import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { type AnimatedStyle } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import GlassButton from "./GlassButton";
import SquarePenIcon from "./SquarePenIcon";
import { APP_DARK, APP_LIGHT, FontFamily, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";
import { PILL_H_SM, PILL_SHADOW } from "../constants/buttons";

/** The floating Summary pill: clear glass with the page's ink (below iOS 26,
 *  the white control with its soft shadow, as the New pill on My Programs),
 *  never a colour (user request, 2026-11-12). The program views' pair and the
 *  builder's Step 2 both draw this one. */
export function SummaryPill({ isDark, onPress }: { isDark: boolean; onPress: () => void }) {
  const ink = (isDark ? APP_DARK : APP_LIGHT).tp;
  return (
    <GlassButton
      pill
      size={PILL_H_SM}
      onPress={onPress}
      contentStyle={styles.fab}
      solidStyle={PILL_SHADOW}
      accessibilityLabel="Workout summary"
    >
      <Ionicons name="list" size={16} color={ink} />
      <Text style={[styles.fabText, { color: ink }]}>Summary</Text>
    </GlassButton>
  );
}

/** The slate "Open in Builder" pill on its own, for a place that shows the
 *  same program read-only (My Programs' Program Summary, at the foot of a
 *  program's ··· sheet; user request, 2026-11-12). */
export function OpenInBuilderPill({ isDark, onPress }: { isDark: boolean; onPress: () => void }) {
  const slate = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const slateContent = isDark ? APP_DARK.bg : "#fff";
  return (
    <GlassButton
      pill
      size={PILL_H_SM}
      tint={slate}
      onPress={onPress}
      contentStyle={styles.fab}
      solidStyle={styles.slateLift}
      accessibilityLabel="Open in program builder"
    >
      <SquarePenIcon size={16} color={slateContent} />
      <Text style={[styles.fabText, { color: slateContent }]}>Open in Builder</Text>
    </GlassButton>
  );
}

export default function ProgramActionFabs({ bottom, isDark, onOpenBuilder, onOpenSummary, liftStyle }: {
  /** Distance from the bottom of the screen, safe-area already included. */
  bottom: number;
  isDark: boolean;
  /** Omit for a program the viewer can't edit — the left pill isn't rendered. */
  onOpenBuilder?: () => void;
  onOpenSummary: () => void;
  /** Stands the pair on the workout bar while it shows, with the page's other
   *  pinned buttons (usePinnedLift, hooks/useFloatingBars.ts). */
  liftStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
}) {
  return (
    <>
      {onOpenBuilder && (
        <Reanimated.View style={[styles.left, { bottom }, liftStyle]}>
          <OpenInBuilderPill isDark={isDark} onPress={onOpenBuilder} />
        </Reanimated.View>
      )}

      <Reanimated.View style={[styles.right, { bottom }, liftStyle]}>
        <SummaryPill isDark={isDark} onPress={onOpenSummary} />
      </Reanimated.View>
    </>
  );
}

const styles = StyleSheet.create({
  left:  { position: "absolute", left: 20, zIndex: 8 },
  right: { position: "absolute", right: 20, zIndex: 8 },
  fab:        { paddingHorizontal: 18, gap: 6 },
  fabText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
  // The solid slate pill's shadow; the glass one is lit by the glass.
  slateLift:   { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
});
