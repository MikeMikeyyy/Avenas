// app/trainer/sent-reviews.tsx
//
// A gym user's Sent for Review page, opened from the second tile on their
// Trainer tab (components/trainer/MyPTHome.tsx; user decisions, 2026-10-21, the
// Trainer Page canvas, "Tap Sent for Review"): Send a Program for Review at the
// top, then what they've asked for, each row saying where it stands. Still
// waiting on a trainer reads "Awaiting review", in the trainer's own orange
// (ReviewStatusPill, so both ends of a review say the same thing); one a
// trainer removed without sending it back reads "Not reviewed", in red, with
// who removed it and when (user request, 2026-10-29: it read "Awaiting review"
// for good); one they've taken the changes from reads "Accepted". One sent back
// and not taken up yet is on the From page instead, since it's waiting on them
// now.
//
// Each row opens in place, as on the trainer's Programs page
// (components/trainer/ProgramRow.tsx): its cycle, with View and Remove. Remove
// on one still waiting takes it back from the trainer (they won't see it any
// more; your own copy stays); on one not reviewed it clears it for good. On one
// accepted it only tidies this list, on this phone, and the changes stay in
// your programs.
//
// It reads and saves the same page copy as the Trainer tab (utils/trainerHub.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../constants/floatingBars";
import { useFloatingBarsReach } from "../../hooks/useFloatingBars";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../../components/MaskedView";
import * as Haptics from "expo-haptics";

