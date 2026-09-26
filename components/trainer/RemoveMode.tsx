// "Remove a Trainer" on the My Trainers pages (trainer and gym-user sides).
//
// It used to open an alert listing every trainer as a button, which stops
// working past a few trainers: the list outgrows the alert and the names read
// as one undifferentiated column. Instead the page goes into a remove mode: a
// red minus on each trainer's own card, and this bar above the list saying so,
// with Done to leave it. A minus still asks "are you sure" before anything
// happens (the page's own remove confirm).

import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import BounceButton from "../BounceButton";
import { APP_DARK, APP_LIGHT, DANGER_BRIGHT, FontFamily } from "../../constants/theme";
import { haloGlow, pill, PILL_H_XS, PILL_SHADOW } from "../../constants/buttons";

/** Above the list while removing: what to do, and Done to stop. */
export function RemoveModeBar({ isDark, onDone }: { isDark: boolean; onDone: () => void }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.bar}>
      <Text style={[styles.hint, { color: t.ts }]}>Tap the red button on a trainer to remove them.</Text>
      <BounceButton onPress={onDone} accessibilityRole="button" accessibilityLabel="Done removing trainers">
        <View style={[styles.done, { backgroundColor: t.ctrl, ...PILL_SHADOW }]}>
          <Text style={[styles.doneText, { color: t.tp }]}>Done</Text>
        </View>
      </BounceButton>
    </Animated.View>
  );
}

/** The red minus on a trainer's card while removing. It disconnects on the
 *  server, so it needs a connection (dims offline and says why). */
export function RemoveCircleButton({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  return (
    <Animated.View entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)}>
      <BounceButton onPress={onPress} needsConnection accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <View style={[styles.circle, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }]}>
          <View style={styles.minus} />
        </View>
      </BounceButton>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar:      { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  hint:     { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  done:     { ...pill(PILL_H_XS), paddingHorizontal: 18 },
  doneText: { fontFamily: FontFamily.bold, fontSize: 14 },
  circle:   { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  minus:    { width: 13, height: 2.5, borderRadius: 1.25, backgroundColor: "#fff" },
});
