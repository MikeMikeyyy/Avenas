import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { BlurView } from "expo-blur";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Reanimated from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import NeuCard from "../components/NeuCard";
import ExpandReveal, { useReveal, useRevealChevron } from "../components/ExpandReveal";
import { useTheme } from "../contexts/ThemeContext";
import { APP_LIGHT, APP_DARK, FontFamily } from "../constants/theme";
import BackButton, { BACK_TOP, BACK_SIZE } from "../components/BackButton";

type ThemeColors = { bg: string; tp: string; ts: string; icon: string; div: string };

const TP = APP_LIGHT.tp;

// Every answer names things exactly as the app labels them (buttons, Settings
// rows, tab names), so someone can follow it without guessing. When a label or
// flow changes, the matching answer here has to change with it.
//
// Copy rule: no em dashes. Use a period, a comma or "like" instead.
const SECTIONS: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: "Getting Started",
    items: [
      {
        q: "How do I create a program?",
        a: "On Home, tap New Program. Give it a name, set how many weeks it runs and how many days are in the cycle, then mark each day as Training or Rest and name your workouts. Add exercises to each workout day and tap Create Program. Choose Set as Active to start following it straight away.",
      },
      {
        q: "How do I switch to a different program?",
        a: "Open My Programs from Home and tap the program you want, then choose Make Active Program. It starts from today. Only one program can be active at a time, so the one you were following is set aside.",
      },
      {
        q: "How do I start today's workout?",
        a: "Open the Workout tab, where today's workout from your active program is ready to go. Tap Start at the top to begin timing the session, tick off each set as you finish it, and tap Complete Workout when you're done.",
      },
      {
        q: "Can I work out without a program?",
        a: "Yes. Start a Custom Workout from the Workout tab (if you have an active program, tap + at the top first), give it a name and add exercises as you go. With an active program, you can also choose to add that workout to it.",
      },
    ],
  },
  {
    title: "Workouts",
    items: [
      {
        q: "How do I do a different workout today?",
        a: "Before you tap Start on the Workout tab, tap + at the top, then Change Workout Day. Pick any day from your active program or one of your other programs, or choose Rest Day.",
      },
      {
        q: "How do I log a workout I forgot to record?",
        a: "On Home, tap View Journal. Tap the day on the calendar and choose the workout you did, then fill in your sets. Tapping a day that already has a workout opens that workout instead.",
      },
      {
        q: "How do the timer and stopwatch work?",
        a: "Tap the timer icon at the top right of the Workout tab. The Timer counts down: tap the time to type your own, or use -15s and +15s, then tap Start. The Stopwatch counts up from zero.",
      },
      {
        q: "What is Focus Mode?",
        a: "Focus Mode shows one exercise at a time, with buttons to move to the previous or next one. Turn it on from + at the top of the Workout tab, or with Workout Focus Mode in Settings.",
      },
      {
        q: "What does Auto-Fill Sets do?",
        a: "When Auto-Fill Sets is on in Settings, typing a weight or number of reps on the Workout tab copies it into the sets below that you haven't ticked yet. Sets you've already ticked are never changed.",
      },
      {
        q: "How do I favourite an exercise?",
        a: "When adding exercises, tap the star on an exercise's picture. Your favourites appear at the top of the list, and the star filter beside the muscle groups shows only your favourites.",
      },
      {
        q: "Can I add my own exercises?",
        a: "Yes. When adding exercises, tap Create Custom Exercise. It's saved alongside the built-in exercises, ready for next time.",
      },
    ],
  },
  {
    title: "Schedule & Rest Days",
    items: [
      {
        q: "I can't train today. What are my options?",
        a: "Tap the day in This Week's Schedule on Home, or choose Rest Day under Change Workout Day on the Workout tab. Make Rest Day skips that workout and keeps the rest of your week as planned. Move to Tomorrow pushes it back a day, and your next rest day takes up the change so your program still finishes on time. Tap the day on Home again to undo either one.",
      },
      {
        q: "I missed a workout. Can I make it a rest day?",
        a: "Yes. Tap it in This Week's Schedule on Home and choose Make Rest Day, or, for any earlier date, tap it on the Journal calendar and choose Rest Day. Nothing else in your program changes, and tapping the day again lets you undo it. Days you've already trained can't be changed.",
      },
      {
        q: "How do I pause my program?",
        a: "Open My Programs, tap your active program and choose Pause Program. Nothing is scheduled and the weeks stop counting until you tap Resume Program, which is also on the Workout tab. When you resume, you can carry on from where you paused or pick up with today's workout. If a week goes by with no workouts logged, Avenas pauses your program for you.",
      },
      {
        q: "My program is on the wrong day. How do I fix it?",
        a: "Open My Programs, tap your active program and choose Set Workout Date, then pick which day of the cycle today should be. Any workouts you moved to another day are reset at the same time.",
      },
    ],
  },
  {
    title: "Progress & Streaks",
    items: [
      {
        q: "What does the Progress tab show?",
        a: "The chart at the top shows your volume, reps or workout time over the range you pick. Tap a bar to see its total. Below it, Strength shows how each muscle group is progressing, and tapping an exercise charts it over time.",
      },
      {
        q: "How does my streak work?",
        a: "Your streak counts the days you open Avenas. Days with no workout scheduled, like rest days or while your program is paused, never break it. You can miss opening the app on one workout day and keep your streak, but a second missed workout day starts it again.",
      },
    ],
  },
  {
    title: "Trainers & Groups",
    items: [
      {
        q: "How do I connect with my trainer?",
        a: "On the Trainer tab, tap Connect a Trainer. Share your code or QR code, or scan or type in theirs. You're linked once they accept the request.",
      },
      {
        q: "How do I get feedback on a program?",
        a: "Tap Send a Program for Review at the top of the Trainer tab, or tap the program in My Programs and choose Send to Trainer. When they send it back, it appears under From Your Trainer. Tap Accept to use their version.",
      },
      {
        q: "What are groups?",
        a: "Trainers can put clients into a group to message everyone at once and send one program to the whole group. If you're invited to a group, the invite appears on your Trainer tab. Once you join, you can use Ask for Review to have a trainer in the group look over one of your programs.",
      },
      {
        q: "Can I delete a message I sent?",
        a: "Yes, in any chat or group chat. Tap your message and choose Delete message. It's removed for everyone, and the chat shows that a message was deleted in its place. Tap someone else's message to report it.",
      },
      {
        q: "How do I switch between Gym User and Trainer?",
        a: "In Settings, open Profile, choose Gym User or Trainer under Account Type and tap Save changes. Switching from Trainer back to Gym User deletes your clients, groups and sent programs, so you'll be asked to confirm first.",
      },
    ],
  },
  {
    title: "Account & Data",
    items: [
      {
        q: "Is my data backed up?",
        a: "Yes, while you're signed in. Your programs, workout history, journal and custom exercises back up to your account automatically, and come back when you sign in on another device. A few preferences, like favourite exercises and notification settings, stay on this device.",
      },
      {
        q: "How do I switch between kg and lbs?",
        a: "Use Units in Settings. Weights you've already logged are converted, so only the unit you see changes.",
      },
      {
        q: "How do I choose which notifications I get?",
        a: "Open Notifications in Settings to turn each kind on or off, like workout reminders, streak reminders and messages, and to set the time of your workout reminder.",
      },
      {
        q: "How do I delete my account?",
        a: "Tap Delete Account at the bottom of Settings. This permanently deletes your account and all of your data, and it can't be undone.",
      },
    ],
  },
];

