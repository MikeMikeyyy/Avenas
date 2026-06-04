// A single chat bubble.
//   - mine: right-aligned, teal→blue LinearGradient fill, white text.
//   - theirs: left-aligned neutral surface, primary text.
// The gradient is the bubble background (not masked text), so it reads as a
// solid Instagram-style blend behind the message.

import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
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

export default function ChatBubble({ msg }: { msg: ChatMessage }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  if (msg.mine) {
    return (
      <View style={[styles.row, { justifyContent: "flex-end" }]}>
        <View style={styles.wrap}>
          <LinearGradient
            colors={SENT_BUBBLE_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.bubble, styles.mine]}
          >
            <Text style={styles.mineText}>{msg.text}</Text>
          </LinearGradient>
          <Text style={[styles.time, { color: t.ts, textAlign: "right" }]}>{fmtTime(msg.sentAtISO)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, { justifyContent: "flex-start" }]}>
      <View style={styles.wrap}>
        <View style={[styles.bubble, styles.theirs, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#ffffff" }]}>
          <Text style={[styles.theirsText, { color: t.tp }]}>{msg.text}</Text>
        </View>
        <Text style={[styles.time, { color: t.ts }]}>{fmtTime(msg.sentAtISO)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:        { width: "100%", marginVertical: 4, flexDirection: "row" },
  wrap:       { maxWidth: "78%" },
  bubble:     { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  mine:       { borderBottomRightRadius: 6 },
  theirs:     { borderBottomLeftRadius: 6 },
  mineText:   { color: "#fff", fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  theirsText: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 21 },
  time:       { fontFamily: FontFamily.regular, fontSize: 10, marginTop: 3, marginHorizontal: 4 },
});
