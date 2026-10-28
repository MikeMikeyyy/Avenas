// "My Trainers" (gym-user side): the list on the /my-trainers page, every
// trainer the user is connected to in one flat list, the one on their Trainer
// tab first with a small "PRIMARY" tag. Mirrors the MyCoachesSection structure
// used on the trainer side.
//
// Tapping a trainer puts them on the Trainer tab (their card, Message, Send for
// Review) and goes back to it. A trainer who's messaged you says so on their
// card, with the red count (user decision, 2026-10-21: a gym user's tab has no
// Messages button, so this is where messages from the trainers who aren't on
// it are found). "Remove a trainer" sits at the foot of the list; the connect
// button at the top right of the page adds one. Anyone else they're connected
// with (another gym user, by code) is under OTHER CONNECTIONS below, a tap
// away from their chat. The search field over the list (SearchField, the
// faded one) finds anyone on the page by name, in both lists.
//
// The list is DERIVED from real accepted connections whose counterpart holds a
// trainer account (utils/roster.ts), merged with any local/mock entries — the
// connect handshake writes no local roster, so reading a local key here is what
// used to leave this page permanently empty.

import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";

import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import Avatar from "../Avatar";
import UnreadBadge from "../UnreadBadge";
import SearchField from "../SearchField";
import PeopleIcon from "../icons/PeopleIcon";
import { RemoveCircleButton, RemoveModeBar } from "./RemoveMode";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { darkGlow, pill, pillGlow, PILL_H_SM } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { resolveMyTrainers } from "../../utils/roster";
import { featureTrainer, peekGymHub } from "../../utils/trainerHub";
import { unaddContact } from "../../utils/moderation";
import { isActiveNow, presenceLabel } from "../../utils/presence";
import type { AssignedPT } from "../../utils/trainerStore";

