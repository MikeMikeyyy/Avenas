// The red delete button: a red circle with a white bin and a soft red glow,
// for a control that deletes or removes something (DANGER_BRIGHT, the delete
// red). The size of the exercise picker's own red delete beside a custom
// exercise, so the two look the same. It only draws the button: what it
// deletes, and asking first, are the caller's.

import { StyleSheet, View } from "react-native";

import BounceButton from "./BounceButton";
import TrashIcon from "./TrashIcon";
import { DANGER_BRIGHT } from "../constants/theme";
import { haloGlow } from "../constants/buttons";
import { useTheme } from "../contexts/ThemeContext";

/** Its diameter; beside it, a pill of the same height lines up with it. */
export const DELETE_CIRCLE_SIZE = 32;

export default function DeleteCircleButton({ onPress, accessibilityLabel }: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { isDark } = useTheme();
  return (
    <BounceButton onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <View style={[styles.circle, haloGlow(DANGER_BRIGHT, 0.5, 6, isDark)]}>
        <TrashIcon size={16} color="#fff" />
      </View>
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
});
