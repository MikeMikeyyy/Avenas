import { View, Text, StyleSheet } from "react-native";
import { FontFamily } from "../../constants/theme";

export default function WorkoutScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Workout</Text>
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
