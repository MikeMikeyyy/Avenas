// "Superset With": the step of an exercise's sheet (the Workout tab's,
// components/ExerciseSheet.tsx, and the builder's,
// components/ProgramExerciseSheet.tsx) that picks what to do it in a superset
// with (utils/supersets.ts joinSuperset; user request, 2026-11-15). Every other
// exercise of the day or session, in order, but those already in its
// superset. The one picked comes to just after it (after its superset's last,
// when it's in one) and takes its rest; one in another superset leaves that.
// Supersets are made by hand only: the AI never suggests one (user decision,
// the same day).

import { StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import SheetPill from "./SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { namesList } from "../utils/supersets";

export { namesList };

/** An exercise it can be put in a superset with. */
export type SupersetChoice = {
  key: string;
  name: string;
  /** In another superset, with these: it leaves that one. */
  with?: readonly string[];
};

export default function SupersetPickStep({ name, choices, onPick, onCancel }: {
  name: string;
  choices: readonly SupersetChoice[];
  onPick: (key: string) => void;
  onCancel: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <Reanimated.View entering={FadeIn.duration(160)} style={styles.body}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.tp }]}>Superset With</Text>
        <Text style={[styles.message, { color: t.ts }]}>
          {`A set of ${name}, then a set of the one you pick, round after round, resting after each round.`}
        </Text>
      </View>
      {choices.length === 0 ? (
        <Text style={[styles.message, { color: t.ts }]}>{"There's nothing else here to pair it with yet."}</Text>
      ) : (
        choices.map(c => (
          <SheetPill
            key={c.key}
            label={c.name}
            sub={c.with?.length ? `Leaves its superset with ${namesList(c.with)}` : undefined}
            icon={col => <Ionicons name="link-outline" size={18} color={col} />}
            onPress={() => onPick(c.key)}
            accessibilityLabel={`Superset with ${c.name}`}
          />
        ))
      )}
      <SheetPill label="Cancel" variant="cancel" onPress={onCancel} />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // As the exercise sheets' own steps.
  body:    { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  head:    { alignItems: "center", gap: 6, paddingHorizontal: 4, paddingBottom: 4 },
  title:   { fontFamily: FontFamily.bold, fontSize: 20, textAlign: "center" },
  message: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21, textAlign: "center", paddingHorizontal: 8 },
});
