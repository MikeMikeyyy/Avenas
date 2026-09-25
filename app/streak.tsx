import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NeuCard from "../components/NeuCard";
import FlameIcon, { flameHeight, flameWidth } from "../components/FlameIcon";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { useStreak } from "../contexts/StreakContext";
import {
  STREAK_TIERS,
  FLAME_PREF_KEY,
  MAX_TIER_DAYS,
  getTier,
} from "../constants/streakTiers";
import BackButton, { BACK_TOP } from "../components/BackButton";

const WEEK_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Size passed to the milestone row's flames, and the width they render at —
 *  the tier numbers underneath are laid out to that width so each sits centred
 *  under its flame. Keep the two in step. */
const MILESTONE_FLAME_SIZE = 48;
const MILESTONE_FLAME_W = flameWidth(MILESTONE_FLAME_SIZE);

/**
 * Hero flame + the soft tier-coloured circle behind it.
 *
 * The glow is absolutely positioned and LARGER than the flame's box, so it
 * overhangs it top and bottom. A margin below the hero is measured from the box,
 * not the circle — so it has to clear the overhang before it buys any visible
 * space. Deriving it means the gap survives a change to the flame size or to
 * FlameIcon's FILL, both of which silently ate into it before.
 */
const HERO_FLAME_SIZE = 160;
const HERO_GLOW_SIZE = 200;
const HERO_GLOW_OVERHANG = Math.max(0, (HERO_GLOW_SIZE - flameHeight(HERO_FLAME_SIZE)) / 2);
/** Space you actually see between the bottom of the glow and the streak number. */
const HERO_GAP = 24;

