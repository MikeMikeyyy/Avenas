// "My Trainers" (gym-user side) — a section rendered inside the standalone
// /my-trainers route. Lists every trainer the user is connected to (primary +
// additional) in one flat list. The primary trainer is marked with a small
// "PRIMARY" tag. Mirrors the MyCoachesSection structure used on the trainer side.
//
// The list is DERIVED from real accepted connections whose counterpart holds a
// trainer account (utils/roster.ts), merged with any local/mock entries — the
// connect handshake writes no local roster, so reading a local key here is what
// used to leave this page permanently empty.

import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import PeopleIcon from "../icons/PeopleIcon";
import { RemoveCircleButton, RemoveModeBar } from "./RemoveMode";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { pill, PILL_H_SM } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { resolveMyTrainers, setPrimaryTrainer } from "../../utils/roster";
import { unaddContact } from "../../utils/moderation";
import { useConnectionPresence } from "../../hooks/useConnectionPresence";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import type { AssignedPT } from "../../utils/trainerStore";

export interface MyTrainersSectionRef {
  openMenu: () => void;
}

const MyTrainersSection = forwardRef<MyTrainersSectionRef, {}>(function MyTrainersSection(_props, ref) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();

  // Live "last active" for connected trainers; local/mock entries aren't in the
  // map and show no presence row.
  const { presenceById } = useConnectionPresence();

  const [trainers, setTrainers] = useState<AssignedPT[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  /** "Remove a Trainer" was picked: each card shows a red minus (RemoveMode.tsx). */
  const [removing, setRemoving] = useState(false);
  // An empty list means "none" only once we've looked. Without this the page
  // said "No trainers yet" to people with trainers, for as long as the
  // connections lookup took.
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { all, primary } = await resolveMyTrainers();
      setTrainers(all);
      setPrimaryId(primary?.id ?? null);
      // Nobody left to remove: out of remove mode.
      if (all.length === 0) setRemoving(false);
    } catch (err) {
      if (__DEV__) console.warn("[avenas] resolve trainers", err);
    } finally {
      setLoaded(true);
    }
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
    // Leaving the page ends remove mode, so it never greets you on the way back.
    return () => { cancelled = true; setRemoving(false); };
  }, [reload]));

  const handleConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/connect");
  }, [router]);

  // Tapping a trainer makes them the active (primary) one and returns to
  // MyPTHome so the user immediately sees that trainer's header + programs.
  // The rest of the list is derived, so nothing is lost on the swap.
  const handlePickTrainer = useCallback(async (pt: AssignedPT, isPrimary: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPrimary) {
      router.back();
      return;
    }
    await setPrimaryTrainer(pt);
    router.back();
  }, [router]);

  const handleRemove = useCallback((pt: AssignedPT) => {
    Alert.alert(
      "Remove Trainer",
      `Stop being coached by ${pt.name}? Any programs you've already accepted will stay in your library.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // unaddContact (not a local-only delete): this list is derived from
            // live connections, so without the server-side sever they'd simply
            // reappear on the next focus.
            const { severed } = await unaddContact(pt.id, "gym_user");
            await reload();
            if (!severed) {
              Alert.alert(
                "Couldn't remove them",
                `We couldn't reach the server to disconnect from ${pt.name}. Check your connection and try again.`,
              );
            }
          },
        },
      ]
    );
  }, [reload]);

  // "Remove a Trainer": a red minus on each card rather than an alert listing
  // every trainer, which didn't scale past a few (components/trainer/RemoveMode.tsx).
  const startRemoving = useCallback(() => {
    if (trainers.length === 0) {
      Alert.alert("No trainers", "You haven't connected to any trainers yet.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRemoving(true);
  }, [trainers]);

  // Top-right plus button entry — offers both add and remove paths.
  const openMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Manage Trainers",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add a Trainer", onPress: handleConnect },
        { text: "Remove a Trainer", style: "destructive", onPress: startRemoving },
      ],
    );
  }, [handleConnect, startRemoving]);

  useImperativeHandle(ref, () => ({ openMenu }), [openMenu]);

  const all = trainers.map(trainer => ({ trainer, isPrimary: trainer.id === primaryId }));

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { color: t.ts }]}>
        {"Trainers you're connected with. Programs they send appear on your My Trainer page."}
      </Text>

      {!loaded ? null : all.length === 0 ? (
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
        <>
        {removing && <RemoveModeBar isDark={isDark} onDone={() => setRemoving(false)} />}
        <View style={{ marginTop: 12, gap: 10 }}>
          {all.map(({ trainer, isPrimary }) => (
            <TouchableOpacity
              key={trainer.id}
              activeOpacity={0.85}
              // While removing, only the minus does anything: a stray tap
              // mustn't switch your primary trainer.
              disabled={removing}
              onPress={() => handlePickTrainer(trainer, isPrimary)}
              accessibilityRole="button"
              accessibilityLabel={isPrimary ? `${trainer.name}, primary trainer` : `Switch to ${trainer.name}`}
            >
              <NeuCard dark={isDark} radius={16}>
                <View style={styles.trainerCard}>
                  <Avatar
                    uri={trainer.photoUri}
                    initials={trainer.initials}
                    size={48}
                    backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
                    textColor={ACCT}
                    textStyle={[styles.avatarText, { color: ACCT }]}
                  />
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
                    {(() => {
                      const lastActive = presenceById.get(trainer.id);
                      if (!lastActive) return null; // not connected, never active, or sharing off
                      return (
                        <View style={styles.presenceRow}>
                          <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                          <Text style={[styles.presenceText, { color: t.ts }]}>{presenceLabel(lastActive)}</Text>
                        </View>
                      );
                    })()}
                  </View>
                  {removing && (
                    <RemoveCircleButton onPress={() => handleRemove(trainer)} accessibilityLabel={`Remove ${trainer.name}`} />
                  )}
                </View>
              </NeuCard>
            </TouchableOpacity>
          ))}
        </View>
        </>
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
  cta:          { ...pill(PILL_H_SM), paddingHorizontal: 22, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },

  trainerCard:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 16 },
  presenceRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  presenceDot:  { width: 6, height: 6, borderRadius: 3 },
  presenceText: { fontFamily: FontFamily.regular, fontSize: 12 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  trainerName:  { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  trainerLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  primaryTag:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  primaryTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
});
