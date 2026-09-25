// What a workout earned, at the top of its detail screen (app/workout-detail.tsx):
// every PR it set, with the new weight, what it beat and by how much, and the
// workout milestone if it was one. Nothing renders for a session that earned
// nothing.
//
// The achievements come from utils/achievements.ts achievementsForWorkout, the
// same answer the program page's rows and Home's cards give, so a session
// can't show one PR here and another there.
//
// Gold for records, as on Home's PR badge and the program page's PR pill; the
// app's green for a milestone. Only the badge carries it: the card itself is
// the plain card colour. Copy rule: no em dashes.

import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "./NeuCard";
import DumbbellIcon from "./DumbbellIcon";
import { ACCT, ACCT_DEEP, APP_DARK, APP_LIGHT, FontFamily, GOLD, GOLD_DARK } from "../constants/theme";
import { PILL_RADIUS } from "../constants/buttons";
import { TROPHY_ICON } from "../constants/icons";
import type { Achievement } from "../constants/achievements";
import { formatWeight } from "../utils/achievements";
import { ordinal } from "../utils/workoutSummary";

function WorkoutAchievements({ achievements, isDark, isKg }: {
  achievements: Achievement[];
  isDark: boolean;
  isKg: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const prs = achievements.flatMap(a => (a.category === "pr" ? a.prs : []));
  const milestone = achievements.find(a => a.category === "workouts");
  if (prs.length === 0 && !milestone) return null;

  const gold = isDark ? GOLD_DARK : GOLD;
  // Accent green washes out as small text on the light card (see theme.ts).
  const ink = isDark ? ACCT : ACCT_DEEP;
  // The card's colour is its headline's: gold when it set a record, green when
  // the milestone is all there is.
  const tone = prs.length > 0 ? gold : ACCT;
  const title = prs.length === 0
    ? "Workout milestone"
    : prs.length === 1 ? "New personal record" : `${prs.length} new personal records`;
  const count = milestone && milestone.category === "workouts" ? milestone.count : null;

  return (
    <NeuCard dark={isDark} radius={20} style={styles.card}>
      <View
        accessible
        accessibilityLabel={[
          title,
          ...prs.map(pr => `${pr.exerciseName}, ${formatWeight(pr.valueKg, isKg)}, up from ${formatWeight(pr.prevKg, isKg)}`),
          ...(count ? [`${ordinal(count)} workout logged`] : []),
        ].join(". ")}
      >
        {/* The card is the plain card colour: a gold wash behind the header
            clashed with the screen's pink-purple backdrop. The gold is in the
            badge alone. */}
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: `${tone}33`, borderColor: `${tone}8c` }]}>
            {prs.length > 0
              ? <Image source={TROPHY_ICON} style={styles.trophy} contentFit="contain" />
              : <DumbbellIcon size={20} color={ink} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: t.ts }]}>ACHIEVEMENTS</Text>
            <Text style={[styles.title, { color: t.tp }]}>{title}</Text>
          </View>
        </View>

        {prs.map(pr => (
          <View key={pr.exerciseName} style={[styles.row, { borderTopColor: t.div }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowName, { color: t.tp }]} numberOfLines={1}>{pr.exerciseName}</Text>
              <Text style={[styles.rowSub, { color: t.ts }]} numberOfLines={1}>
                Up from {formatWeight(pr.prevKg, isKg)}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowValue, { color: t.tp }]}>{formatWeight(pr.valueKg, isKg)}</Text>
              <View style={[styles.delta, { backgroundColor: `${ACCT}24` }]}>
                <Ionicons name="arrow-up" size={10} color={ink} />
                <Text style={[styles.deltaText, { color: ink }]}>{formatWeight(pr.valueKg - pr.prevKg, isKg)}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* The milestone under the records when there are any; on its own it's
            already the headline, so it only adds the number. */}
        {count !== null && (
          <View style={[styles.row, { borderTopColor: t.div }]}>
            {prs.length > 0 && (
              <View style={[styles.miniBadge, { backgroundColor: `${ACCT}26` }]}>
                <DumbbellIcon size={15} color={ink} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowName, { color: t.tp }]}>{ordinal(count)} workout logged</Text>
              <Text style={[styles.rowSub, { color: t.ts }]}>
                {count} workouts and counting
              </Text>
            </View>
          </View>
        )}
      </View>
    </NeuCard>
  );
}

export default memo(WorkoutAchievements);

const styles = StyleSheet.create({
  card: { marginBottom: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 },
  badge: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  trophy: { width: 22, height: 22 },
  kicker: { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 1.2 },
  title: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  rowName: { fontFamily: FontFamily.semibold, fontSize: 14 },
  rowSub: { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowValue: { fontFamily: FontFamily.bold, fontSize: 16 },
  delta: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, paddingVertical: 2, borderRadius: PILL_RADIUS },
  deltaText: { fontFamily: FontFamily.bold, fontSize: 11 },
  miniBadge: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
