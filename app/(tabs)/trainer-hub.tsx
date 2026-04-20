import { View, Text, StyleSheet } from "react-native";
import { FontFamily, APP_LIGHT, APP_DARK } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import FadeScreen from "../../components/FadeScreen";

export default function TrainerHubScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View style={styles.container}>
        <Text style={[styles.text, { color: t.tp }]}>Trainer Hub</Text>
      </View>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  text:      { fontFamily: FontFamily.semibold, fontSize: 24 },
});
