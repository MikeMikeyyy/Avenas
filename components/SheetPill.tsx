// One button in a bottom sheet: the app's pill (constants/buttons.ts) in the
// same four treatments the Trainer page's buttons use, so every sheet reads as
// one stack of buttons rather than a column of cards with a pill under it.
//
//   default  control surface + soft shadow (a choice: a day, "Edit", "Custom Workout")
//   primary  accent fill + accent glow (the sheet's main action)
//   danger   red fill + centred halo (Delete)
//   quiet    translucent fill, no lift (Cancel)
//
// An on/off SETTING in a sheet is a SheetToggle (below), not one of these.

import type { ReactNode } from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type AccessibilityRole, type AccessibilityState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import BounceButton from "./BounceButton";
import { APP_DARK, APP_LIGHT, ACCT, ACCT_DEEP, DANGER_BRIGHT, FontFamily } from "../constants/theme";
import { haloGlow, pill, pillGlow, PILL_H_SM, PILL_H_XS, PILL_SHADOW } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";
import AppSwitch from "./AppSwitch";

export type SheetPillVariant = "default" | "primary" | "danger" | "quiet";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: SheetPillVariant;
  /** Drawn in the label's colour, so it follows the variant, `tint` and
   *  `selected` without the caller working that out. */
  icon?: (color: string) => ReactNode;
  /** A second line under the label (a program's days). Makes the pill taller. */
  sub?: string;
  /** Label + icon colour on a default pill (Mark Complete in accent, etc.). */
  tint?: string;
  /** The current choice: accent label, accent ring and a tick. */
  selected?: boolean;
  /** Dimmed and inert (a confirm with nothing to confirm yet). */
  disabled?: boolean;
  /** Shorter pill, smaller label: a list of them inside a card (the Progress
   *  page's exercises) rather than a sheet's stack of actions. */
  compact?: boolean;
  /** Drawn after the label, e.g. the Progress page's "Swapped out" tag. */
  badge?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Defaults to the label (plus `sub`). */
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
}

export default function SheetPill({
  label, onPress, variant = "default", icon, sub, tint, selected, disabled, compact, badge, style,
  accessibilityLabel, accessibilityRole = "button", accessibilityState,
}: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const filled = variant === "primary" || variant === "danger";
  const color = filled ? "#fff" : selected ? ACCT : (tint ?? t.tp);
  const surface: ViewStyle =
    variant === "primary" ? { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }
    : variant === "danger" ? { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT) }
    : variant === "quiet" ? { backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)" }
    : { backgroundColor: t.ctrl, ...PILL_SHADOW };

  return (
    <BounceButton
      style={style}
      onPress={disabled ? undefined : onPress}
      accessibilityLabel={accessibilityLabel ?? (sub ? `${label}, ${sub}` : label)}
      accessibilityRole={accessibilityRole}
      accessibilityState={disabled ? { ...accessibilityState, disabled: true } : accessibilityState}
    >
      <View style={[
        s.pill, surface,
        compact ? s.compact : null,
        sub ? s.tall : null,
        selected ? s.selected : null,
        disabled ? s.disabled : null,
      ]}>
        {icon?.(color)}
        <View style={s.label}>
          <Text style={[s.text, compact ? s.compactText : null, { color }]} numberOfLines={1}>{label}</Text>
          {sub ? <Text style={[s.sub, { color: t.ts }]} numberOfLines={1}>{sub}</Text> : null}
        </View>
        {badge}
        {selected ? <Ionicons name="checkmark-circle" size={compact ? 16 : 18} color={ACCT} /> : null}
      </View>
    </BounceButton>
  );
}

/**
 * An on/off setting inside a sheet (the Workout tab's Focus Mode).
 *
 * Not a plain SheetPill: a setting isn't an action, and drawn as one it passed
 * for another button beside Change Workout Day. It carries an OUTLINE (grey off,
 * accent on) and a tinted fill when on, with icon, label and switch centred as
 * one group like the pills around it. The whole pill is the toggle.
 *
 * Light mode is what shaped it. The pill keeps the solid control fill and shadow
 * when off (an outline alone on the pale sheet was fainter than the white
 * buttons it sat under). The switch is the Settings page's (AppSwitch): iOS's
 * own at full size, off track SWITCH_TRACK_LIGHT in light mode, and live, so
 * touching it gets the same glass knob.
 */
export function SheetToggle({ label, icon, value, onChange }: {
  label: string;
  icon?: (color: string) => ReactNode;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // ACCT washes out as text on the light sheet; ACCT_DEEP is its light-mode ink.
  const color = value ? (isDark ? ACCT : ACCT_DEEP) : t.tp;

  return (
    <BounceButton
      onPress={() => onChange(!value)}
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[
        s.pill, s.toggle,
        value
          ? { backgroundColor: `${ACCT}24`, borderColor: ACCT }
          : { backgroundColor: t.ctrl, borderColor: t.ts, ...PILL_SHADOW },
      ]}>
        {icon?.(color)}
        <Text style={[s.text, { color }]} numberOfLines={1}>{label}</Text>
        {/* Exactly the Settings page's switch, colours and all, and it takes
            its OWN taps: iOS's glassy knob only appears while the switch
            itself is touched or dragged, so as display-only (the pill toggling
            it) it just slid, unlike Settings. Claiming the responder here keeps
            the pill's press from also firing, which would flip it straight
            back. A tap anywhere else on the pill still toggles it. */}
        <View
          onStartShouldSetResponder={() => true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <AppSwitch
            value={value}
            onValueChange={next => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(next);
            }}
          />
        </View>
      </View>
    </BounceButton>
  );
}

const s = StyleSheet.create({
  pill:         { ...pill(PILL_H_SM), gap: 8, paddingHorizontal: 20 },
  tall:         { minHeight: 56, paddingVertical: 8 },
  compact:      { minHeight: PILL_H_XS, paddingHorizontal: 16 },
  compactText:  { fontSize: 14 },
  selected:     { borderWidth: 1.5, borderColor: ACCT },
  disabled:     { opacity: 0.35 },
  label:        { flexShrink: 1, alignItems: "center" },
  text:         { fontFamily: FontFamily.bold, fontSize: 16, letterSpacing: 0.2 },
  sub:          { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  toggle:       { borderWidth: 1.5, gap: 10 },
});
