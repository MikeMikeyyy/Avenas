// The red delete button: a red circle with a white bin and a soft red glow,
// for a control that deletes or removes something (DANGER_BRIGHT, the delete
// red). The size of the exercise picker's own red delete beside a custom
// exercise, so the two look the same. It only draws the button: what it
// deletes, and asking first, are the caller's.

import { StyleSheet, View } from "react-native";

import BounceButton from "./BounceButton";
import TrashIcon from "./TrashIcon";
import { Ionicons } from "@expo/vector-icons";
import { DANGER_BRIGHT, ON_FILL } from "../constants/theme";
import { haloGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";

/** Its diameter; beside it, a pill of the same height lines up with it. */
export const DELETE_CIRCLE_SIZE = 32;
/** The minus one's: smaller, beside a set's row (user request, 2026-10-30). */
export const MINUS_CIRCLE_SIZE = 26;

export default function DeleteCircleButton({ onPress, accessibilityLabel, disabled, minus }: {
  onPress: () => void;
  accessibilityLabel: string;
  /** Nothing to delete just now (an exercise's last working set): dimmed, and
   *  it takes no taps, so it doesn't bounce as if it had done something. */
  disabled?: boolean;
  /** A minus in place of the bin, for taking one of several out (a set from
   *  an exercise, user request 2026-10-30) rather than deleting a thing. */
  minus?: boolean;
}) {
  const { isDark } = useTheme();
  const circle = (
    <View style={[styles.circle, minus && styles.minusCircle, haloGlow(DANGER_BRIGHT, 0.5, 6, isDark)]}>
      {minus
        ? <Ionicons name="remove" size={17} color={ON_FILL} />
        : <TrashIcon size={16} color={ON_FILL} />}
    </View>
  );
  if (disabled) {
    return (
      <View
        style={styles.disabled}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: true }}
      >
        {circle}
      </View>
    );
  }
  return (
    <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {circle}
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: DELETE_CIRCLE_SIZE,
    height: DELETE_CIRCLE_SIZE,
    borderRadius: DELETE_CIRCLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DANGER_BRIGHT,
  },
  minusCircle: { width: MINUS_CIRCLE_SIZE, height: MINUS_CIRCLE_SIZE, borderRadius: MINUS_CIRCLE_SIZE / 2 },
  disabled: { opacity: 0.3 },
});
