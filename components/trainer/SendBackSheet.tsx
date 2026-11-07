// components/trainer/SendBackSheet.tsx
//
// What Send Back and Send Update open on the review screen (user request,
// 2026-11-06: somewhere to leave comments, in a pop-up like Remove's, and the
// comments on the card the person who asked gets back). It says what sending
// does, takes optional comments and sends them with the program, in one step
// (utils/trainerStore.ts returnReview, migration 0054). They read them as
// TRAINER COMMENTS (components/trainer/ReviewNote.tsx).
//
// Send Update's box opens with the comments sent last time, to keep, change
// or clear: an update sends what's in the box, so clearing it takes the last
// version's words off rather than leaving them on one they weren't written for.
//
// Comments alone are an answer too (user request, 2026-11-06: "an alternative
// rather than removing"): Send Back with nothing changed returns it as it came,
// reviewed, with the comments (they say Got it, not Accept), and once it's
// back, Send a Comment sends comments without an edit. Neither changes their
// program, and a comment keeps their accept (migration 0054).
//
// It stays up while it sends, so a failure keeps what was typed, and slides
// away once the program has gone. The box and the buttons are its pinned
// footer, so they stay above the keyboard however small the phone. Mounted
// only while open (one RN Modal at a time: the review screen has the Summary
// sheet too).

import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import SimpleSheet from "./SimpleSheet";
import SheetPill from "../SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import type { SentProgram } from "../../utils/trainerStore";

/** The server's limit (return_shared_review, migration 0054). */
const COMMENTS_MAX = 1000;
// The box grows to about five lines, then scrolls inside.
const COMMENTS_MAX_H = 108;

/** back: the first send-back, with changes; back-unchanged: the same with
 *  nothing changed; update: a new version after it; comment: comments alone,
 *  after it, on the version they have. */
export type SendBackMode = "back" | "back-unchanged" | "update" | "comment";

const COPY: Record<SendBackMode, { title: string; action: string; body: (program: string, asker: string) => string }> = {
  back: {
    title: "Send Back",
    action: "Send Back",
    body: (program, asker) => `"${program}" goes back to ${asker} with your changes, for them to accept into their programs. Make sure every change is in.`,
  },
  "back-unchanged": {
    title: "Send Back",
    action: "Send Back",
    body: (program, asker) => `You haven't changed "${program}", so it goes back to ${asker} as they sent it, marked as reviewed, with any comments you leave.`,
  },
  update: {
    title: "Send Update",
    action: "Send Update",
    body: (_, asker) => `Your latest edits go to ${asker}, with an Accept for the new version.`,
  },
  comment: {
    title: "Send a Comment",
    action: "Send Comment",
    body: (_, asker) => `Your comments go to ${asker}, on the version they have. Their program doesn't change.`,
  },
};

export default function SendBackSheet({ review, mode, askerName, onSend, onClose }: {
  review: SentProgram;
  mode: SendBackMode;
  /** Who it goes back to: their first name when known, else "the client" or
   *  "the member". */
  askerName: string;
  /** Sends it with the comments as typed. True once it's gone (the sheet
   *  slides away), false when it couldn't go (the sheet stays, comments and
   *  all; the screen has said why). */
  onSend: (comments: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // After a send-back, the box opens with what was sent with it.
  const sentBefore = mode === "update" || mode === "comment" ? review.trainerComments ?? "" : "";
  const [comments, setComments] = useState(sentBefore);
  const [sending, setSending] = useState(false);
  const { title, action, body } = COPY[mode];
  // A comment with nothing new in the box would send nothing.
  const nothingToSend = mode === "comment" && comments.trim() === sentBefore.trim();

  const send = async (close: () => void) => {
    if (sending || nothingToSend) return;
    setSending(true);
    const sent = await onSend(comments);
    setSending(false);
    if (sent) close();
  };

  return (
    <SimpleSheet
      visible
      onClose={onClose}
      footer={close => (
        <View style={styles.footer}>
          <View style={[styles.box, { backgroundColor: t.ctrl, borderColor: t.sheetLine }]}>
            <TextInput
              style={[styles.input, { color: t.tp }]}
              value={comments}
              onChangeText={setComments}
              placeholder={`Comments for ${askerName} (optional)`}
              placeholderTextColor={t.ts}
              maxLength={COMMENTS_MAX}
              multiline
              editable={!sending}
              accessibilityLabel={`Comments for ${askerName} on your changes, optional`}
            />
          </View>
          <SheetPill label={sending ? "Sending…" : action} variant="primary" disabled={sending || nothingToSend} onPress={() => void send(close)} />
          <SheetPill label="Cancel" variant="cancel" disabled={sending} onPress={close} />
        </View>
      )}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
        <Text style={[styles.body, { color: t.ts }]}>{body(review.programName, askerName)}</Text>
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
  input: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 20, maxHeight: COMMENTS_MAX_H },
});
