// "My Trainers" — a section rendered inside the standalone /my-trainers route.
// Lists every trainer the gym user is connected to (primary + additional)
// in one flat list. The primary trainer is marked with a small "PRIMARY" tag.
// Mirrors the MyCoachesSection structure used on the trainer side.

import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import PeopleIcon from "../icons/PeopleIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  loadAssignedPT,
  loadOtherTrainers,
  removeOtherTrainer,
  saveAssignedPT,
  saveOtherTrainers,
  type AssignedPT,
} from "../../utils/trainerStore";

export interface MyTrainersSectionRef {
  openMenu: () => void;
}

const MyTrainersSection = forwardRef<MyTrainersSectionRef, {}>(function MyTrainersSection(_props, ref) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();

  const [primary, setPrimary] = useState<AssignedPT | null>(null);
  const [others, setOthers] = useState<AssignedPT[]>([]);

  const reload = useCallback(async () => {
    const [p, os] = await Promise.all([loadAssignedPT(), loadOtherTrainers()]);
    setPrimary(p);
    setOthers(os);
  }, []);

  // useFocusEffect (not useEffect) — the route may stay mounted when the user
  // navigates back, so we need to refresh whenever the screen regains focus
  // (e.g. after returning from MyPTHome post-swap).
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      await reload();
      if (cancelled) {/* no-op */}
    })();
    return () => { cancelled = true; };
  }, [reload]));

  const handleConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/connect");
  }, [router]);

  // Tapping a trainer makes them the active (primary) one and returns to
  // MyPTHome so the user immediately sees that trainer's header + programs.
  // The previously-primary trainer is demoted to the "others" list so nothing
  // is lost on the swap.
  const handlePickTrainer = useCallback(async (pt: AssignedPT, isPrimary: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPrimary) {
      router.back();
      return;
    }
    const nextOthers = others.filter(o => o.id !== pt.id);
    if (primary) nextOthers.push(primary);
    await saveOtherTrainers(nextOthers);
    await saveAssignedPT(pt);
    router.back();
  }, [primary, others, router]);

  const handleRemove = useCallback((pt: AssignedPT, isPrimary: boolean) => {
    const label = isPrimary
      ? `Remove ${pt.name} as your primary trainer? Any programs you've already accepted will stay in your library.`
      : `Stop being coached by ${pt.name}? Any programs you've already accepted will stay in your library.`;
    Alert.alert(
      "Remove Trainer",
      label,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (isPrimary) await saveAssignedPT(null);
            else await removeOtherTrainer(pt.id);
            await reload();
          },
        },
      ]
    );
  }, [reload]);

  // Step into "remove" sub-menu — lists every trainer as an Alert button so
  // the user can pick which one to remove. Cancel returns to nothing.
  const openRemovePicker = useCallback(() => {
    if (!primary && others.length === 0) {
      Alert.alert("No trainers", "You haven't connected to any trainers yet.");
      return;
    }
    const all: { trainer: AssignedPT; isPrimary: boolean }[] = [
      ...(primary ? [{ trainer: primary, isPrimary: true }] : []),
      ...others.map(o => ({ trainer: o, isPrimary: false })),
    ];
    Alert.alert(
      "Remove a Trainer",
      "Pick a trainer to remove.",
      [
        { text: "Cancel", style: "cancel" },
        ...all.map(({ trainer, isPrimary }) => ({
          text: isPrimary ? `${trainer.name} (Primary)` : trainer.name,
          style: "destructive" as const,
          onPress: () => handleRemove(trainer, isPrimary),
        })),
      ],
    );
  }, [primary, others, handleRemove]);

  // Top-right plus button entry — offers both add and remove paths.
  const openMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Manage Trainers",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add a Trainer", onPress: handleConnect },
        { text: "Remove a Trainer", style: "destructive", onPress: openRemovePicker },
      ],
    );
  }, [handleConnect, openRemovePicker]);

  useImperativeHandle(ref, () => ({ openMenu }), [openMenu]);

  const all: { trainer: AssignedPT; isPrimary: boolean }[] = [
    ...(primary ? [{ trainer: primary, isPrimary: true }] : []),
    ...others.map(o => ({ trainer: o, isPrimary: false })),
  ];

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { color: t.ts }]}>
        Trainers you're connected with — programs they send appear on your My Trainer page.
      </Text>

      {all.length === 0 ? (
        <NeuCard dark={isDark} radius={20} style={{ marginTop: 12 }}>
          <View style={styles.emptyInner}>
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
              <PeopleIcon size={28} color={ACCT} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainers yet</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>
              Connect with a trainer to share programs and get feedback on your progress.
            </Text>
            <BounceButton style={{ marginTop: 8 }} onPress={handleConnect}>
              <View style={[styles.cta, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <Text style={styles.ctaText}>Connect a Trainer</Text>
              </View>
            </BounceButton>
          </View>
        </NeuCard>
      ) : (
        <View style={{ marginTop: 12, gap: 10 }}>
          {all.map(({ trainer, isPrimary }) => (
            <TouchableOpacity
              key={trainer.id}
              activeOpacity={0.85}
              onPress={() => handlePickTrainer(trainer, isPrimary)}
              accessibilityRole="button"
              accessibilityLabel={isPrimary ? `${trainer.name}, primary trainer` : `Switch to ${trainer.name}`}
            >
              <NeuCard dark={isDark} radius={16}>
                <View style={styles.trainerCard}>
                  <View style={[styles.avatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                    <Text style={[styles.avatarText, { color: ACCT }]}>{trainer.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.trainerName, { color: t.tp }]} numberOfLines={1}>{trainer.name}</Text>
                      {isPrimary && (
                        <View style={[styles.primaryTag, { backgroundColor: `${ACCT}22` }]}>
                          <Text style={[styles.primaryTagText, { color: ACCT }]}>PRIMARY</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.trainerLabel, { color: t.ts }]}>
                      {isPrimary ? "TRAINER" : "TAP TO SWITCH"}
                    </Text>
                  </View>
                </View>
              </NeuCard>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

export default MyTrainersSection;

const styles = StyleSheet.create({
  wrap:         { marginBottom: 8 },
  sub:          { fontFamily: FontFamily.regular, fontSize: 13 },

  emptyInner:   { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta:          { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },

  trainerCard:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar:       { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 16 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  trainerName:  { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  trainerLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  primaryTag:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  primaryTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
});
