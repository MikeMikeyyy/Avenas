// components/trainer/RemoveReviewSheet.tsx
//
// What Remove on a review opens for its trainer, on their Programs page and a
// group's: Remove, for good, and, while the review hasn't been sent back, a box
// to tell the person who asked why (user request, 2026-11-05: "Not reviewed"
// reached them with no reason, and there was nowhere to give one). The message
// is optional (utils/trainerStore.ts saveReviewRemovalNote, migration 0053);
// they see it on their request, which reads Not reviewed.
//
// A review is reviewed or removed: there's no archive for one (user decision,
// 2026-11-05). Archive sat beside Delete here, but the person who asked saw
// the same Not reviewed either way, so it only kept a to-do on the trainer's
// side that nobody was going to do.
//
// The box and the buttons are the sheet's pinned footer, so they stay above
// the keyboard however small the phone.

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import SimpleSheet from "./SimpleSheet";
import SheetPill from "../SheetPill";
import { removeReviewNote } from "./ReviewStatusPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { SentProgram } from "../../utils/trainerStore";

/** The server's limit (set_review_removal_note). */
const NOTE_MAX = 500;
// The box grows to about four lines, then scrolls inside.
const NOTE_MAX_H = 88;

/** Where removing it reaches, then what it leaves the person who asked with.
 *  A group review leaves the group's queue for all its trainers (the same row
 *  is on each one's list); a 1:1 one leaves mine. */
function removeBody(r: SentProgram): string {
  const from = r.groupId ? "the group's review list, for all its trainers" : "your list";
  return `"${r.programName}" comes off ${from}. ${removeReviewNote(r)}`;
}

export default function RemoveReviewSheet({ review, askerName, onRemove, onClose }: {
  /** The review being removed; null keeps the sheet down. */
  review: SentProgram | null;
  /** Who asked, for the box's prompt; "them" when unknown. */
  askerName?: string;
  /** With the message, trimmed, or null for none. The sheet has already
   *  started sliding away. */
  onRemove: (note: string | null) => void;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // A fresh box for each review it opens on: what was typed is kept with the
  // review it was typed for.
  const [draft, setDraft] = useState({ reviewId: "", text: "" });
  const reviewId = review?.id ?? "";
  const note = draft.reviewId === reviewId ? draft.text : "";
  const setNote = (text: string) => setDraft({ reviewId, text });

  // Once it's been sent back they have their review: there's nothing to explain.
  const asksWhy = !!review && review.status !== "returned";
  const message = () => (asksWhy ? note.trim() || null : null);

  return (
    <SimpleSheet
      visible={!!review}
      onClose={onClose}
      footer={close => (
        <View style={styles.footer}>
          {asksWhy ? (
            <View style={[styles.box, { backgroundColor: t.ctrl, borderColor: t.sheetLine }]}>
              <TextInput
                style={[styles.input, { color: t.tp }]}
                value={note}
                onChangeText={setNote}
                placeholder={`Tell ${askerName ?? "them"} why (optional)`}
                placeholderTextColor={t.ts}
                maxLength={NOTE_MAX}
                multiline
                accessibilityLabel={`A message to ${askerName ?? "them"} saying why, optional`}
              />
            </View>
          ) : null}
          <SheetPill label="Remove" variant="danger" onPress={() => { const m = message(); close(); onRemove(m); }} />
          <SheetPill label="Cancel" variant="cancel" onPress={close} />
        </View>
      )}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.tp }]}>Remove Program</Text>
        <Text style={[styles.body, { color: t.ts }]}>{review ? removeBody(review) : ""}</Text>
      </View>
    </SimpleSheet>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 24, paddingBottom: 6, gap: 8 },
  title: { fontFamily: FontFamily.bold, fontSize: 20 },
  body: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
  box: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, minHeight: 48, justifyContent: "center" },
  input: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 20, maxHeight: NOTE_MAX_H },
});
