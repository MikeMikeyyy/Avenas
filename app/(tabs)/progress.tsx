import { View, Text, StyleSheet } from "react-native";
import { FontFamily, APP_LIGHT, APP_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

export default function ProgressScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Text style={[styles.text, { color: t.tp }]}>Progress</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  text:      { fontFamily: FontFamily.semibold, fontSize: 24 },
});
