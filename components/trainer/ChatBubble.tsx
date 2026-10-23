// A single chat bubble.
//   - mine: right-aligned, the thread's gradient (green in a chat with one
//     person, orchid in a group's: user decision, 2026-10-22, the Chat Redesign
//     canvas), white text, a soft glow in its own colour.
//   - theirs: left-aligned neutral surface, primary text, a faint shadow on a
//     light page.
//
// Messages from one person in a row are a RUN (ChatThreadView's RunPlace):
// they sit close, with the corners on the sender's side tucked in after the
// first; a group's sender name shows on the first only, and the face and the
// time on the last only. A message on its own is a run of one, and reads as
// every bubble did before.
// The gradient is the bubble background (not masked text), so it reads as a
// solid Instagram-style blend behind the message.
//
// In a GROUP thread a received bubble also carries its author (`senderName` +
// optional photo), because the thread has many senders. 1:1 threads pass
// neither and render exactly as before.
//
// A DELETED message (migration 0031) keeps its place and its side, but drops
// its fill: a quiet outlined bubble that says who deleted it, so it can't be
// mistaken for something that was said. It takes no taps — there's nothing
// left in it to delete or report.
//
// `onPress` makes the BUBBLE the tap target, not the row. The row is the full
// width of the thread, so wrapping it opened the message sheet from a tap on
// the empty space beside a short message.

import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import Avatar from "../Avatar";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { sentGradient, type ChatMessage, type ChatTone } from "../../constants/chat";
import { useTheme } from "../../contexts/ThemeContext";
import type { RunPlace } from "./ChatThreadView";

/** A bubble's corners: round, but tucked in on the sender's side, below the
 *  first of a run and at the tail. */
const BIG = 20;
const SMALL = 6;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

interface Props {
  msg: ChatMessage;
  /** Group threads only: the author of a RECEIVED message. Omitted in 1:1. */
  senderName?: string;
  senderPhotoUri?: string;
  senderInitials?: string;
  /** Who wrote a received message, for "Message deleted by …" in a 1:1 thread,
   *  where there's no senderName. A group's senderName wins when present. */
  authorName?: string;
  /** Tap (or press and hold) the bubble. Ignored for a deleted message. */
  onPress?: () => void;
  /** The thread's colour for my own messages. */
  tone?: ChatTone;
  /** Its place in a run of one person's messages; alone by default. */
  run?: RunPlace;
}

