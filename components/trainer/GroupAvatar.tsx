// A group's photo, or the people icon when it has none (migration 0030).
//
// One component because a group appears in five places — the hub list, the gym
// user's list, the invite card, the group page's banner and its chat header —
// and a photo that showed up in some of them would read as a different group in
// the others. Without a photo it's the people icon on a pale circle in the
// group's own colour, picked from its id (constants/theme.ts avatarColors), so
// it's the same group colour in all five and a list of groups isn't all green
// (user request, 2026-10-28; it was the accent's tint for every group).

import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import PeopleIcon from "../icons/PeopleIcon";
import { avatarColors } from "../../constants/theme";

export default function GroupAvatar({ uri, size, isDark, colorKey }: {
  uri?: string;
  size: number;
  isDark: boolean;
  /** The group's id: it picks the group's colour. */
  colorKey?: string;
}) {
  const radius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        transition={150}
      />
    );
  }

  const { bg, ink } = avatarColors(colorKey, isDark);
  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius, backgroundColor: bg }]}>
      {/* Roughly half the circle, which is where the icon sat at every size
          these surfaces used before this component existed. */}
      <PeopleIcon size={Math.round(size * 0.53)} color={ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