export default function StreakScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  const { streakDays, startDate, highestStreak, openedDates } = useStreak();

  const tier = getTier(streakDays);
  const isMax = streakDays >= MAX_TIER_DAYS;

  const [selectedName, setSelectedName] = useState<string>(tier.name);

  useEffect(() => {
    if (isMax) {
      AsyncStorage.getItem(FLAME_PREF_KEY).then((saved: string | null) => {
        if (saved) setSelectedName(saved);
      });
    }
  }, [isMax]);

  const selectFlame = async (name: string) => {
    setSelectedName(name);
    await AsyncStorage.setItem(FLAME_PREF_KEY, name);
  };

  const displayTier = isMax
    ? (STREAK_TIERS.find(t2 => t2.name === selectedName) ?? tier)
    : tier;

  const nextTier = isMax ? null : STREAK_TIERS.find(t2 => t2.min === tier.next) ?? null;
  const progress = isMax ? 1 : (streakDays - tier.min) / ((tier.next as number) - tier.min);
  const daysLeft = isMax ? 0 : (tier.next as number) - streakDays;

  const startStr = startDate
    ? new Date(startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  const todayIdx = (new Date().getDay() + 6) % 7;

  // Compute YYYY-MM-DD for Monday → Sunday of the current week (local time)
  const weekDates: string[] = (() => {
    const out: string[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const monday = new Date(base);
    monday.setDate(base.getDate() - todayIdx);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${day}`);
    }
    return out;
  })();

  const openedSet = new Set(openedDates);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <BackButton />

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP, paddingBottom: insets.bottom + 40 }]}
      >
        {/* Spacer preserves vertical position of flame after title removal */}
        <View style={{ height: 32 }} />

        {/* Hero flame */}
        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: displayTier.color + "20" }]} />
          <FlameIcon size={HERO_FLAME_SIZE} color={displayTier.color} />
        </View>

        {/* Streak number */}
        <View style={styles.numberRow}>
          <Text style={[styles.number, { color: t.tp }]}>{streakDays}</Text>
          <Text style={[styles.numberLabel, { color: t.tp }]}>DAY STREAK</Text>
        </View>

        {/* Stats */}
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={[styles.statVal, { color: t.tp }]}>{startStr}</Text>
              <Text style={[styles.statSub, { color: t.ts }]}>Streak started</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: t.div }]} />
            <View style={styles.statCell}>
              <Text style={[styles.statVal, { color: t.tp }]}>{highestStreak}</Text>
              <Text style={[styles.statSub, { color: t.ts }]}>Highest streak</Text>
            </View>
          </View>
        </NeuCard>

        {/* This week */}
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            <Text style={[styles.sectionLabel, { color: t.tp }]}>THIS WEEK</Text>
            <View style={styles.daysRow}>
              {WEEK_LABELS.map((label, i) => {
                const isToday = i === todayIdx;
                const isFuture = i > todayIdx;
                const done = openedSet.has(weekDates[i]);
                return (
                  <View key={label} style={styles.dayCell}>
                    <Text style={[
                      styles.dayLabel,
                      { color: isToday ? displayTier.color : t.ts },
                      isToday && { fontFamily: FontFamily.bold },
                    ]}>
                      {label}
                    </Text>
                    {done ? (
                      <View style={[styles.dayFlame, isToday && { backgroundColor: displayTier.color + "22", borderRadius: 18 }]}>
                        <FlameIcon size={36} color={displayTier.color} />
                      </View>
                    ) : isFuture ? (
                      <View style={styles.dayFlame}>
                        <View style={[styles.dayEmpty, { borderColor: t.ts }]} />
                      </View>
                    ) : (
                      <View style={styles.dayFlame}>
                        <FlameIcon size={36} color={isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </NeuCard>

        {/* Next milestone */}
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.milestoneContent}>
            {/* Label above */}
            {isMax ? (
              <Text style={[styles.milestoneText, { color: t.tp }]}>Maximum flame unlocked!</Text>
            ) : (
              <Text style={[styles.milestoneText, { color: t.tp }]}>
                {daysLeft} more {daysLeft === 1 ? "day" : "days"} to unlock your {nextTier?.name} flame
              </Text>
            )}

            {/* Flame — bar — flame on the same row */}
            <View style={styles.milestoneBarRow}>
              <View style={styles.milestoneFlame}>
                <FlameIcon size={MILESTONE_FLAME_SIZE} color={displayTier.color} />
              </View>
              <View style={[styles.progressTrack, { backgroundColor: t.div }]}>
                <View style={[styles.progressFill, {
                  width: `${Math.min(100, Math.round(progress * 100))}%`,
                  backgroundColor: displayTier.color,
                }]} />
              </View>
              <View style={[styles.milestoneFlame, { opacity: isMax ? 1 : 0.3 }]}>
                <FlameIcon size={MILESTONE_FLAME_SIZE} color={isMax ? displayTier.color : nextTier!.color} animated={isMax} />
              </View>
            </View>

            {/* Tier labels below. BOTH are muted — they're scale markers for the
                bar, not a status, so the tier colour stays on the flames and the
                bar fill. Each is laid out to the flame's RENDERED width, not its
                `size`: the icon's box hugs the artwork, so the old hardcoded 48
                centred every number under a box 20px wider than the flame really
                is, putting it ~10px off. */}
            {isMax ? (
              <Text style={[styles.milestoneTierLabel, { color: displayTier.color, textAlign: "center" }]}>MAX</Text>
            ) : (
              <View style={styles.milestoneLabelRow}>
                <Text style={[styles.milestoneTierLabel, { color: t.ts, width: MILESTONE_FLAME_W, textAlign: "center" }]}>{tier.min}</Text>
                <View style={{ flex: 1 }} />
                <Text style={[styles.milestoneTierLabel, { color: t.ts, width: MILESTONE_FLAME_W, textAlign: "center" }]}>{nextTier?.min}</Text>
              </View>
            )}
          </View>
        </NeuCard>

        {/* Flame customiser — only shown at max tier */}
        {isMax && (
          <NeuCard dark={isDark} style={styles.card}>
            <View style={styles.cardInner}>
              <Text style={[styles.sectionLabel, { color: t.tp }]}>CHOOSE YOUR FLAME</Text>
              <Text style={[styles.chooseSub, { color: t.ts }]}>
                You've reached the top. Pick your signature flame.
              </Text>
              <View style={styles.flameSelector}>
                {STREAK_TIERS.map(option => {
                  const isSelected = selectedName === option.name;
                  return (
                    <TouchableOpacity
                      key={option.name}
                      onPress={() => selectFlame(option.name)}
                      activeOpacity={0.75}
                    >
                      <View style={[
                        styles.flameOption,
                        { borderColor: isSelected ? option.color : "transparent" },
                        isSelected && { backgroundColor: option.color + "18" },
                      ]}>
                        <FlameIcon size={52} color={option.color} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </NeuCard>
        )}

        {/* Motivational */}
        <NeuCard dark={isDark} style={styles.card}>
          <View style={styles.cardInner}>
            <Text style={[styles.motivTitle, { color: t.tp }]}>Stay in it for the long game</Text>
            <Text style={[styles.motivBody, { color: t.ts }]}>
              You're building something real. Every session is a vote for the athlete you're becoming. Consistency compounds, keep showing up and watch what happens.
            </Text>
          </View>
        </NeuCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:      { paddingHorizontal: 20 },


  hero: { alignItems: "center", justifyContent: "center", marginBottom: HERO_GLOW_OVERHANG + HERO_GAP },
  glow: { position: "absolute", width: HERO_GLOW_SIZE, height: HERO_GLOW_SIZE, borderRadius: HERO_GLOW_SIZE / 2 },
  heroFlame: { width: 200, height: 200 },

  numberRow: { alignItems: "center", marginBottom: 28 },
  number: { fontFamily: FontFamily.bold, fontSize: 76, lineHeight: 84 },
  numberLabel: { fontFamily: FontFamily.bold, fontSize: 15, letterSpacing: 2, textTransform: "uppercase", marginTop: 4 },

  card: { marginBottom: 16, borderRadius: 20 },

  statsRow: { flexDirection: "row", paddingVertical: 22, paddingHorizontal: 4 },
  statCell: { flex: 1, alignItems: "center", gap: 5 },
  statDivider: { width: 1, height: 36, alignSelf: "center" },
  statVal: { fontFamily: FontFamily.bold, fontSize: 15, textAlign: "center" },
  statSub: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center" },

  cardInner: { padding: 20 },
  sectionLabel: { fontFamily: FontFamily.bold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 },
  daysRow: { flexDirection: "row" },
  dayCell: { flex: 1, alignItems: "center", gap: 8 },
  dayLabel: { fontFamily: FontFamily.regular, fontSize: 10, letterSpacing: 0.5, width: 36, textAlign: "center" },
  dayFlame:       { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dayFlameLottie: { width: 36, height: 36 },
  dayEmpty:       { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed" },

  milestoneContent:   { padding: 20, gap: 12 },
  milestoneText:      { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: "center", lineHeight: 18 },
  // gap 14, not 8: the track is flex:1, so widening the gap shortens the line
  // and pulls it off the flames rather than crowding them.
  milestoneBarRow:    { flexDirection: "row", alignItems: "center", gap: 14 },
  // Optical lift. The flame is geometrically centred on the track already, but
  // its mass sits in the bulb at the bottom, so it reads low beside a 6px line.
  // transform, so the row height and the tier labels below don't move.
  milestoneFlame:     { transform: [{ translateY: -4 }] },
  progressTrack:      { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill:       { height: "100%", borderRadius: 3 },
  milestoneLabelRow:  { flexDirection: "row", justifyContent: "space-between" },
  milestoneTierLabel: { fontFamily: FontFamily.bold, fontSize: 11 },

  chooseSub: { fontFamily: FontFamily.regular, fontSize: 13, marginBottom: 20 },
  flameSelector: { flexDirection: "row", justifyContent: "space-between" },
  flameOption: { width: 56, height: 64, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  optionFlame: { width: 52, height: 52 },

  motivTitle: { fontFamily: FontFamily.bold, fontSize: 15, marginBottom: 10 },
  motivBody: { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 22 },
});
