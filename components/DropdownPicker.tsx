import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

interface Option<T extends string> {
  key: T;
  /** Shown as the row label inside the bottom sheet. */
  label: string;
  /** Shown on the trigger button (falls back to `label` if omitted). */
  shortLabel?: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  /** Title shown at the top of the sheet (e.g. "Time range"). */
  sheetTitle?: string;
  /**
   * When set, the trigger renders as an icon-only NeuCard button using this
   * Ionicons name (no current-value text). Used by the Strength card's compact
   * top-right toggle.
   */
  triggerIcon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Trigger button + slide-up bottom sheet for picking one of N options.
 * Matches the visual / motion language of ProgramScopePicker.
 */
export default function DropdownPicker<T extends string>({
  value,
  options,
  onChange,
  sheetTitle = "Select",
  triggerIcon,
}: Props<T>) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const slideY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      slideY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slideY, {
          toValue: 600,
          duration: 260,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, mounted, slideY, backdropOpacity]);

  const current = options.find(o => o.key === value) ?? options[0];

  return (
    <>
      <BounceButton
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${sheetTitle}: ${current.label}. Tap to change.`}
      >
        <NeuCard dark={isDark} radius={12} shadowSize="sm">
          {triggerIcon ? (
            <View style={styles.iconBtn}>
              <Ionicons name={triggerIcon} size={18} color={t.ts} />
            </View>
          ) : (
            <View style={styles.btn}>
              <Text style={[styles.btnText, { color: t.tp }]} numberOfLines={1}>
                {current.shortLabel ?? current.label}
              </Text>
              <Ionicons name="chevron-down" size={14} color={t.ts} />
            </View>
          )}
        </NeuCard>
      </BounceButton>

      <Modal visible={mounted} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdropOpacity },
              ]}
            />
          </TouchableWithoutFeedback>

          <View style={styles.sheetWrap} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: t.bg,
                  paddingBottom: insets.bottom + 16,
                  transform: [{ translateY: slideY }],
                },
              ]}
            >
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
              </View>
              <Text style={[styles.sheetTitle, { color: t.tp }]}>{sheetTitle}</Text>

              {options.map(opt => {
                const selected = opt.key === value;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    activeOpacity={0.85}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setOpen(false);
                      if (opt.key !== value) onChange(opt.key);
                    }}
                    style={styles.rowOuter}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <NeuCard
                      dark={isDark}
                      radius={14}
                      shadowSize="sm"
                      innerStyle={selected ? { borderWidth: 0 } : undefined}
                    >
                      <View style={styles.rowInner}>
                        <Text style={[styles.rowLabel, { color: t.tp }]} numberOfLines={1}>
                          {opt.label}
                        </Text>
                        {selected ? <Ionicons name="checkmark" size={20} color={ACCT} /> : null}
                      </View>
                    </NeuCard>
                    {selected ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          top: 0, left: 0, right: 0, bottom: 0,
                          borderRadius: 14,
                          borderWidth: 1.5,
                          borderColor: ACCT,
                        }}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </Animated.View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  btnText: {
    fontFamily: FontFamily.semibold,
    fontSize: 12,
  },
  iconBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    paddingVertical: 7,
  },

  sheetWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  handleWrap: {
    paddingVertical: 12,
    alignItems: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(128,128,128,0.4)",
  },
  sheetTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    marginTop: 4,
    marginBottom: 16,
    marginLeft: 4,
  },
  rowOuter: {
    marginBottom: 10,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowLabel: {
    fontFamily: FontFamily.semibold,
    fontSize: 16,
    flex: 1,
  },
});
