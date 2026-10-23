// components/trainer/MyTrainersPill.tsx
//
// The way to the trainers you're connected with, beside the Trainer tab's title:
// a labelled pill (a person in the words' own colour, close beside "My
// Trainers"; it was the accent green, a little further off: user feedback,
// 2026-10-22), with a red count when something there is waiting. One component
// so both hubs show the same one. Glass on iOS 26 (components/GlassButton.tsx;
// user request, 2026-10-23).

import { StyleSheet, Text } from "react-native";
import GlassButton from "../GlassButton";
import UnreadBadge from "../UnreadBadge";
import UserRoundIcon from "../icons/UserRoundIcon";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { PILL_H_XS, PILL_SHADOW } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";

export default function MyTrainersPill({ onPress, badge = 0 }: { onPress: () => void; badge?: number }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <GlassButton
      pill
      size={PILL_H_XS}
      onPress={onPress}
      contentStyle={styles.pill}
      solidStyle={PILL_SHADOW}
      badge={<UnreadBadge count={badge} style={styles.badge} />}
      accessibilityLabel={badge > 0 ? `Open my trainers, ${badge} new` : "Open my trainers"}
    >
      <UserRoundIcon size={16} color={t.tp} />
      <Text style={[styles.text, { color: t.tp }]}>My Trainers</Text>
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  pill: { gap: 6, paddingHorizontal: 14 },
  text: { fontFamily: FontFamily.semibold, fontSize: 13 },
  badge: { position: "absolute", top: -5, right: -5 },
});
