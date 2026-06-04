import { View, Text, StyleSheet } from "react-native";
import BounceButton from "./BounceButton";
import { APP_DARK, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";

// Grey slate primary button, matching the home "Start Workout" / onboarding CTAs.
interface Props {
  label: string;
  onPress: () => void;
  dark: boolean;
  disabled?: boolean;
}

export default function PrimaryButton({ label, onPress, dark, disabled = false }: Props) {
  const btnBg = dark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = dark ? APP_DARK.bg : "#fff";
  const btnShadow = dark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  return (
    <BounceButton
      onPress={() => { if (!disabled) onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.wrap, { backgroundColor: btnBg, shadowColor: btnShadow }, disabled && styles.disabled]}>
        <View style={[styles.btn, { backgroundColor: btnBg }]}>
          <Text style={[styles.text, { color: btnContent }]}>{label}</Text>
        </View>
      </View>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  wrap:     { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  disabled: { opacity: 0.4 },
  btn:      { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  text:     { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
});
