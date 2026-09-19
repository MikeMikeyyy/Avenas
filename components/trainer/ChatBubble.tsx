// A single chat bubble.
//   - mine: right-aligned, teal→blue LinearGradient fill, white text.
//   - theirs: left-aligned neutral surface, primary text.
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
import { SENT_BUBBLE_GRADIENT, type ChatMessage } from "../../constants/chat";
import { useTheme } from "../../contexts/ThemeContext";

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
}

export default function ChatBubble({ msg, senderName, senderPhotoUri, senderInitials, authorName, onPress }: Props) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

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
      <View style={[styles.row, { justifyContent: msg.mine ? "flex-end" : "flex-start" }]}>
        {!msg.mine && senderName ? (
          <Avatar
            uri={senderPhotoUri}
            initials={senderInitials || senderName.slice(0, 2).toUpperCase()}
            size={28}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textColor={ACCT}
            textStyle={[styles.senderInitials, { color: ACCT }]}
          />
        ) : null}
        <View style={[styles.wrap, !msg.mine && senderName ? styles.wrapWithAvatar : null]}>
          <View
            style={[styles.bubble, msg.mine ? styles.mine : styles.theirs, styles.deleted, { borderColor: t.div }]}
            accessibilityLabel={label}
          >
            <Ionicons name="ban-outline" size={14} color={t.ts} />
            <Text style={[styles.deletedText, { color: t.ts }]}>{label}</Text>
          </View>
          <Text style={[styles.time, { color: t.ts, textAlign: msg.mine ? "right" : "left" }]}>{fmtTime(msg.sentAtISO)}</Text>
        </View>
      </View>
    );
  }

  if (msg.mine) {
    return (
      <View style={[styles.row, { justifyContent: "flex-end" }]}>
        <View style={styles.wrap}>
          {tappable(
            <LinearGradient
              colors={SENT_BUBBLE_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.bubble, styles.mine]}
            >
              <Text style={styles.mineText}>{msg.text}</Text>
            </LinearGradient>,
          )}
          <Text style={[styles.time, { color: t.ts, textAlign: "right" }]}>{fmtTime(msg.sentAtISO)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, { justifyContent: "flex-start" }]}>
      {senderName ? (
        <Avatar
          uri={senderPhotoUri}
          initials={senderInitials || senderName.slice(0, 2).toUpperCase()}
          size={28}
          backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
          textColor={ACCT}
          textStyle={[styles.senderInitials, { color: ACCT }]}
        />
      ) : null}
      <View style={[styles.wrap, senderName ? styles.wrapWithAvatar : null]}>
        {senderName ? (
          <Text style={[styles.senderName, { color: t.ts }]} numberOfLines={1}>{senderName}</Text>
        ) : null}
        {tappable(
          <View style={[styles.bubble, styles.theirs, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff" }]}>
            <Text style={[styles.theirsText, { color: t.tp }]}>{msg.text}</Text>
          </View>,
        )}
        <Text style={[styles.time, { color: t.ts }]}>{fmtTime(msg.sentAtISO)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:        { width: "100%", marginVertical: 4, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  wrap:       { maxWidth: "78%" },
  // The avatar eats horizontal room, so a group bubble gets a slightly
  // narrower ceiling to keep the right-hand gutter consistent with 1:1.
  wrapWithAvatar: { maxWidth: "72%" },
  senderName:     { fontFamily: FontFamily.semibold, fontSize: 11, marginBottom: 3, marginHorizontal: 4 },
  senderInitials: { fontFamily: FontFamily.bold, fontSize: 10 },
  bubble:     { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  mine:       { borderBottomRightRadius: 6 },
  theirs:     { borderBottomLeftRadius: 6 },
  mineText:   { color: "#fff", fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  theirsText: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 },
  time:       { fontFamily: FontFamily.regular, fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  // No fill, a t.div outline (the app's line colour in both themes): present,
  // but plainly not a message any more.
  deleted:     { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, backgroundColor: "transparent" },
  deletedText: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 19 },
});
