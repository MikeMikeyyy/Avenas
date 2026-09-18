// The floating pair at the bottom of a program view: the builder on the left,
// Summary on the right.
//
// Same geometry, colours and positions as the program builder's own pair (the
// slate Create pill and the accent Summary pill), because they do the same two
// jobs — take me to the editor, show me the whole thing at a glance — and a
// person moving between "my programs" and a program someone sent shouldn't have
// to look for them twice. Summary carries the accent glow; the builder button is
// slate, since a coloured glow on both makes neither read as primary.
//
// Left side is omitted when there's nothing to edit: a program someone sent you
// isn't yours to open in the builder until you've accepted it.

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import BounceButton from "./BounceButton";
import { APP_DARK, FontFamily, ACCT, BTN_SLATE, BTN_SLATE_DARK } from "../constants/theme";

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
          <BounceButton
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenBuilder(); }}
            accessibilityLabel="Open in program builder"
            accessibilityRole="button"
          >
            <View style={[styles.slateWrap, { backgroundColor: slate }]}>
              <View style={[styles.fab, { backgroundColor: slate }]}>
                <Ionicons name="create-outline" size={16} color={slateContent} />
                <Text style={[styles.fabText, { color: slateContent }]}>Open in Builder</Text>
              </View>
            </View>
          </BounceButton>
        </View>
      )}

      <View style={[styles.right, { bottom }]}>
        <BounceButton
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenSummary(); }}
          accessibilityLabel="Workout summary"
          accessibilityRole="button"
        >
          <View style={styles.summaryWrap}>
            <View style={[styles.fab, { backgroundColor: ACCT }]}>
              <Ionicons name="list" size={16} color="#fff" />
              <Text style={[styles.fabText, { color: "#fff" }]}>Summary</Text>
            </View>
          </View>
        </BounceButton>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  left:  { position: "absolute", left: 20, zIndex: 8 },
  right: { position: "absolute", right: 20, zIndex: 8 },
  fab:        { borderRadius: 50, paddingVertical: 12, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 6 },
  fabText:    { fontFamily: FontFamily.semibold, fontSize: 14 },
  // The glow sits on a wrapper rather than the pill itself so the pill can clip
  // its own contents without clipping the shadow.
  summaryWrap: { borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  slateWrap:   { borderRadius: 50, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
});