import FadeScreen from "../../components/FadeScreen";
import NeuCard from "../../components/NeuCard";
import BounceButton from "../../components/BounceButton";
import BackButton, { BACK_SIZE, BACK_TOP } from "../../components/BackButton";
import OfflineBanner from "../../components/OfflineBanner";
import SendIcon from "../../components/icons/SendIcon";
import ProgramRow, { CycleStrip, RowActions } from "../../components/trainer/ProgramRow";
import ReviewStatusPill, { REVIEW_STAGE_LABEL } from "../../components/trainer/ReviewStatusPill";
import SendForReviewSheet from "../../components/trainer/SendForReviewSheet";
import { ACCT, APP_DARK, APP_LIGHT, AWAITING_ORANGE, FontFamily } from "../../constants/theme";
import { darkGlow, pill, pillGlow, PILL_H_SM } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { EMPTY_GYM_HUB, fetchGymHub, peekGymHub, saveGymHub, type GymHubData } from "../../utils/trainerHub";
import { removeSentProgram, type SentProgram } from "../../utils/trainerStore";
import { firstName, reviewStage, sentForReviewList } from "../../utils/trainerLists";
import { askRemoveReturned } from "../../utils/reviewRemoval";
import { alertMessage } from "../../utils/errors";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function SentForReviewScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";

  const [hub, setHub] = useState<GymHubData | null>(() => peekGymHub(owner));
  const loaded = hub !== null;
  const { pt, trainers = [], sent, dismissedKeys, groups } = hub ?? EMPTY_GYM_HUB;
  const dismissed = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);

  useEffect(() => {
    if (hub) saveGymHub(owner, hub);
  }, [hub, owner]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void fetchGymHub(owner).then(next => { if (!cancelled) setHub(next); });
    return () => { cancelled = true; };
  }, [owner]));

  // Pull down for what the server says now: a review your trainer has just
  // sent back. Its own read (`fresh`), never a shared one.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setHub(await fetchGymHub(owner, { fresh: true }));
    setRefreshing(false);
  }, [owner]);

  const list = useMemo(() => sentForReviewList(sent, dismissed), [sent, dismissed]);

  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** The line under a request: who has it and since when, or when I took the
   *  changes. A group's name is looked up live, so a rename carries. */
  const metaOf = useCallback((s: SentProgram) => {
    const stage = reviewStage(s);
    if (stage === "accepted") return `Changes added ${fmtAgo(s.appliedAtISO ?? s.returnedAtISO ?? s.sentAtISO)}`;
    const group = s.groupId ? groups.find(g => g.group.id === s.groupId)?.group.name ?? "a group" : undefined;
    const to = !s.groupId && s.recipientId ? trainers.find(tr => tr.id === s.recipientId)?.name : undefined;
    if (stage === "removed") {
      const when = fmtAgo(s.removedUnreviewedAtISO ?? s.sentAtISO);
      if (group) return `Removed from ${group} without a review · ${when}`;
      return to ? `${firstName(to)} removed it without reviewing · ${when}` : `Removed without a review · ${when}`;
    }
    const when = fmtAgo(s.sentAtISO);
    if (group) return `Sent to ${group} ${when}`;
    return to ? `Sent to ${firstName(to)} ${when}` : `Sent ${when}`;
  }, [groups, trainers]);

  // Worded to match the button that opens it ("Remove"), and saying plainly
  // that your own copy is safe, since that's the worry a red button raises.
  // One not reviewed is already off the trainer's list: this clears it here.
  const handleUnsend = useCallback((entry: SentProgram) => {
    Alert.alert(
      "Remove Program",
      reviewStage(entry) === "removed"
        ? `Remove "${entry.programName}" from this list? Your own copy stays in your programs.`
        : `Remove "${entry.programName}" from your trainer? They won't see it any more. Your own copy stays in your programs.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeSentProgram(entry.id);
            } catch (e) {
              // It used to leave the list whatever happened, while the trainer
              // still had it.
              Alert.alert("Couldn't remove it", alertMessage(e, "Check your connection and try again."));
              return;
            }
            setHub(h => h && { ...h, sent: h.sent.filter(s => s.id !== entry.id) });
          },
        },
      ],
    );
  }, []);

  const handleRemoveAccepted = useCallback((entry: SentProgram) => {
    askRemoveReturned(entry, key => {
      setHub(h => h && (h.dismissedKeys.includes(key) ? h : { ...h, dismissedKeys: [...h.dismissedKeys, key] }));
    });
  }, []);

  const [sendOpen, setSendOpen] = useState(false);
  const onSent = useCallback((next: SentProgram[]) => setHub(h => h && { ...h, sent: next }), []);

  const nothingYet = loaded && list.length === 0;

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.5)", "transparent"]}
            locations={[0, 0.6, 0.85, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <BackButton />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + 40, barsReach) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ACCT}
            colors={[ACCT]}
            progressViewOffset={insets.top}
          />
        }
      >
        <View style={styles.header}>
          <View style={{ width: 44 }} />
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>Sent for Review</Text>
          <View style={{ width: 44 }} />
        </View>

        <OfflineBanner />

        {/* Only with someone to send to: with no trainer the Trainer tab's own
            card has the one green action, Connect a Trainer. */}
        {pt ? (
          <BounceButton
            onPress={() => setSendOpen(true)}
            needsConnection
            accessibilityLabel={`Send a program to ${pt.name} for review`}
          >
            <View style={[styles.sendBtn, { backgroundColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
              <SendIcon size={18} color="#fff" />
              <Text style={styles.sendText}>Send a Program for Review</Text>
            </View>
          </BounceButton>
        ) : null}

        {list.length > 0 ? (
          <NeuCard dark={isDark} radius={16} style={{ marginTop: 24 }}>
            {list.map((s, i) => {
              const stage = reviewStage(s);
              const accepted = stage === "accepted";
              return (
                <ProgramRow
                  key={s.id}
                  first={i === 0}
                  open={openRows.has(s.id)}
                  onToggle={() => toggleRow(s.id)}
                  accessibilityLabel={`${s.programName}, ${REVIEW_STAGE_LABEL[stage].toLowerCase()}, ${metaOf(s)}`}
                  title={s.programName}
                  meta={metaOf(s)}
                  trailing={<ReviewStatusPill review={s} />}
                >
                  <CycleStrip cycle={s.programSnapshot?.cyclePattern ?? []} />
                  {/* Once the changes are in, View is your own program, the one
                      you train from; before, what you sent. */}
                  <RowActions
                    label="View"
                    onOpen={() => router.navigate(
                      accepted
                        ? { pathname: "/programs", params: { focus: s.programId } }
                        : { pathname: "/program-view", params: { sentId: s.id } },
                    )}
                    onRemove={() => (accepted ? handleRemoveAccepted(s) : handleUnsend(s))}
                    accessibilityLabel={accepted ? `Open ${s.programName} in your programs` : `View ${s.programName}`}
                    removeLabel={accepted || stage === "removed" ? `Remove ${s.programName} from this list` : `Take ${s.programName} back from your trainer`}
                    removeNeedsConnection={!accepted}
                  />
                </ProgramRow>
              );
            })}
          </NeuCard>
        ) : null}

        {nothingYet ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 24 }}>
            <View style={styles.emptyInner}>
              {/* The Sent for Review tile's orange, so the page is the tile's. */}
              <View style={[styles.emptyIcon, { backgroundColor: `${AWAITING_ORANGE}29` }]}>
                <SendIcon size={24} color={AWAITING_ORANGE} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Nothing sent yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                {pt
                  ? `Send ${firstName(pt.name)} one of your programs and they can review it and send it back with changes.`
                  : "Connect with a trainer to send them your programs to review."}
              </Text>
            </View>
          </NeuCard>
        ) : null}
      </ScrollView>

      <SendForReviewSheet
        visible={sendOpen}
        trainer={pt}
        onClose={() => setSendOpen(false)}
        onSent={onSent}
      />
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  header: { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 18 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center", flex: 1 },
  sendBtn: { ...pill(PILL_H_SM), gap: 10, ...pillGlow(ACCT, 0.4) },
  sendText: { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  emptyInner: { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
});
