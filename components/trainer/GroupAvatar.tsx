// A group's photo, or the people icon when it has none (migration 0030).
//
// One component because a group appears in five places — the hub list, the gym
// user's list, the invite card, the group page's banner and its chat header —
// and a photo that showed up in some of them would read as a different group in
// the others. The fallback is the accent-tinted people circle those surfaces
// already drew, so a group without a photo looks exactly as it did before.

import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import PeopleIcon from "../icons/PeopleIcon";
import { ACCT } from "../../constants/theme";

export default function GroupAvatar({ uri, size, isDark }: {
  uri?: string;
  size: number;
  isDark: boolean;
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

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)",
        },
      ]}
    >
      {/* Roughly half the circle, which is where the icon sat at every size
          these surfaces used before this component existed. */}
      <PeopleIcon size={Math.round(size * 0.53)} color={ACCT} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