// Open and close is components/ExpandReveal.tsx, shared with the achievement
// cards on Home: height over 280ms with a 200ms fade, on the UI thread, and a
// second tap reverses from wherever it got to.
//
// How much closer an open answer sits to its question than the row's padding.
const ANSWER_PULL = 6;

function FAQItem({ q, a, isFirst, t, divider }: { q: string; a: string; isFirst: boolean; t: ThemeColors; divider: string }) {
  const [open, setOpen] = useState(false);
  const reveal = useReveal();
  const chevronStyle = useRevealChevron(reveal.progress);

  const toggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !open;
    setOpen(next);
    reveal.setOpen(next);
  };

  return (
    <View>
      {!isFirst && <View style={[styles.divider, { backgroundColor: divider }]} />}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={toggle}
        style={styles.row}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.question, { color: t.tp }]}>{q}</Text>
        <Reanimated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={18} color={t.ts} />
        </Reanimated.View>
      </TouchableOpacity>
      <ExpandReveal
        progress={reveal.progress}
        fade={reveal.fade}
        open={open}
        pullTop={ANSWER_PULL}
        contentStyle={styles.answerWrap}
      >
        <Text style={[styles.answer, { color: t.tp }]}>{a}</Text>
      </ExpandReveal>
    </View>
  );
}

export default function HelpFaqScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

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

      {/* A plain ScrollView, not Reanimated's: on Fabric a Reanimated-owned
          scroller doesn't reflow for children growing on the UI thread. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + BACK_TOP, paddingBottom: insets.bottom + 40 }]}
      >
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={[styles.title, { color: t.tp }]}>Help & FAQ</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: t.ts }]}>Answers to common questions</Text>

        {SECTIONS.map(section => (
          <View key={section.title}>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>{section.title}</Text>
            <NeuCard dark={isDark} style={styles.card}>
              {section.items.map((item, i) => (
                <FAQItem key={item.q} q={item.q} a={item.a} isFirst={i === 0} t={t} divider={t.div} />
              ))}
            </NeuCard>
          </View>
        ))}

        <Text style={[styles.footer, { color: t.ts }]}>
          Still need help? Use Report a Bug or Request a Feature in Settings to get in touch.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1 },
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  scroll:       { paddingHorizontal: 20 },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, height: BACK_SIZE },
  title:        { fontFamily: FontFamily.bold, fontSize: 18, color: TP },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginBottom: 20 },
  // Same section label as Settings, so the two pages read as one family.
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 },
  card:         { borderRadius: 18, marginBottom: 24 },
  row:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 18, gap: 12 },
  question:     { fontFamily: FontFamily.semibold, fontSize: 15, flex: 1 },
  answerWrap:   { paddingHorizontal: 18, paddingBottom: 18 },
  answer:       { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 21 },
  divider:      { height: 1, marginHorizontal: 16 },
  footer:       { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", marginTop: 0, marginBottom: 16, paddingHorizontal: 24, lineHeight: 19 },
});
