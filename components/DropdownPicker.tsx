import { useState, useEffect, useRef, ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BounceButton from "./BounceButton";
import SheetPill from "./SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { pill, PILL_H_CHIP, PILL_SHADOW } from "../constants/buttons";
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
   * When set, the trigger renders as an icon-only round button using this
   * Ionicons name (no current-value text). Used by the Strength card's compact
   * top-right toggle.
   */
  triggerIcon?: keyof typeof Ionicons.glyphMap;
  /**
   * Optional leading icon for each sheet row. Takes the option key so the
   * caller can mirror whatever icon it shows elsewhere for that value (the
   * Strength card reuses its header's per-metric icons here).
   */
  renderOptionIcon?: (key: T) => ReactNode;
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
  renderOptionIcon,
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
        {/* The app's pill button (constants/buttons.ts), the same white pill on
            the control surface as the buttons in its sheet (SheetPill), so the
            button and the popup it opens read as one family. The icon-only
            trigger is that pill at equal width and height: a round button. */}
        <View style={[triggerIcon ? styles.iconBtn : styles.btn, { backgroundColor: t.ctrl }]}>
          {triggerIcon ? (
            <Ionicons name={triggerIcon} size={16} color={t.tp} />
          ) : (
            <>
              <Text style={[styles.btnText, { color: t.tp }]} numberOfLines={1}>
                {current.shortLabel ?? current.label}
              </Text>
              <Ionicons name="chevron-down" size={13} color={t.ts} />
            </>
          )}
        </View>
      </BounceButton>

      <Modal visible={mounted} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={() => setOpen(false)}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
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

              <View style={styles.list}>
                {options.map(opt => {
                  const selected = opt.key === value;
                  return (
                    <SheetPill
                      key={opt.key}
                      label={opt.label}
                      selected={selected}
                      // The caller's own icon for this value (the Strength card's
                      // per-metric icons), in its own colours.
                      icon={renderOptionIcon ? () => renderOptionIcon(opt.key) : undefined}
                      onPress={() => {
                        setOpen(false);
                        if (opt.key !== value) onChange(opt.key);
                      }}
                      accessibilityState={{ selected }}
                    />
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    ...pill(PILL_H_CHIP),
    gap: 5,
    paddingHorizontal: 13,
    ...PILL_SHADOW,
  },
  btnText: {
    fontFamily: FontFamily.bold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  iconBtn: {
    ...pill(PILL_H_CHIP),
    width: PILL_H_CHIP,
    paddingHorizontal: 0,
    ...PILL_SHADOW,
  },

  sheetWrap: {
    ...StyleSheet.absoluteFill,
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
  list: {
    gap: 12,
  },
});
