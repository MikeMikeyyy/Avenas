// app/trainer/received.tsx
//
// A gym user's Programs page, opened from the Programs tile on their Trainer
// tab (components/trainer/MyPTHome.tsx; user decisions, 2026-10-21, the Trainer
// Page canvas, "Tap From Jordan"): what their trainers have handed them. TO
// ACCEPT holds their own programs sent back with changes, then programs sent to
// them, each with the green Accept; ADDED holds the programs they've taken.
// Each row says who it's from. It was "From Jordan" at first, page and tile,
// which didn't say it was programs (user feedback, 2026-10-21).
//
// Each row opens in place, as on the trainer's Programs page
// (components/trainer/ProgramRow.tsx): its cycle, what the trainer wrote, and
// View (See Changes for a review) with Remove. Remove only takes it off this
// list, on this phone: an accepted program stays in My Programs, and the
// trainer's view doesn't change.
//
// It reads and saves the same page copy as the Trainer tab (utils/trainerHub.ts),
// so it opens at once on what the tab last saw.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import NotebookIcon from "../../components/icons/NotebookIcon";
import ProgramRow, { CycleStrip, RowActions, rowButtonStyles } from "../../components/trainer/ProgramRow";
import { ACCT, APP_DARK, APP_LIGHT, FontFamily, compareBlue } from "../../constants/theme";
import { pillGlow } from "../../constants/buttons";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { scheduleCloudPush } from "../../lib/syncManager";
import { EMPTY_GYM_HUB, fetchGymHub, peekGymHub, saveGymHub, type GymHubData } from "../../utils/trainerHub";
import {
  acceptSharedProgramBatch,
  applyReturnedProgram,
  batchKeyOf,
  dismissKeyOf,
  dismissSharedBatch,
  ShareUnavailableError,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { firstName, fromTrainerLists, type FromTrainerItem } from "../../utils/trainerLists";
import { askRemoveReturned } from "../../utils/reviewRemoval";
import { alertMessage } from "../../utils/errors";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** The green Accept on a row that's waiting on me: white words, as the app's
 *  other green buttons (user decision, 2026-10-21). */
function AcceptButton({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  const { isDark } = useTheme();
  return (
    <BounceButton onPress={onPress} needsConnection accessibilityLabel={accessibilityLabel}>
      <View style={[rowButtonStyles.pill, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
        <Text style={rowButtonStyles.text}>Accept</Text>
      </View>
    </BounceButton>
  );
}

export default function ReceivedProgramsScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";

  // The Trainer tab's page copy (utils/trainerHub.ts): this page opens on it,
  // refreshes it, and saves what changes here (an accepted program, a removed
  // one) so the tab's tiles count it too.
  const [hub, setHub] = useState<GymHubData | null>(() => peekGymHub(owner));
  const loaded = hub !== null;
  const { pt, trainers = [], received, sent, dismissedKeys, groups } = hub ?? EMPTY_GYM_HUB;
  const dismissed = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);

  useEffect(() => {
    if (hub) saveGymHub(owner, hub);
  }, [hub, owner]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void fetchGymHub(owner).then(next => { if (!cancelled) setHub(next); });
    return () => { cancelled = true; };
  }, [owner]));

  // Pull down for what the server says now: a program your trainer has just
  // sent, or sent back. Its own read (`fresh`), never a shared one.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setHub(await fetchGymHub(owner, { fresh: true }));
    setRefreshing(false);
  }, [owner]);

  const { waiting, added } = useMemo(() => fromTrainerLists(received, sent, dismissed), [received, sent, dismissed]);

  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const groupName = useCallback(
    (id: string) => groups.find(g => g.group.id === id)?.group.name ?? "A group",
    [groups],
  );
  const trainerName = useCallback(
    (id?: string) => (id ? trainers.find(tr => tr.id === id)?.name : undefined),
    [trainers],
  );

  /** The line under a program sent to me: who it's from (or the group it came
   *  through), and when. A group's name is looked up live, so a renamed group
   *  reads correctly on old sends. */
  const programMeta = useCallback((s: SharedProgram) => {
    // Accepted once, then deleted from My Programs: Accept adds it back.
    if (!s.acceptedAtISO && s.deletedByRecipientAtISO) return "Removed from your programs";
    const when = fmtAgo(s.sentAtISO);
    if (s.groupId) return `${groupName(s.groupId)} · ${when}`;
    // A local entry carries no sender: it came from the trainer on the tab.
    const from = s.senderId ? trainerName(s.senderId) : pt?.name;
    return from ? `From ${firstName(from)} · ${when}` : `Sent ${when}`;
  }, [groupName, trainerName, pt]);

  /** The line under my own program, back reviewed: it's mine, back with their
   *  changes, so it can't be mistaken for a new program they wrote. */
  const reviewMeta = useCallback((r: SentProgram) => {
    const when = fmtAgo(r.returnedAtISO ?? r.sentAtISO);
    if (r.groupId) return `Back from ${groupName(r.groupId)} · ${when}`;
    // Whoever it went to; a local entry from before that was recorded went to
    // the trainer on the tab. One since disconnected goes unnamed.
    const by = r.recipientId ? trainerName(r.recipientId) : pt?.name;
    return `Back with ${by ? `${firstName(by)}'s` : "your trainer's"} changes · ${when}`;
  }, [groupName, trainerName, pt]);

  // Accepts in flight, by row: a second tap while the first is still on its
  // way would otherwise say "added" twice (the store adds it once either way).
  const accepting = useRef(new Set<string>());

  const handleAccept = useCallback(async (share: SharedProgram) => {
    const key = batchKeyOf(share);
    if (share.acceptedAtISO || accepting.current.has(key)) return;
    accepting.current.add(key);
    let importedId: string | null;
    try {
      importedId = await acceptSharedProgramBatch(key);
    } catch (e) {
      Alert.alert("Couldn't add program", alertMessage(e, "Check your connection and try again."));
      // Deleted or archived since this row was drawn: it's gone, so is its row.
      if (e instanceof ShareUnavailableError) {
        setHub(h => h && {
          ...h,
          received: h.received.filter(r => batchKeyOf(r) !== key),
          shares: h.shares.filter(r => batchKeyOf(r) !== key),
        });
      }
      return;
    } finally {
      accepting.current.delete(key);
    }
    scheduleCloudPush(); // the accept materialised/updated @avenas/programs (a synced key)
    const acceptedAt = new Date().toISOString();
    setHub(h => h && {
      ...h,
      received: h.received.map(r => batchKeyOf(r) === key
        ? { ...r, acceptedAtISO: acceptedAt, acceptedProgramId: importedId ?? undefined, deletedByRecipientAtISO: undefined }
        : r),
    });
    Alert.alert("Program Added", `"${share.programName}" was added to your programs.`);
  }, []);

  const handleApplyReturned = useCallback(async (entry: SentProgram) => {
    if (entry.appliedAtISO || accepting.current.has(entry.id)) return;
    accepting.current.add(entry.id);
    try {
      await applyReturnedProgram(entry.id);
    } catch (e) {
      Alert.alert("Couldn't update your program", alertMessage(e, "Check your connection and try again."));
      return;
    } finally {
      accepting.current.delete(entry.id);
    }
    scheduleCloudPush(); // applyReturnedProgram wrote @avenas/programs (a synced key)
    const appliedAt = new Date().toISOString();
    setHub(h => h && { ...h, sent: h.sent.map(s => s.id === entry.id ? { ...s, appliedAtISO: appliedAt } : s) });
    Alert.alert("Program Updated", `"${entry.programName}" in your programs was updated with your trainer's edits.`);
  }, []);

  /**
   * Take a program someone sent me off this list.
   *
   * It's a hide on my side only (see DISMISSED_SHARES_KEY): an accepted copy
   * stays in My Programs, and the trainer still sees it as sent. The prompt
   * says which of those applies, because the two cases lose different things:
   * nothing at all once it's accepted, the chance to accept it if it isn't.
   */
  const handleRemoveProgram = useCallback((entry: SharedProgram) => {
    const accepted = !!entry.acceptedAtISO;
    Alert.alert(
      "Remove Program",
      accepted
        ? `Remove "${entry.programName}" from this list? It stays in your programs.`
        : `Remove "${entry.programName}" without accepting it? It comes back if your trainer sends it again or updates it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const key = batchKeyOf(entry);
            // Hides this version: a Send Update brings it back (dismissKeyOf).
            await dismissSharedBatch(dismissKeyOf(entry));
            // The group badges count from `shares` too, so a removed program
            // stops counting as waiting on me straight away.
            setHub(h => h && {
              ...h,
              received: h.received.filter(r => batchKeyOf(r) !== key),
              shares: h.shares.filter(r => batchKeyOf(r) !== key),
            });
          },
        },
      ],
    );
  }, []);

  const handleRemoveReview = useCallback((entry: SentProgram) => {
    askRemoveReturned(entry, key => {
      setHub(h => h && (h.dismissedKeys.includes(key) ? h : { ...h, dismissedKeys: [...h.dismissedKeys, key] }));
    });
  }, []);

  /** View opens the program itself, or once it's accepted your copy in My
   *  Programs, since that's the one you'll be training from. */
  const viewProgram = useCallback((s: SharedProgram) => {
    router.navigate(
      s.acceptedAtISO
        ? (s.acceptedProgramId ? { pathname: "/programs", params: { focus: s.acceptedProgramId } } : "/programs")
        : { pathname: "/program-view", params: { sharedId: s.id } },
    );
  }, [router]);

  const renderWaiting = (item: FromTrainerItem, i: number) => {
    if (item.kind === "review") {
      const r = item.review;
      const key = `r:${r.id}`;
      return (
        <ProgramRow
          key={key}
          first={i === 0}
          open={openRows.has(key)}
          onToggle={() => toggleRow(key)}
          accessibilityLabel={`${r.programName}, your program back reviewed`}
          title={r.programName}
          meta={reviewMeta(r)}
          trailing={<AcceptButton onPress={() => handleApplyReturned(r)} accessibilityLabel={`Accept the changes to ${r.programName}`} />}
        >
          {r.trainerComments ? (
            <View style={[styles.commentBox, { borderColor: t.div }]}>
              <Text style={[styles.commentLabel, { color: t.ts }]}>TRAINER COMMENTS</Text>
              <Text style={[styles.commentBody, { color: t.tp }]}>{r.trainerComments}</Text>
            </View>
          ) : null}
          <CycleStrip cycle={r.programSnapshot?.cyclePattern ?? []} />
          <RowActions
            label="See Changes"
            onOpen={() => router.navigate({ pathname: "/program-view", params: { sentId: r.id } })}
            onRemove={() => handleRemoveReview(r)}
            accessibilityLabel={`See the changes to ${r.programName}`}
            removeLabel={`Remove ${r.programName} from this list`}
            removeNeedsConnection={false}
          />
        </ProgramRow>
      );
    }
    const s = item.share;
    const key = `p:${s.id}`;
    return (
      <ProgramRow
        key={key}
        first={i === 0}
        open={openRows.has(key)}
        onToggle={() => toggleRow(key)}
        accessibilityLabel={`${s.programName}, ${programMeta(s)}`}
        title={s.programName}
        meta={programMeta(s)}
        trailing={<AcceptButton onPress={() => handleAccept(s)} accessibilityLabel={`Accept ${s.programName}`} />}
      >
        <CycleStrip cycle={s.programSnapshot?.cyclePattern ?? []} />
        <RowActions
          label="View"
          onOpen={() => viewProgram(s)}
          onRemove={() => handleRemoveProgram(s)}
          accessibilityLabel={`View ${s.programName}`}
          removeLabel={`Remove ${s.programName} from this list`}
          removeNeedsConnection={false}
        />
      </ProgramRow>
    );
  };

  const nothingYet = loaded && waiting.length === 0 && added.length === 0;

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
          <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>Programs</Text>
          <View style={{ width: 44 }} />
        </View>

        <OfflineBanner />

        {waiting.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>TO ACCEPT</Text>
            <NeuCard dark={isDark} radius={16}>
              {waiting.map(renderWaiting)}
            </NeuCard>
          </>
        ) : null}

        {added.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: t.ts }]}>ADDED</Text>
            <NeuCard dark={isDark} radius={16}>
              {added.map((s, i) => {
                const key = `p:${s.id}`;
                return (
                  <ProgramRow
                    key={key}
                    first={i === 0}
                    open={openRows.has(key)}
                    onToggle={() => toggleRow(key)}
                    accessibilityLabel={`${s.programName}, added to your programs`}
                    title={s.programName}
                    meta={programMeta(s)}
                  >
                    <CycleStrip cycle={s.programSnapshot?.cyclePattern ?? []} />
                    <RowActions
                      label="View"
                      onOpen={() => viewProgram(s)}
                      onRemove={() => handleRemoveProgram(s)}
                      accessibilityLabel={`Open ${s.programName} in your programs`}
                      removeLabel={`Remove ${s.programName} from this list`}
                      removeNeedsConnection={false}
                    />
                  </ProgramRow>
                );
              })}
            </NeuCard>
          </>
        ) : null}

        {/* Only once we've looked: before that, "none" would be a lie. */}
        {nothingYet ? (
          <NeuCard dark={isDark} radius={20} style={{ marginTop: 24 }}>
            <View style={styles.emptyInner}>
              {/* The Programs tile's periwinkle, so the page is the tile's. */}
              <View style={[styles.emptyIcon, { backgroundColor: `${compareBlue(isDark)}29` }]}>
                <NotebookIcon size={26} color={compareBlue(isDark)} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>No programs yet</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                Programs your trainer sends you show here, and so do your own when they come back reviewed.
              </Text>
            </View>
          </NeuCard>
        ) : null}
      </ScrollView>
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient: { position: "absolute", left: 0, right: 0, zIndex: 5 },
  header: { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 18 },
  screenTitle: { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center", flex: 1 },
  sectionLabel: { fontFamily: FontFamily.semibold, fontSize: 12, letterSpacing: 0.6, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  commentBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, gap: 6 },
  commentLabel: { fontFamily: FontFamily.semibold, fontSize: 10, letterSpacing: 0.8 },
  commentBody: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19 },
  emptyInner: { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody: { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
});
