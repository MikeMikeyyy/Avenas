// A first-time guide: a card centred over a dim, drawn as every pop-up is
// (components/SheetChrome.tsx): glass on iOS 26 with the X in its corner, which
// counts as Got it, the raised card below it (user picks, 2026-10-30). Its
// pieces (title, words, a demo, Got it) keep every guide alike.
//
// GuideOverlay fills whatever it's drawn over. The builder's guides put it in
// a Modal of their own; a guide over a sheet (the reorder sheet's) goes in the
// sheet's own Modal through SimpleSheet's `over`, since a second RN Modal
// can't present over the first. The card grows in and the dim fades on a
// layer of its own: glass draws wrongly under a fading parent.

import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Reanimated, { Easing, FadeIn, Keyframe } from "react-native-reanimated";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import { GLASS } from "./GlassButton";
import { SHEET_DIM, SheetCloseButton, SheetGlass } from "./SheetChrome";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, ON_FILL } from "../constants/theme";
import { darkGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";

/** The glass card's corners, rounder than the raised card's 24. */
const GLASS_RADIUS = 32;

const GROW_IN = new Keyframe({
  0: { transform: [{ scale: 0.92 }] },
  100: { transform: [{ scale: 1 }], easing: Easing.out(Easing.cubic) },
}).duration(220);

/** The guide's card over its dim. A tap on the dim closes it, as its X does. */
export function GuideOverlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { isDark } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <Reanimated.View entering={FadeIn.duration(200)} style={[StyleSheet.absoluteFill, styles.dim]} />
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessible={false} />
      <Reanimated.View entering={GROW_IN} style={styles.card}>
        {GLASS ? (
          <View style={styles.inner}>
            <SheetGlass radius={GLASS_RADIUS} />
            {children}
          </View>
        ) : (
          <NeuCard dark={isDark} radius={24} innerStyle={styles.inner}>
            {children}
          </NeuCard>
        )}
        <SheetCloseButton onPress={onClose} />
      </Reanimated.View>
    </View>
  );
}

export function GuideTitle({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  return <Text style={[styles.title, { color: (isDark ? APP_DARK : APP_LIGHT).tp }]}>{children}</Text>;
}

export function GuideBody({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  return <Text style={[styles.body, { color: (isDark ? APP_DARK : APP_LIGHT).ts }]}>{children}</Text>;
}

/** What the guide is about, drawn small between its words and Got it. */
export function GuideDemo({ children }: { children: ReactNode }) {
  return <View style={styles.demo}>{children}</View>;
}

export function GuideGotIt({ onPress }: { onPress: () => void }) {
  const { isDark } = useTheme();
  return (
    <BounceButton onPress={onPress} accessibilityLabel="Got it" accessibilityRole="button">
      <View style={[styles.btnWrap, darkGlow(styles.btnWrap, isDark)]}>
        <View style={styles.btn}>
          <Text style={styles.btnText}>Got it</Text>
        </View>
      </View>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  dim:      { backgroundColor: SHEET_DIM },
  card:     { width: "100%", maxWidth: 360 },
  inner:    { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20 },
  title:    { fontFamily: FontFamily.bold, fontSize: 19, textAlign: "center" },
  body:     { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  demo:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 18, marginBottom: 22 },
  btnWrap:  { borderRadius: 50, backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12 },
  btn:      { borderRadius: 50, backgroundColor: ACCT, paddingVertical: 15, alignItems: "center" },
  btnText:  { fontFamily: FontFamily.semibold, fontSize: 16, color: ON_FILL },
});
