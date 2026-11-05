// components/trainer/RemoveReviewSheet.tsx
//
// What Remove on a review opens for its trainer, on their Programs page and a
// group's: Archive or Delete, as the prompt it replaced offered, and, while the
// review hasn't been sent back, a box to tell the person who asked why (user
// request, 2026-11-05: "Not reviewed" reached them with no reason, and there
// was nowhere to give one). The message is optional and goes with either
// choice (utils/trainerStore.ts saveReviewRemovalNote, migration 0053); they
// see it on their request while it reads Not reviewed.
//
// The box and the buttons are the sheet's pinned footer, so they stay above
// the keyboard however small the phone.

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import SimpleSheet from "./SimpleSheet";
import SheetPill from "../SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { SentProgram } from "../../utils/trainerStore";

/** The server's limit (set_review_removal_note). */
const NOTE_MAX = 500;
// The box grows to about four lines, then scrolls inside.
const NOTE_MAX_H = 88;

export default function RemoveReviewSheet({ review, body, askerName, onArchive, onDelete, onClose }: {
  /** The review being removed; null keeps the sheet down. */
  review: SentProgram | null;
  /** What each choice reaches, from the page (it differs by page). */
  body: string;
  /** Who asked, for the box's prompt; "them" when unknown. */
  askerName?: string;
  /** Each with the message, trimmed, or null for none. The sheet has already
   *  started sliding away. */
  onArchive: (note: string | null) => void;
  onDelete: (note: string | null) => void;
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
          <SheetPill label="Archive" onPress={() => { const m = message(); close(); onArchive(m); }} />
          <SheetPill label="Delete" variant="danger" onPress={() => { const m = message(); close(); onDelete(m); }} />
          <SheetPill label="Cancel" variant="cancel" onPress={close} />
        </View>
      )}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.tp }]}>Remove Program</Text>
        <Text style={[styles.body, { color: t.ts }]}>{body}</Text>
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