export default function ChatBubble({ msg, senderName, senderPhotoUri, senderInitials, authorName, onPress, tone = "green", run }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const first = run?.first ?? true;
  const last = run?.last ?? true;
  const grad = sentGradient(tone);
  // Close inside a run, apart between runs.
  const rowGap = { marginTop: first ? 6 : 1, marginBottom: last ? 6 : 1 };
  const corners = msg.mine
    ? { borderTopLeftRadius: BIG, borderTopRightRadius: first ? BIG : SMALL, borderBottomRightRadius: SMALL, borderBottomLeftRadius: BIG }
    : { borderTopLeftRadius: first ? BIG : SMALL, borderTopRightRadius: BIG, borderBottomRightRadius: BIG, borderBottomLeftRadius: SMALL };
  // A group's received bubble keeps the face's column on every message of a
  // run, so they line up, with the face itself on the last.
  const face = senderName ? (last ? (
    <Avatar
      uri={senderPhotoUri}
      initials={senderInitials || senderName.slice(0, 2).toUpperCase()}
      size={28}
      backgroundColor={isDark ? `${ACCT}1F` : `${ACCT}2E`}
      textColor={ACCT}
      textStyle={[styles.senderInitials, { color: ACCT }]}
    />
  ) : <View style={styles.faceSpace} />) : null;

  const press = msg.deleted ? undefined : onPress;
  // The bubble alone is the target; delayLongPress matches the old
  // press-and-hold, which still works alongside the tap.
  const tappable = (bubble: React.ReactNode) => (press ? (
    <Pressable
      onPress={press}
      onLongPress={press}
      delayLongPress={250}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      accessibilityRole="button"
      accessibilityHint={msg.mine ? "Opens options, including delete" : "Opens options, including report"}
    >
      {bubble}
    </Pressable>
  ) : bubble);

  if (msg.deleted) {
    const who = senderName ?? authorName;
    const label = msg.mine ? "You deleted this message" : who ? `Message deleted by ${who}` : "This message was deleted";
    return (
      <View style={[styles.row, rowGap, { justifyContent: msg.mine ? "flex-end" : "flex-start" }]}>
        {!msg.mine ? face : null}
        <View style={[styles.wrap, !msg.mine && senderName ? styles.wrapWithAvatar : null]}>
          {!msg.mine && senderName && first ? (
            <Text style={[styles.senderName, { color: t.ts }]} numberOfLines={1}>{senderName}</Text>
          ) : null}
          <View
            style={[styles.bubble, corners, styles.deleted, { borderColor: t.div }]}
            accessibilityLabel={label}
          >
            <Ionicons name="ban-outline" size={14} color={t.ts} />
            <Text style={[styles.deletedText, { color: t.ts }]}>{label}</Text>
          </View>
          {last ? (
            <Text style={[styles.time, { color: t.ts, textAlign: msg.mine ? "right" : "left" }]}>{fmtTime(msg.sentAtISO)}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (msg.mine) {
    return (
      <View style={[styles.row, rowGap, { justifyContent: "flex-end" }]}>
        <View style={styles.wrap}>
          {tappable(
            // The glow on an outer view: the gradient clips its corners, and a
            // view that clips casts no shadow.
            <View style={[corners, styles.glow, { shadowColor: grad[1] }]}>
              <LinearGradient
                colors={grad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.bubble, corners, styles.clip]}
              >
                <Text style={styles.mineText}>{msg.text}</Text>
              </LinearGradient>
            </View>,
          )}
          {last ? (
            <Text style={[styles.time, { color: t.ts, textAlign: "right" }]}>{fmtTime(msg.sentAtISO)}</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, rowGap, { justifyContent: "flex-start" }]}>
      {face}
      <View style={[styles.wrap, senderName ? styles.wrapWithAvatar : null]}>
        {senderName && first ? (
          <Text style={[styles.senderName, { color: t.ts }]} numberOfLines={1}>{senderName}</Text>
        ) : null}
        {tappable(
          <View style={[
            styles.bubble,
            corners,
            { backgroundColor: isDark ? t.ctrl : APP_LIGHT.ctrl },
            !isDark && styles.theirsShadow,
          ]}>
            <Text style={[styles.theirsText, { color: t.tp }]}>{msg.text}</Text>
          </View>,
        )}
        {last ? <Text style={[styles.time, { color: t.ts }]}>{fmtTime(msg.sentAtISO)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:        { width: "100%", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  // The face's column, kept on a run's earlier messages so they line up.
  faceSpace:  { width: 28 },
  wrap:       { maxWidth: "78%" },
  // The avatar eats horizontal room, so a group bubble gets a slightly
  // narrower ceiling to keep the right-hand gutter consistent with 1:1.
  wrapWithAvatar: { maxWidth: "72%" },
  senderName:     { fontFamily: FontFamily.semibold, fontSize: 11, marginBottom: 3, marginHorizontal: 4 },
  senderInitials: { fontFamily: FontFamily.bold, fontSize: 10 },
  bubble:     { paddingHorizontal: 14, paddingVertical: 10 },
  clip:       { overflow: "hidden" },
  // My bubble's soft glow, in its own colour (shadowColor, per tone).
  glow:       { shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 8 },
  // Theirs on a light page: just enough to lift white off the background.
  theirsShadow: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
  mineText:   { color: "#fff", fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  theirsText: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 },
  time:       { fontFamily: FontFamily.regular, fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  // No fill, a t.div outline (the app's line colour in both themes): present,
  // but plainly not a message any more.
  deleted:     { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, backgroundColor: "transparent" },
  deletedText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19 },
});
