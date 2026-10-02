// One achievement under Recent Activity on Home. Deliberately a single compact
// row (badge, one-line title, one-line subtitle), about a third the height of
// a workout card, so a few of them sit above the workouts without pushing them
// off screen.
//
// A session that set several PRs stays ONE card: tapping it expands the card to
// name each PR and its numbers, with a link to the workout. It used to headline
// one exercise and say "plus N more", which meant opening the workout and
// working out for yourself which lifts those were.
//
// The records sit on a gold rail down the blank column beside the list: a
// glowing dot at each record, joined by a line that starts at the first dot
// and ends at the last, so it runs as far as there are records and a single
// record is a dot alone. It used to hang from the trophy, starting under the
// badge (user decision, 2026-10-02). The reveal draws it downward as the card
// opens. Every piece of it is laid out beside what it marks (the dot centred
// on its exercise's name line, the line stretched to each row's height)
// rather than placed by measured numbers, so it holds at any text size.

import { memo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Reanimated from "react-native-reanimated";
import { Image } from "expo-image";
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
import { TROPHY_ICON } from "../constants/icons";
import type { Achievement } from "../constants/achievements";
import { describeAchievement, formatPRLine } from "../utils/achievements";
import { daysBetweenYMD, todayYMD, toYMD } from "../utils/dates";

/** The flame's size budget in the 34pt badge circle. FlameIcon renders 0.86 of
 *  it tall and about two thirds of that wide, so 26 draws a 22pt flame with a
 *  ring of the wash around it, like the other glyphs at 17–18pt. */
const FLAME_SIZE = 26;

/** The PR trophy is full-colour artwork, so it ignores the badge colour (which
 *  still tints the wash behind it). It fills its square edge to edge, so 20
 *  weighs about the same as the 17–18pt glyphs on the other cards. */
const TROPHY_SIZE = 20;

/** The summary row's geometry, which the PR rail lines up with. */
const ROW_PAD_X = 14;
const BADGE = 34;
const ROW_GAP = 12;
/** Where the title (and every PR name under it) starts. */
const TEXT_INSET = ROW_PAD_X + BADGE + ROW_GAP;
/** The rail runs down the badge's centre line. */
const RAIL_X = ROW_PAD_X + BADGE / 2;
const RAIL_W = 2;
/** A record's dot on the rail. */
const NODE = 8;

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
      return { color: isDark ? GOLD_DARK : GOLD, icon: () => <Image source={TROPHY_ICON} style={styles.trophy} contentFit="contain" /> };
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

  // The dots glow like a lit dot on a workout card's session rail, quieter on
  // dark, where the same bloom reads far stronger (as FavouriteStar's does).
  const rail = { backgroundColor: badge.color };
  const node = {
    backgroundColor: badge.color,
    shadowColor: badge.color,
    shadowOpacity: isDark ? 0.5 : 0.8,
    shadowRadius: isDark ? 2.5 : 3.5,
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
            {prs.map((pr, i) => {
              // The line runs from the first dot to the last: up from every
              // dot but the first, down from every dot but the last.
              const before = i > 0;
              const more = i < prs.length - 1;
              return (
                <View key={pr.exerciseName}>
                  <View style={styles.prHead}>
                    <View style={styles.railCell}>
                      <View style={[styles.railLine, before && rail]} />
                      <View style={[styles.node, node]} />
                      <View style={[styles.railLine, more && rail]} />
                    </View>
                    <Text style={[styles.prName, { color: t.tp }]} numberOfLines={1}>{pr.exerciseName}</Text>
                  </View>
                  <View style={styles.prFoot}>
                    <View style={styles.railCell}>
                      {more && <View style={[styles.railLine, rail]} />}
                    </View>
                    <Text style={[styles.prValue, { color: t.ts }]} numberOfLines={1}>{formatPRLine(pr, isKg)}</Text>
                  </View>
                </View>
              );
            })}
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
  row:       { flexDirection: "row", alignItems: "center", gap: ROW_GAP, paddingHorizontal: ROW_PAD_X, paddingVertical: 11 },
  badge:     { width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: "center", justifyContent: "center" },
  trophy:    { width: TROPHY_SIZE, height: TROPHY_SIZE },
  text:      { flex: 1 },
  title:     { fontFamily: FontFamily.semibold, fontSize: 14 },
  detail:    { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  // Indented to the title, so the list reads as belonging to the row above,
  // with the rail down the indent. No gaps between rows: each row's space is
  // its own padding, which the rail beside it stretches over, so the line
  // never breaks.
  prList:    { paddingRight: ROW_PAD_X, paddingBottom: 12 },
  prHead:    { flexDirection: "row", alignItems: "center" },
  prFoot:    { flexDirection: "row" },
  // As tall as its row. On the name's line the two lengths of rail share the
  // height either side of the dot, which centres it on the name.
  railCell:  { width: TEXT_INSET, alignSelf: "stretch" },
  railLine:  { flex: 1, width: RAIL_W, marginLeft: RAIL_X - RAIL_W / 2 },
  node:      { width: NODE, height: NODE, borderRadius: NODE / 2, marginLeft: RAIL_X - NODE / 2, shadowOffset: { width: 0, height: 0 } },
  prName:    { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  prValue:   { flex: 1, fontFamily: FontFamily.regular, fontSize: 12, paddingTop: 1, paddingBottom: 6 },
  // Bottom right: the list above is indented to the title, so a left-aligned
  // pill sat in that indent looking like one more PR line. At the right edge it
  // reads as where the card ends and what to do next, the same corner the
  // program pages' Summary pill and most sheets' confirm live in. alignSelf
  // keeps it only as wide as its label rather than the card.
  viewRow:   { alignSelf: "flex-end", marginTop: 8 },
  viewBtn:   { ...pill(PILL_H_XS), gap: 4, paddingHorizontal: 14 },
  viewText:  { fontFamily: FontFamily.bold, fontSize: 13, color: "#fff" },
});
