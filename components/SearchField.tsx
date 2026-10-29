// The search field a page opens over its list: the Journal's Programs page
// (app/program-history.tsx), Messages (app/trainer/messages.tsx), a group's
// members (app/trainer/group/[id], and its member list in
// app/trainer/group-edit.tsx), both My Trainers pages (app/my-trainers.tsx,
// app/trainer/coaches.tsx) and Connect's people (app/connect.tsx), the shared
// ones in both the trainer's and the gym user's views.
//
// The faded look: a faint tint of the page (`t.field`) with a hairline edge, a
// rounded box rather than a pill, no shadow. Messages and the group page had
// been moved to the exercise picker's white pill, and went back to this (user
// decision, 2026-10-22). One component so the three can't drift apart again.

import type { Ref } from "react";
import {
  StyleSheet, TextInput, TouchableOpacity, View, type StyleProp, type TextInputInstance, type ViewInstance, type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

export default function SearchField({ value, onChangeText, placeholder, autoFocus = false, inputRef, boxRef, style }: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** For a field that opens from a search button. */
  autoFocus?: boolean;
  inputRef?: Ref<TextInputInstance>;
  /** The box itself, for a page that measures it (the group page keeps it
   *  clear of the keyboard). */
  boxRef?: Ref<ViewInstance>;
  /** Its margins on the page. */
  style?: StyleProp<ViewStyle>;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View ref={boxRef} style={[styles.box, { backgroundColor: t.field, borderColor: t.div }, style]}>
      <Ionicons name="search" size={16} color={t.ts} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.ts}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        style={[styles.input, { color: t.tp }]}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText("")} hitSlop={8} accessibilityLabel="Clear search" accessibilityRole="button">
          <Ionicons name="close-circle" size={18} color={t.ts} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  input: { flex: 1, fontFamily: FontFamily.regular, fontSize: 15, padding: 0 },
});