export default function MyTrainersSection({ presenceById, unreadByPerson }: {
  /** Live "last active" for connected trainers (the page's useConnectionPresence);
   *  local/mock entries aren't in it and show no presence line. */
  presenceById: Map<string, string | null>;
  /** Each person's unread messages (the page's useUnreadMessages). */
  unreadByPerson: Record<string, number>;
}) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";

  // The Trainer tab's copy lists every trainer (utils/trainerHub.ts), so the
  // page opens on them rather than on nothing while the connections load, and
  // keeps them with no signal, when the server can't say who they are.
  const [trainers, setTrainers] = useState<AssignedPT[]>(() => peekGymHub(owner)?.trainers ?? []);
  const [primaryId, setPrimaryId] = useState<string | null>(() => peekGymHub(owner)?.pt?.id ?? null);
  /** Everyone else I'm connected with: a gym user who connected by code
   *  (utils/roster.ts). Without this, a chat with them had no way in once the
   *  tab lost its Messages button. */
  const [others, setOthers] = useState<AssignedPT[]>(() => peekGymHub(owner)?.others ?? []);
  /** "Remove a trainer" was tapped: each card shows a red minus (RemoveMode.tsx). */
  const [removing, setRemoving] = useState(false);
  // An empty list means "none" only once we've looked. Without this the page
  // said "No trainers yet" to people with trainers, for as long as the
  // connections lookup took.
  const [loaded, setLoaded] = useState(() => !!peekGymHub(owner)?.trainers);
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    try {
      const { all, primary, others: people, live } = await resolveMyTrainers();
      // Offline the resolver knows only the featured trainer, and nobody
      // else: the rest stay as the tab's copy last had them.
      const held = live ? [] : (peekGymHub(owner)?.trainers ?? []).filter(t => !all.some(a => a.id === t.id));
      const next = [...all, ...held];
      setTrainers(next);
      setPrimaryId(primary?.id ?? null);
      setOthers(live ? people : peekGymHub(owner)?.others ?? []);
      // Nobody left to remove: out of remove mode.
      if (next.length === 0) setRemoving(false);
    } catch (err) {
      if (__DEV__) console.warn("[avenas] resolve trainers", err);
    } finally {
      setLoaded(true);
    }
  }, [owner]);

  // useFocusEffect (not useEffect) — the route may stay mounted when the user
  // navigates back, so we need to refresh whenever the screen regains focus.
  useFocusEffect(useCallback(() => {
    void reload();
    // Leaving the page ends remove mode, so it never greets you on the way back.
    return () => { setRemoving(false); };
  }, [reload]));

  const handleConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate("/connect");
  }, [router]);

  // Tapping a trainer puts them on the Trainer tab and goes back to it, so you
  // see them there straight away (featureTrainer updates the tab's saved copy
  // too). The rest of the list is derived, so nothing is lost on the swap.
  const handlePickTrainer = useCallback(async (pt: AssignedPT, isPrimary: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isPrimary) await featureTrainer(owner, pt);
    router.back();
  }, [owner, router]);

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

  // "Remove a trainer": a red minus on each card rather than an alert listing
  // every trainer, which didn't scale past a few (components/trainer/RemoveMode.tsx).
  const startRemoving = useCallback(() => {
    setRemoving(true);
  }, []);

  /** Someone who isn't a trainer: their chat, as there's nothing to switch to.
   *  Removing them is in the chat's own menu (Remove connection). */
  const openChat = useCallback((p: AssignedPT) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({
      pathname: "/trainer/chat/[id]",
      params: { id: p.id, name: p.name, initials: p.initials, photo: p.photoUri ?? "" },
    });
  }, [router]);

  const all = trainers.map(trainer => ({ trainer, isPrimary: trainer.id === primaryId }));
  const q = search.trim().toLowerCase();
  const shown = q ? all.filter(({ trainer }) => trainer.name.toLowerCase().includes(q)) : all;
  const shownOthers = q ? others.filter(p => p.name.toLowerCase().includes(q)) : others;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sub, { color: t.ts }]}>
        Tap a trainer to chat with them and send them programs.
      </Text>

      {loaded && all.length + others.length > 0 && (
        <SearchField value={search} onChangeText={setSearch} placeholder="Search by name" style={styles.search} />
      )}
      {q && shown.length === 0 && shownOthers.length === 0 ? (
        <Text style={[styles.noMatch, { color: t.ts }]}>No people match “{search.trim()}”.</Text>
      ) : null}

      {!loaded ? null : all.length === 0 ? (
        <NeuCard dark={isDark} radius={20} style={{ marginTop: 12 }}>
          <View style={styles.emptyInner}>
            <View style={[styles.emptyIcon, { backgroundColor: isDark ? `${ACCT}1A` : `${ACCT}24` }]}>
              <PeopleIcon size={28} color={ACCT} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.tp }]}>No trainers yet</Text>
            <Text style={[styles.emptyBody, { color: t.ts }]}>
              Connect with a trainer to share programs and get feedback on your progress.
            </Text>
            <BounceButton style={{ marginTop: 8 }} onPress={handleConnect}>
              <View style={[styles.cta, { backgroundColor: ACCT }, darkGlow(styles.cta, isDark)]}>
                <Text style={styles.ctaText}>Connect a Trainer</Text>
              </View>
            </BounceButton>
          </View>
        </NeuCard>
      ) : (
        <>
          {removing && <RemoveModeBar isDark={isDark} onDone={() => setRemoving(false)} />}
          <View style={{ marginTop: shown.length > 0 ? 12 : 0, gap: 10 }}>
            {shown.map(({ trainer, isPrimary }) => {
              const unread = unreadByPerson[trainer.id] ?? 0;
              // What's new from them first: that's why you'd come here.
              const line = unread > 0
                ? (unread === 1 ? "Sent you a message" : `Sent you ${unread} messages`)
                : isPrimary ? "On your Trainer tab" : "Tap to switch";
              const lastActive = presenceById.get(trainer.id);
              return (
                <TouchableOpacity
                  key={trainer.id}
                  activeOpacity={0.85}
                  // While removing, only the minus does anything: a stray tap
                  // mustn't switch your primary trainer.
                  disabled={removing}
                  onPress={() => handlePickTrainer(trainer, isPrimary)}
                  accessibilityRole="button"
                  accessibilityLabel={`${trainer.name}, ${isPrimary ? "on your Trainer tab" : "switch to them"}${unread > 0 ? `, ${unread} unread` : ""}`}
                >
                  <NeuCard dark={isDark} radius={16}>
                    <View style={styles.trainerCard}>
                      <Avatar
                        uri={trainer.photoUri}
                        initials={trainer.initials}
                        size={48}
                        backgroundColor={isDark ? `${ACCT}1F` : `${ACCT}2E`}
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
                        <Text
                          style={[styles.trainerLine, unread > 0 ? { color: t.tp, fontFamily: FontFamily.bold } : { color: t.ts }]}
                          numberOfLines={1}
                        >
                          {line}
                        </Text>
                        {lastActive ? (
                          // Not connected, never active, or sharing off: no line.
                          <View style={styles.presenceRow}>
                            <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                            <Text style={[styles.presenceText, { color: t.ts }]}>{presenceLabel(lastActive)}</Text>
                          </View>
                        ) : null}
                      </View>
                      {removing ? (
                        <RemoveCircleButton onPress={() => handleRemove(trainer)} accessibilityLabel={`Remove ${trainer.name}`} />
                      ) : (
                        <>
                          <UnreadBadge count={unread} />
                          <Ionicons name="chevron-forward" size={16} color={t.ts} />
                        </>
                      )}
                    </View>
                  </NeuCard>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Quiet, at the foot: removing someone is rare, and the page's one
              button is for adding. */}
          {!removing && shown.length > 0 ? (
            <BounceButton style={styles.removeRow} onPress={startRemoving} needsConnection accessibilityLabel="Remove a trainer">
              <Text style={[styles.removeText, { color: t.ts }]}>Remove a trainer</Text>
            </BounceButton>
          ) : null}
        </>
      )}

      {/* Everyone else you're connected with (another gym user who connected
          by code), under their own heading so a chat with them always has a
          way in: the tab has no Messages button (user decision, 2026-10-22).
          Only when there's someone. */}
      {loaded && shownOthers.length > 0 ? (
        <>
          <Text style={[styles.sectionLabel, { color: t.ts }]}>OTHER CONNECTIONS</Text>
          <View style={{ gap: 10 }}>
            {shownOthers.map(person => {
              const unread = unreadByPerson[person.id] ?? 0;
              const lastActive = presenceById.get(person.id);
              return (
                <TouchableOpacity
                  key={person.id}
                  activeOpacity={0.85}
                  disabled={removing}
                  onPress={() => openChat(person)}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${person.name}${unread > 0 ? `, ${unread} unread` : ""}`}
                >
                  <NeuCard dark={isDark} radius={16}>
                    <View style={styles.trainerCard}>
                      <Avatar
                        uri={person.photoUri}
                        initials={person.initials}
                        size={48}
                        backgroundColor={isDark ? `${ACCT}1F` : `${ACCT}2E`}
                        textColor={ACCT}
                        textStyle={[styles.avatarText, { color: ACCT }]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.trainerName, { color: t.tp }]} numberOfLines={1}>{person.name}</Text>
                        <Text
                          style={[styles.trainerLine, unread > 0 ? { color: t.tp, fontFamily: FontFamily.bold } : { color: t.ts }]}
                          numberOfLines={1}
                        >
                          {unread > 0 ? (unread === 1 ? "Sent you a message" : `Sent you ${unread} messages`) : "Tap to message"}
                        </Text>
                        {lastActive ? (
                          <View style={styles.presenceRow}>
                            <View style={[styles.presenceDot, { backgroundColor: isActiveNow(lastActive) ? ACCT : t.ts }]} />
                            <Text style={[styles.presenceText, { color: t.ts }]}>{presenceLabel(lastActive)}</Text>
                          </View>
                        ) : null}
                      </View>
                      <UnreadBadge count={unread} />
                      <Ionicons name="chevron-forward" size={16} color={t.ts} />
                    </View>
                  </NeuCard>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:         { marginBottom: 8 },
  sub:          { fontFamily: FontFamily.regular, fontSize: 13 },
  search:       { marginTop: 12 },
  // Messages' "No people match", value for value.
  noMatch:      { fontFamily: FontFamily.regular, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  // The program pages' section labels (TO ACCEPT, ADDED), value for value.
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.6, marginTop: 24, marginBottom: 8, marginLeft: 4 },

  emptyInner:   { padding: 24, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 16, textAlign: "center" },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta:          { ...pill(PILL_H_SM), paddingHorizontal: 22, ...pillGlow(ACCT, 0.4) },
  ctaText:      { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },

  trainerCard:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatarText:   { fontFamily: FontFamily.bold, fontSize: 16 },
  presenceRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  presenceDot:  { width: 6, height: 6, borderRadius: 3 },
  presenceText: { fontFamily: FontFamily.regular, fontSize: 12 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  trainerName:  { fontFamily: FontFamily.bold, fontSize: 16, flexShrink: 1 },
  trainerLine:  { fontFamily: FontFamily.semibold, fontSize: 12, marginTop: 2 },
  primaryTag:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  primaryTagText: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },
  removeRow:    { alignSelf: "center", marginTop: 14 },
  removeText:   { fontFamily: FontFamily.bold, fontSize: 14, paddingHorizontal: 12, lineHeight: 44 },
});
