// An exercise's notes box, with last time's note offered inside it.
//
// Shared by the Workout tab and log-workout, which had drawn the same hint and
// chip twice and would otherwise drift.
//
// The note from the last session of this exercise (utils/workout.ts
// buildPrevNotesByName) is shown AS THE EMPTY BOX'S PLACEHOLDER — "Previous:"
// on one line and the note beneath it, greyed — rather than as a labelled line
// under the box. It sat below a
// separate "Add exercise notes…" prompt as a second, uppercase "LAST TIME"
// block, which was two greys saying two things about one empty field. Now the
// field says the one thing that's useful: what you wrote last time.
//
// It's still reference only. A placeholder is never the value, so leaving it
// alone carries nothing into this session. Beside it:
//
//   REUSE — shown while the box is empty: puts the note in, to keep or edit.
//   UNDO  — shown while the box holds exactly that reused note: empties it
//           again. Typing makes the text yours and the Undo goes away, since
//           undoing would now throw your edits away too.
//
// Both states are DERIVED from the text rather than stored, so a draft restored
// after the app was killed shows the right chip without anything remembering
// that Reuse was tapped.

import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";

export default function ExerciseNotesField({ value, onChange, prevNote, editable = true, onFocus, isDark }: {
  value: string;
  onChange: (next: string) => void;
  /** Last session's note for this exercise, or undefined when there isn't one. */
  prevNote?: string;
  /** False on a finished, locked workout: no chip, and no "Previous" either. */
  editable?: boolean;
  onFocus?: () => void;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;

  const offer = editable && !!prevNote;
  const canReuse = offer && value.trim() === "";
  const canUndo = offer && value === prevNote;

  return (
    <>
      <Text style={[styles.label, { color: t.tp }]}>Notes</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: t.tp }]}
          // "Previous:" on its own line with the note starting directly beneath
          // it, so the label reads as a heading and the note keeps its own left
          // edge instead of wrapping back under the word "Previous".
          placeholder={offer ? `Previous:\n${prevNote}` : "Add exercise notes..."}
          placeholderTextColor={t.ts}
          value={value}
          editable={editable}
          onChangeText={onChange}
          onFocus={onFocus}
          multiline
          textAlignVertical="top"
        />
        {(canReuse || canUndo) && (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(canReuse ? prevNote! : "");
            }}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={canReuse ? "Reuse last time's note" : "Undo reusing last time's note"}
          >
            <View style={[styles.chip, { borderColor: t.div }]}>
              <Ionicons name={canReuse ? "return-down-forward" : "arrow-undo"} size={11} color={t.ts} />
              {/* Same width in both states, so the chip doesn't shrink under
                  your thumb when it flips to Undo. "Reuse" is always laid out
                  — it's the longer word, and it sets the width — and is only
                  hidden in the Undo state, where "Undo" sits over it,
                  right-aligned. The extra room therefore opens up between the
                  icon and the word rather than at the chip's edge. Sized by
                  the real text rather than a fixed number, so it can't clip
                  "Reuse" if the font renders a point wider. */}
              <View>
                <Text style={[styles.chipText, { color: t.ts, opacity: canReuse ? 1 : 0 }]}>Reuse</Text>
                {canUndo && !canReuse && (
                  <Text style={[styles.chipText, styles.chipOverlay, { color: t.ts }]}>Undo</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: FontFamily.semibold, fontSize: 13, marginBottom: 6 },
  // The chip sits at the right of the box, pinned to its first line, so a long
  // note wraps beneath the start of the text rather than squeezing the button.
  row:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  input: { flex: 1, fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },
  chip:  { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: PILL_RADIUS, paddingHorizontal: 8, paddingVertical: 3, marginTop: 1 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 11 },
  // "Undo" laid over the hidden "Reuse", pinned right within its width.
  chipOverlay: { position: "absolute", top: 0, right: 0 },
});
