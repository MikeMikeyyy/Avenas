// An exercise's notes box, with last time's note offered inside it.
//
// Shared by the Workout tab and log-workout, which had drawn the same hint and
// chip twice and would otherwise drift.
//
// The note from the last session of this exercise (utils/workout.ts
// buildPrevNotesByName) is shown AS THE EMPTY BOX'S PLACEHOLDER, greyed, with a
// grey "Previous" beside the box's "Notes" heading saying where it's from
// (PrevNoteTag), rather than as a labelled line under the box. It sat below a
// separate "Add exercise notes…" prompt as a second, uppercase "LAST TIME"
// block, which was two greys saying two things about one empty field. Now the
// field says the one thing that's useful: what you wrote last time. The
// "Previous:" used to sit inside the box above the note, which cost the note a
// line; beside the heading it costs nothing.
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
//
// The session notes box offers last time's SESSION note the same way, so the
// chip, the tag and the placeholder are exported for it (ReuseNoteChip,
// PrevNoteTag, prevNotePlaceholder) rather than drawn a second time.

import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";

import ReuseIcon from "./icons/ReuseIcon";
import UndoIcon from "./icons/UndoIcon";
import { APP_DARK, APP_LIGHT, FontFamily } from "../constants/theme";
import { PILL_RADIUS, PILL_SHADOW } from "../constants/buttons";

/** Both chip icons, one size: the pair are mirror images in the same 16×16
 *  box, so flipping between them can't change the chip's height or width. */
const CHIP_ICON = 12;

/** The empty box's placeholder: last time's note when there is one, else the
 *  box's own prompt. What it is ("Previous") is said by PrevNoteTag beside the
 *  box's heading, not inside the box. */
export function prevNotePlaceholder(prevNote: string | undefined, prompt: string, editable = true): string {
  return editable && prevNote ? prevNote : prompt;
}

/** "Previous:", in grey beside a notes box's heading, while the box's
 *  placeholder is last time's note: exactly when it's empty and there is one.
 *  Gone once there's text in the box, reused or typed, because then the grey
 *  words it labelled are gone too. Sits on the heading's baseline, so the
 *  heading row can be `alignItems: "baseline"` at any heading size. */
export function PrevNoteTag({ value, prevNote, editable = true, isDark }: {
  value: string;
  prevNote?: string;
  editable?: boolean;
  isDark: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (!editable || !prevNote || value !== "") return null;
  return <Text style={[styles.prevTag, { color: t.ts }]}>Previous:</Text>;
}

/** Reuse while the box is empty, Undo while it holds exactly the reused note,
 *  nothing otherwise (see the file header). Renders nothing when there's no
 *  previous note or the box is read-only. */
export function ReuseNoteChip({ value, onChange, prevNote, editable = true, isDark }: {
  value: string;
  onChange: (next: string) => void;
  prevNote?: string;
  editable?: boolean;
  isDark: boolean;
}) {
  // The app's secondary-button look (the control surface, a soft shadow, full
  // strength ink), so it reads as something to tap: grey text on a hairline
  // outline looked like part of the greyed placeholder note beside it. Not
  // accent green, which made an offer louder than the workout around it.
  const t = isDark ? APP_DARK : APP_LIGHT;
  const ink = t.tp;

  const offer = editable && !!prevNote;
  const canReuse = offer && value.trim() === "";
  const canUndo = offer && value === prevNote;
  if (!canReuse && !canUndo) return null;

  return (
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
      <View style={[styles.chip, { backgroundColor: t.ctrl }]}>
        {canReuse
          ? <ReuseIcon size={CHIP_ICON} color={ink} />
          : <UndoIcon size={CHIP_ICON} color={ink} />}
        {/* Same width in both states, so the chip doesn't shrink under
            your thumb when it flips to Undo. "Reuse" is always laid out
            — it's the longer word, and it sets the width — and is only
            hidden in the Undo state, where "Undo" sits over it,
            right-aligned. The extra room therefore opens up between the
            icon and the word rather than at the chip's edge. Sized by
            the real text rather than a fixed number, so it can't clip
            "Reuse" if the font renders a point wider. */}
        <View>
          <Text style={[styles.chipText, { color: ink, opacity: canReuse ? 1 : 0 }]}>Reuse</Text>
          {canUndo && !canReuse && (
            <Text style={[styles.chipText, styles.chipOverlay, { color: ink }]}>Undo</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

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

  return (
    <>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: t.tp }]}>Notes</Text>
        <PrevNoteTag value={value} prevNote={prevNote} editable={editable} isDark={isDark} />
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: t.tp }]}
          placeholder={prevNotePlaceholder(prevNote, "Add exercise notes...", editable)}
          placeholderTextColor={t.ts}
          value={value}
          editable={editable}
          onChangeText={onChange}
          onFocus={onFocus}
          multiline
          textAlignVertical="top"
        />
        <ReuseNoteChip value={value} onChange={onChange} prevNote={prevNote} editable={editable} isDark={isDark} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 6 },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  prevTag: { fontFamily: FontFamily.regular, fontSize: 12 },
  // The chip sits at the right of the box, pinned to its first line, so a long
  // note wraps beneath the start of the text rather than squeezing the button.
  row:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  input: { flex: 1, fontFamily: FontFamily.regular, fontSize: 13, minHeight: 36, lineHeight: 20 },
  chip:  { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: PILL_RADIUS, paddingHorizontal: 10, paddingVertical: 5, ...PILL_SHADOW },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  // "Undo" laid over the hidden "Reuse", pinned right within its width.
  chipOverlay: { position: "absolute", top: 0, right: 0 },
});
