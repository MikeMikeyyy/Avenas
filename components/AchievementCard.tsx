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
import FlameIcon from "./FlameIcon";
import ExpandReveal, { useReveal, useRevealChevron } from "./ExpandReveal";
import { APP_DARK, APP_LIGHT, ACCT, AURORA, FontFamily, GOLD, GOLD_DARK } from "../constants/theme";
import { pill, pillGlow, PILL_H_XS } from "../constants/buttons";
import { getTier } from "../constants/streakTiers";
import type { Achievement } from "../constants/achievements";
import { describeAchievement, formatPRLine } from "../utils/achievements";
import { daysBetweenYMD, todayYMD, toYMD } from "../utils/dates";

/** The flame's size budget in the 34pt badge circle. FlameIcon renders 0.86 of
 *  it tall and about two thirds of that wide, so 26 draws a 22pt flame with a
 *  ring of the wash around it, like the other glyphs at 17–18pt. */
const FLAME_SIZE = 26;

/** "Today", "Yesterday", "3 days ago": calendar days, not 24-hour blocks. */
function earnedWhen(iso: string): string {
  const days = daysBetweenYMD(toYMD(new Date(iso)), todayYMD()) ?? 0;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function badgeFor(a: Achievement, isDark: boolean, streakColor?: string): { color: string; icon: (c: string) => React.ReactNode } {
  switch (a.category) {
    case "pr":
      return { color: isDark ? GOLD_DARK : GOLD, icon: c => <Ionicons name="trophy" size={17} color={c} /> };
    case "workouts":
      return { color: ACCT, icon: c => <DumbbellIcon size={18} color={c} /> };
    case "program":
      return { color: AURORA.aqua, icon: c => <Ionicons name="ribbon" size={17} color={c} /> };
    case "streak": {
      // The streak's own flame: the animated Lottie (components/FlameIcon.tsx),
      // the same artwork Home's streak badge and the streak page draw. It was a
      // static Ionicons flame, the only one of those left in the app.
      //
      // `streakColor` is the flame you're actually showing — once a streak
      // reaches the last tier you pick which one you wear, and the card follows
      // that choice rather than telling you your flame is a different colour
      // here. Without a choice it falls back to the tier that length earns.
      return {
        color: streakColor ?? getTier(a.days).color,
        icon: c => <FlameIcon size={FLAME_SIZE} color={c} />,
      };
    }
  }
}

function AchievementCard({ achievement, isDark, isKg, streakColor, onOpenWorkout }: {
  achievement: Achievement;
  isDark: boolean;
  isKg: boolean;
  /** The flame the streak is currently wearing (Home's `activeColor`): the one
   *  you picked at the top tier, or the tier your streak has reached. */
  streakColor?: string;
  /** Opens where the achievement happened. */
  onOpenWorkout: () => void;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  const copy = describeAchievement(achievement, isKg);
  const when = earnedWhen(achievement.earnedAt);
  const badge = badgeFor(achievement, isDark, streakColor);
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
            {/* A real button, not green text: it's the one action on this card,
                and the app's primary action everywhere else is an ACCT pill
                with white text and the accent glow. */}
            <BounceButton
              style={styles.viewRow}
              onPress={onOpenWorkout}
              accessibilityRole="button"
              accessibilityLabel="View the workout these PRs were set in"
            >
              <View style={[styles.viewBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4) }]}>
                <Text style={styles.viewText}>View workout</Text>
                <Ionicons name="chevron-forward" size={14} color="#fff" />
              </View>
            </BounceButton>
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
  // Bottom right: the list above is indented to the title, so a left-aligned
  // pill sat in that indent looking like one more PR line. At the right edge it
  // reads as where the card ends and what to do next, the same corner the
  // program pages' Summary pill and most sheets' confirm live in. alignSelf
  // keeps it only as wide as its label rather than the card.
  viewRow:   { alignSelf: "flex-end", marginTop: 8 },
  viewBtn:   { ...pill(PILL_H_XS), gap: 4, paddingHorizontal: 14 },
  viewText:  { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
});
