// components/trainer/ReviewNote.tsx
//
// What a trainer wrote on a review, in a box of its own, wherever it's read:
//
//   TRAINER COMMENTS        what they wrote as they sent it back (Send Back's
//                           box, migration 0054; user request, 2026-11-06), on
//                           the card of the person who asked, before they take
//                           the changes and after (user decision, 2026-11-06:
//                           re-read while training it)
//   WHY IT WASN'T REVIEWED  why it was removed without a review (0053), while
//                           it reads Not reviewed
//
// and, to the trainer on the review screen, the comments they sent. Which one
// a request shows is utils/trainerLists.ts reviewNoteOf. One look for all of
// them, so they read as the trainer's words.

import { StyleSheet, Text, View } from "react-native";

import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import { reviewNoteOf, type ReviewNote as Note } from "../../utils/trainerLists";
import type { SentProgram } from "../../utils/trainerStore";

export const NOTE_LABEL: Record<Note["kind"], string> = {
  comments: "TRAINER COMMENTS",
  removed: "WHY IT WASN'T REVIEWED",
};

/** A labelled note in the trainer's words. */
export function TrainerNote({ label, note }: { label: string; note: string }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <View style={[styles.box, { borderColor: t.div }]}>
      <Text style={[styles.label, { color: t.ts }]}>{label}</Text>
      <Text style={[styles.body, { color: t.tp }]}>{note}</Text>
    </View>
  );
}

/** The note on my request, when the trainer wrote one. */
export default function ReviewNote({ review }: { review: SentProgram }) {
  const n = reviewNoteOf(review);
  return n ? <TrainerNote label={NOTE_LABEL[n.kind]} note={n.note} /> : null;
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, gap: 6 },
  label: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  body: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
});
