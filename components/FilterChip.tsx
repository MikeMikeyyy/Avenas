// A chip in a row of filters: the exercise picker's muscle groups (and its
// Favourites), the Journal's session numbers. Glass on iOS 26
// (components/GlassButton.tsx), a picked one coloured glass, the accent green
// unless it says otherwise (user request, 2026-10-23: the grey chips read as
// greyed out). Below 26 it's the chip they were: grey, a picked one filled
// with its colour and glowing.
//
// A row of these must never sit under a fading parent: an ExpandReveal round
// one leaves out its `fade` (the Journal's session chips).

import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";

import GlassButton, { GLASS } from "./GlassButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

/** A chip's height: its words' line (18) and 7 above and below. */
export const CHIP_H = 32;

export default function FilterChip({
  label, picked, onPress, color = ACCT, pickedInk = "#fff", glowOpacity = 0.5, icon, accessibilityLabel,
}: {
  label: string;
  picked: boolean;
  onPress: () => void;
  /** A picked chip's glass, and the solid picked chip's fill and glow. */
  color?: string;
  /** The words on a picked chip: white, or a dark ink on a light colour (the
   *  Favourites gold, where white sits at about 1.9:1). */
  pickedInk?: string;
  /** How strong the solid picked chip's glow is. */
  glowOpacity?: number;
  /** Drawn before the words, in their colour (the Favourites star). */
  icon?: (ink: string) => ReactNode;
  accessibilityLabel?: string;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // The page's ink on glass, so an unpicked chip reads as a button rather than
  // greyed out; the quieter grey on the solid chip's grey, as it always was.
  const ink = picked ? pickedInk : GLASS ? t.tp : t.ts;
  return (
    <GlassButton
      pill
      size={CHIP_H}
      tint={picked ? color : undefined}
      onPress={onPress}
      contentStyle={icon ? styles.withIcon : styles.chip}
      solidStyle={picked
        ? { shadowColor: color, shadowOffset: { width: 0, height: 3 }, shadowOpacity: glowOpacity, shadowRadius: 8 }
        : { backgroundColor: t.div }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: picked }}
    >
      {icon?.(ink)}
      <Text style={[styles.text, { color: ink }]}>{label}</Text>
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 14 },
  // A little less on the left, where the icon brings its own space.
  withIcon: { gap: 5, paddingLeft: 11, paddingRight: 14 },
  text: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18 },
});
