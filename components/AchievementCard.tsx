// One achievement under Recent Activity on Home. Deliberately a single compact
// row (badge, one-line title, one-line subtitle), about a third the height of
// a workout card, so a few of them sit above the workouts without pushing them
// off screen.
//
// A session that set several PRs stays ONE card: tapping it expands the card to
// name each PR and its numbers, with a link to the workout. It used to headline
// one exercise and say "plus N more", which meant opening the workout and
// working out for yourself which lifts those were.

import { memo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Reanimated from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import NeuCard from "./NeuCard";
import BounceButton from "./BounceButton";
import DumbbellIcon from "./DumbbellIcon";
import ExpandReveal, { useReveal, useRevealChevron } from "./ExpandReveal";
import { APP_DARK, APP_LIGHT, ACCT, AURORA, FontFamily, GOLD, GOLD_DARK } from "../constants/theme";
import { getTier } from "../constants/streakTiers";
import type { Achievement } from "../constants/achievements";
import { describeAchievement, formatPRLine } from "../utils/achievements";
import { daysBetweenYMD, todayYMD, toYMD } from "../utils/dates";

/** "Today", "Yesterday", "3 days ago": calendar days, not 24-hour blocks. */
function earnedWhen(iso: string): string {
  const days = daysBetweenYMD(toYMD(new Date(iso)), todayYMD()) ?? 0;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function badgeFor(a: Achievement, isDark: boolean): { color: string; icon: (c: string) => React.ReactNode } {
  switch (a.category) {
    case "pr":
      return { color: isDark ? GOLD_DARK : GOLD, icon: c => <Ionicons name="trophy" size={17} color={c} /> };
    case "workouts":
      return { color: ACCT, icon: c => <DumbbellIcon size={18} color={c} /> };
    case "program":
      return { color: AURORA.aqua, icon: c => <Ionicons name="ribbon" size={17} color={c} /> };
    case "streak":
      // The tier colour the streak badge and flame use at that length.
      return { color: getTier(a.days).color, icon: c => <Ionicons name="flame" size={17} color={c} /> };
  }
}

function AchievementCard({ achievement, isDark, isKg, onOpenWorkout }: {
  achievement: Achievement;
  isDark: boolean;
  isKg: boolean;
  /** Opens where the achievement happened. */
  onOpenWorkout: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const copy = describeAchievement(achievement, isKg);
  const when = earnedWhen(achievement.earnedAt);
  const badge = badgeFor(achievement, isDark);
  // Only a multi-PR session has more to say than its own subtitle, so only it
  // expands; every other card goes straight where it happened.
  const prs = achievement.category === "pr" ? achievement.prs : [];
  const expandable = prs.length > 1;

  const [open, setOpen] = useState(false);
  const reveal = useReveal();
  const chevronStyle = useRevealChevron(reveal.progress);

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !open;
    setOpen(next);
    reveal.setOpen(next);
  };

  const row = (
    <View style={styles.row}>
      {/* The badge colour alone at ~15% for the wash, full strength for the glyph. */}
      <View style={[styles.badge, { backgroundColor: `${badge.color}26` }]}>
        {badge.icon(badge.color)}
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: t.tp }]} numberOfLines={1}>{copy.title}</Text>
        <Text style={[styles.detail, { color: t.ts }]} numberOfLines={1}>{`${copy.detail} · ${when}`}</Text>
      </View>
      {expandable
        ? <Reanimated.View style={chevronStyle}><Ionicons name="chevron-down" size={15} color={t.ts} /></Reanimated.View>
        : <Ionicons name="chevron-forward" size={15} color={t.ts} />}
    </View>
  );

  if (!expandable) {
    return (
      <BounceButton
        style={styles.wrap}
        onPress={onOpenWorkout}
        accessibilityRole="button"
        accessibilityLabel={`${copy.title}. ${copy.detail}. ${when}.`}
      >
        <NeuCard dark={isDark} radius={16}>{row}</NeuCard>
      </BounceButton>
    );
  }

  return (
    <View style={styles.wrap}>
      <NeuCard dark={isDark} radius={16}>
        <View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${copy.title}: ${copy.detail}. ${when}. Tap for details`}
          >
            {row}
          </TouchableOpacity>
          <ExpandReveal progress={reveal.progress} fade={reveal.fade} open={open} contentStyle={styles.prList}>
            {prs.map(pr => (
              <View key={pr.exerciseName} style={styles.prRow}>
                <Text style={[styles.prName, { color: t.tp }]} numberOfLines={1}>{pr.exerciseName}</Text>
                <Text style={[styles.prValue, { color: t.ts }]} numberOfLines={1}>{formatPRLine(pr, isKg)}</Text>
              </View>
            ))}
            <TouchableOpacity
              onPress={onOpenWorkout}
              activeOpacity={0.7}
              style={styles.viewRow}
              accessibilityRole="button"
              accessibilityLabel="View the workout these PRs were set in"
            >
              <Text style={[styles.viewText, { color: ACCT }]}>View workout</Text>
              <Ionicons name="chevron-forward" size={13} color={ACCT} />
            </TouchableOpacity>
          </ExpandReveal>
        </View>
      </NeuCard>
    </View>
  );
}

export default memo(AchievementCard);

const styles = StyleSheet.create({
  wrap:      { marginBottom: 8 },
  row:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  badge:     { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  text:      { flex: 1 },
  title:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  detail:    { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  // Indented to the title, so the list reads as belonging to the row above.
  prList:    { paddingLeft: 60, paddingRight: 14, paddingBottom: 12, gap: 6 },
  prRow:     { gap: 1 },
  prName:    { fontFamily: FontFamily.semibold, fontSize: 13 },
  prValue:   { fontFamily: FontFamily.regular, fontSize: 12 },
  viewRow:   { flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 4 },
  viewText:  { fontFamily: FontFamily.semibold, fontSize: 13 },
});
