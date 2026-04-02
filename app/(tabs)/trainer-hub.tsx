import { View, Text, StyleSheet } from "react-native";
import { FontFamily } from "../../constants/theme";

export default function TrainerHubScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Trainer Hub</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111111",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "#FFFFFF",
    fontFamily: FontFamily.semibold,
    fontSize: 24,
  },
});
