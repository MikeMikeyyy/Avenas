// The floating pair at the bottom of a program view: the builder on the left,
// Summary on the right.
//
// Same geometry, colours and positions as the program builder's own pair (the
// slate Create pill and the accent Summary pill), because they do the same two
// jobs — take me to the editor, show me the whole thing at a glance — and a
// person moving between "my programs" and a program someone sent shouldn't have
// to look for them twice. Summary carries the accent glow; the builder button is
// slate, since a coloured glow on both makes neither read as primary. On iOS 26
// both are tinted glass (components/GlassButton.tsx), lit by the glass instead.
//
// Left side is omitted when there's nothing to edit: a program someone sent you
// isn't yours to open in the builder until you've accepted it.

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import GlassButton from "./GlassButton";
import SquarePenIcon from "./SquarePenIcon";
import { APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";
import { darkGlow, haloGlow, PILL_H_SM } from "../constants/buttons";

export default function ProgramActionFabs({ bottom, isDark, onOpenBuilder, onOpenSummary }: {
  /** Distance from the bottom of the screen, safe-area already included. */
  bottom: number;
  isDark: boolean;
  /** Omit for a program the viewer can't edit — the left pill isn't rendered. */
  onOpenBuilder?: () => void;
  onOpenSummary: () => void;
}) {
  const slate = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const slateContent = isDark ? APP_DARK.bg : "#fff";

  return (
    <>
      {onOpenBuilder && (
        <View style={[styles.left, { bottom }]}>
          <GlassButton
            pill
            size={PILL_H_SM}
            tint={slate}
            onPress={onOpenBuilder}
            contentStyle={styles.fab}
            solidStyle={styles.slateLift}
            accessibilityLabel="Open in program builder"
          >
            <SquarePenIcon size={16} color={slateContent} />
            <Text style={[styles.fabText, { color: slateContent }]}>Open in Builder</Text>
          </GlassButton>
        </View>
      )}

      <View style={[styles.right, { bottom }]}>
        <GlassButton
          pill
          size={PILL_H_SM}
          tint={ACCT}
          onPress={onOpenSummary}
          contentStyle={styles.fab}
          solidStyle={[styles.summaryGlow, darkGlow(styles.summaryGlow, isDark)]}
          accessibilityLabel="Workout summary"
        >
          <Ionicons name="list" size={16} color="#fff" />
          <Text style={[styles.fabText, { color: "#fff" }]}>Summary</Text>
        </GlassButton>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  left:  { position: "absolute", left: 20, zIndex: 8 },
  right: { position: "absolute", right: 20, zIndex: 8 },
  fab:        { paddingHorizontal: 18, gap: 6 },
  fabText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
  // The solid pills' glows; the glass ones are lit by the glass.
  summaryGlow: haloGlow(ACCT, 0.6, 12),
  slateLift:   { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
});
