// components/trainer/ProgramsCard.tsx
//
// A trainer's programs on their Trainer tab: one card at the top of the page,
// opening the Programs page (app/trainer/programs.tsx), where they're sent,
// reviewed and archived. It says what's there as two tags: the reviews waiting
// on you in orange, the programs you've sent in green (user decision,
// 2026-10-21, option 3 on the Trainer Page canvas). It sits at the top so it
// stays one tap away however long the client list below it grows.

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import BounceButton from "../BounceButton";
import NeuCard from "../NeuCard";
import NotebookIcon from "../icons/NotebookIcon";
import SendIcon from "../icons/SendIcon";
import {
  ACCT, APP_DARK, APP_LIGHT, AWAITING_ORANGE, FontFamily, accentTextColor, replacedTextColor,
} from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";

export default function ProgramsCard({ toReview, sent, onPress }: {
  /** Programs sent to you for review, not yet sent back. */
  toReview: number;
  /** Programs you've sent, one per send. */
  sent: number;
  onPress: () => void;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  // Orange while something waits on you, the accent otherwise.
  const waiting = toReview > 0;
  const mark = waiting ? AWAITING_ORANGE : ACCT;
  const label = [
    "Programs",
    waiting ? `${toReview} to review` : null,
    sent > 0 ? `${sent} sent` : null,
  ].filter(Boolean).join(", ");

  return (
    <BounceButton style={styles.wrap} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <NeuCard dark={isDark} radius={20}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: `${mark}24` }]}>
            <NotebookIcon size={20} color={mark} />
          </View>
          <View style={styles.body}>
            <Text style={[styles.title, { color: t.tp }]}>Programs</Text>
            {waiting || sent > 0 ? (
              <View style={styles.tags}>
                {waiting ? (
                  <View style={[styles.tag, { backgroundColor: `${AWAITING_ORANGE}24` }]}>
                    <View style={[styles.dot, { backgroundColor: AWAITING_ORANGE }]} />
                    <Text style={[styles.tagText, { color: replacedTextColor(isDark) }]}>{toReview} to review</Text>
                  </View>
                ) : null}
                {sent > 0 ? (
                  <View style={[styles.tag, { backgroundColor: `${ACCT}2E` }]}>
                    <SendIcon size={12} color={ACCT} />
                    <Text style={[styles.tagText, { color: accentTextColor(isDark) }]}>{sent} sent</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.hint, { color: t.ts }]}>Send one to a client or a group</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.ts} />
        </View>
      </NeuCard>
    </BounceButton>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 6 },
  title: { fontFamily: FontFamily.bold, fontSize: 16, lineHeight: 21 },
  tags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  tag: { height: 24, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tagText: { fontFamily: FontFamily.bold, fontSize: 12 },
  hint: { fontFamily: FontFamily.regular, fontSize: 13 },
});
