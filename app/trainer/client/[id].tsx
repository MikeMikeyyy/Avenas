// PT-side detail screen for a single client.
// Tabs: Progress | Journal | Programs. Chat is a stub.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, Text, TouchableOpacity, View, ScrollView } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolate, Extrapolation, type SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import NeuCard from "../../../components/NeuCard";
import BounceButton from "../../../components/BounceButton";
import ProgressView from "../../../components/progress/ProgressView";
import ClientJournalView from "../../../components/journal/ClientJournalView";
import ProgramPickerSheet from "../../../components/trainer/ProgramPickerSheet";
import SimpleSheet from "../../../components/trainer/SimpleSheet";
import FavouriteStar, { useFavouriteGold } from "../../../components/FavouriteStar";
import { loadFavouriteMemberIds, toggleFavouriteMember } from "../../../utils/groupStore";
import ReportReasonSheet from "../../../components/trainer/ReportReasonSheet";
import ChatIcon from "../../../components/icons/ChatIcon";
import SendIcon from "../../../components/icons/SendIcon";
import TrashIcon from "../../../components/TrashIcon";
import SheetPill from "../../../components/SheetPill";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, DANGER_BRIGHT } from "../../../constants/theme";
import { PILL_RADIUS } from "../../../constants/buttons";
import { useTheme } from "../../../contexts/ThemeContext";
import { useAccountType } from "../../../contexts/AccountTypeContext";
import { UnitLens, useUnit } from "../../../contexts/UnitContext";
import { unitLabel, unitOf } from "../../../utils/units";
import type { ReportReason } from "../../../constants/chat";
import {
  appendSharedPrograms,
  batchKeyOf,
  loadClientData,
  loadClients,
  loadSharedPrograms,
  makeInitials,
  removeSharedProgram,
  type Client,
  type ClientData,
  type SharedProgram,
} from "../../../utils/trainerStore";
import { getMyConnections } from "../../../lib/connections";
import Avatar from "../../../components/Avatar";
import UnreadBadge from "../../../components/UnreadBadge";
import { loadThread, loadReads, countUnreadInThread } from "../../../utils/chatStore";
import { loadHiddenMessageIds, blockContact, unaddContact, reportUser } from "../../../utils/moderation";
import { getJSON } from "../../../utils/storage";
import { removeShareConfirm } from "../../../utils/removeShare";
import { PROGRAMS_KEY, type SavedProgram } from "../../../constants/programs";
import { alertMessage } from "../../../utils/errors";
import BackButton, { BACK_TOP, BACK_LEFT } from "../../../components/BackButton";

type Tab = "progress" | "journal" | "programs";

// Hairline separator between adjacent tabs, matching the iOS-style dividers on
// the Progress chart toggles. `gap` is the boundary between tab gap and gap+1;
// it fades out as the green pill (pillX in px) slides onto either side.
function TabDivider({ gap, pillX, segW, color }: {
  gap: number; pillX: SharedValue<number>; segW: number; color: string;
}) {
  const style = useAnimatedStyle(
    () => ({
      opacity: interpolate(
        pillX.value,
        [(gap - 0.15) * segW, gap * segW, (gap + 1) * segW, (gap + 1.15) * segW],
        [1, 0, 0, 1],
        Extrapolation.CLAMP,
      ),
      transform: [{ translateX: (gap + 1) * segW }],
    }),
    [gap, segW],
  );
  return (
    <Reanimated.View pointerEvents="none" style={[styles.tabDividerBox, style]}>
      <View style={[styles.tabDivider, { backgroundColor: color }]} />
    </Reanimated.View>
  );
}

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/**
 * How long ago the client's phone last backed up, which is how current
 * everything on this page is. Their app backs up after every change and
 * whenever it leaves the foreground, so a long gap means they haven't opened
 * it, or it can't reach the server.
 */
function fmtSynced(iso: string): string | null {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "Synced yesterday" : `Synced ${days}d ago`;
}

export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const { accountType, loaded: accountLoaded } = useAccountType();
  const { isKg: ownIsKg } = useUnit();

  const [client, setClient] = useState<Client | null>(null);
  const [data, setData] = useState<ClientData>({ workoutHistory: [], programs: [], journal: [] });
  const [unreadFromClient, setUnreadFromClient] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("progress");
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [shared, setShared] = useState<SharedProgram[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [tabsWidth, setTabsWidth] = useState(0);
  // Client options sheet (Report / Block / Remove — Apple Guideline 1.2, same
  // menu the chat screen offers) + the report-reason picker it can open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  /** Starred, from the account-wide favourites list this shares with a group's
   *  roster — star someone here and they're pinned in both. */
  const [isFavourite, setIsFavourite] = useState(false);
  // The gold the star is drawn in, for the label beside it.
  const favouriteGold = useFavouriteGold();

  const TABS: readonly Tab[] = useMemo(() => ["progress", "journal", "programs"] as const, []);
  const tabIndex = TABS.indexOf(tab);
  const pillX = useSharedValue(0);

  useEffect(() => {
    if (tabsWidth === 0) return;
    const segment = tabsWidth / TABS.length;
    pillX.value = withSpring(tabIndex * segment, { damping: 22, stiffness: 220, mass: 0.7 });
  }, [tabIndex, tabsWidth, TABS.length, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  const selectTab = useCallback((next: Tab) => {
    if (next === tab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(next);
  }, [tab]);

  /**
   * The whole page in one pass, on arrival and on pull-down. The caller owns
   * the cancel flag, as on the group page: a focus load stops writing state
   * once you've navigated away, while a pull runs to completion.
   */
  const loadAll = useCallback(async (isCancelled: () => boolean) => {
    const [list, d, progs, sharedAll, thread, reads, hidden, favs] = await Promise.all([
      loadClients(),
      id ? loadClientData(id) : Promise.resolve({ workoutHistory: [], programs: [], journal: [] } as ClientData),
      getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
      loadSharedPrograms(),
      id ? loadThread(id) : Promise.resolve([]),
      loadReads(),
      loadHiddenMessageIds(),
      loadFavouriteMemberIds(),
    ]);
    if (!isCancelled() && id) setIsFavourite(favs.has(id));
    let found: Client | null = list.find(c => c.id === id) ?? null;
    if (!found && id) {
      // Real connected account (not in the local roster) — build a lightweight
      // client from the connection's safe profile (real name + photo). Their
      // training came from their own cloud backup above (loadClientData).
      try {
        const conns = await getMyConnections();
        const conn = conns.find(c => c.status === "accepted" && c.otherId === id);
        if (conn) {
          found = {
            id: conn.otherId,
            name: conn.name || "Client",
            initials: makeInitials(conn.name || "Client"),
            photoUri: conn.photoUri,
            isTrainer: conn.accountType === "pt",
            lastActiveISO: conn.lastActiveAt,
          };
        }
      } catch { /* leave as not-found */ }
    }
    if (isCancelled()) return;
    setClient(found);
    setData(d);
    setMyPrograms(Array.isArray(progs) ? progs : []);
    setShared(sharedAll);
    // Unread count from this person for the chat button badge. Re-runs on
    // focus, so opening the chat (which marks the thread read) clears it.
    setUnreadFromClient(id ? countUnreadInThread(thread.filter(m => !hidden.has(m.id)), reads[id]) : 0);
    setLoaded(true);
  }, [id]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void loadAll(() => cancelled);
    return () => { cancelled = true; };
  }, [loadAll]));

  // Pull down to re-read their training (a session they just finished) and
  // everything else on the page. Every tab's scroller carries it, so it works
  // wherever you are.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll(() => false);
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);
  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCT} colors={[ACCT]} />
  );

  // Their programs, the running one first. Every backup rewrites all of a
  // client's programs in one statement, so the order they arrive in means
  // nothing.
  const clientPrograms = useMemo(
    () => [...data.programs].sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1)),
    [data.programs],
  );

  const sharedForClient = useMemo(
    // Hide entries the client has deleted from their library — the gym user can
    // still re-accept them from their My Trainer page, but they shouldn't clutter
    // the trainer's per-client view. Also exclude programs a coach sent ME: when
    // that coach is a connected trainer (and thus in the roster) their incoming
    // share would otherwise look like one I sent them.
    () => shared.filter(s => (s.clientId === id || s.clientId === "all") && !s.deletedByRecipientAtISO && !s.receivedFromCoachId),
    [shared, id],
  );

  const handleUnshare = useCallback((entry: SharedProgram) => {
    const prompt = removeShareConfirm({
      programName: entry.programName,
      recipients: client?.name ?? "this client",
      total: 1,
      accepted: entry.acceptedAtISO ? 1 : 0,
    });
    Alert.alert(
      prompt.title,
      prompt.body,
      [
        { text: prompt.cancel, style: "cancel" },
        {
          text: prompt.confirm,
          style: "destructive",
          onPress: async () => {
            await removeSharedProgram(entry.id);
            setShared(prev => prev.filter(s => s.id !== entry.id));
          },
        },
      ]
    );
  }, [client]);

  const handleShare = useCallback(async (program: SavedProgram) => {
    if (!id) return;
    const entry: SharedProgram = {
      id: `share_${Date.now()}`,
      clientId: id,
      programId: program.id,
      programName: program.name,
      sentAtISO: new Date().toISOString(),
      programSnapshot: program,
    };
    try {
      await appendSharedPrograms([entry]);
    } catch (e) {
      Alert.alert("Couldn't send program", alertMessage(e, "Check your connection and try again."));
      return;
    }
    // Re-read rather than prepend `entry`: its `share_…` id is a local
    // placeholder, and the cloud row has a uuid. A card holding the placeholder
    // couldn't be removed — removeSharedProgram took it for a local entry and
    // left the real program in the cloud, where it reappeared on the next load.
    // The prepend survives only as a fallback if the reload fails.
    const fresh = await loadSharedPrograms();
    const landed = fresh.some(s => batchKeyOf(s) === batchKeyOf(entry));
    setShared(landed ? fresh : [entry, ...fresh]);
    Alert.alert("Program Sent", `"${program.name}" was sent to ${client?.name ?? "this client"}.`);
  }, [id, client]);

  const openChat = () => {
    if (!client) return;
    router.navigate({ pathname: "/trainer/chat/[id]", params: { id: client.id, name: client.name, initials: client.initials, photo: client.photoUri ?? "" } });
  };

  // Report / Block / Remove — mirrors the chat screen's conversation-options
  // menu so moderation is reachable from the client page too.
  /** Star or unstar this person. Closes the sheet, because the answer is the
   *  list you came from re-ordering itself behind it. */
  const onToggleFavourite = async () => {
    if (!id) return;
    setMenuOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await toggleFavouriteMember(id);
    setIsFavourite(next.has(id));
  };

  const onReportUser = () => { setMenuOpen(false); setReportOpen(true); };

  const onBlock = () => {
    if (!client) return;
    setMenuOpen(false);
    Alert.alert(
      `Block ${client.name}?`,
      "They'll be removed from your connections and can no longer message you. You can unblock them later in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: async () => {
          const { severed } = await blockContact(client, accountType);
          router.back();
          if (!severed) Alert.alert(`${client.name} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
        } },
      ],
    );
  };

  const onUnadd = () => {
    if (!client) return;
    setMenuOpen(false);
    Alert.alert(
      `Remove ${client.name}?`,
      "This removes your connection. Any programs already shared stay in their library.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => {
          const { severed } = await unaddContact(client.id, accountType);
          if (severed) {
            router.back();
          } else {
            // Unlike block, nothing filters an un-added person out while
            // offline — the connection is genuinely still up, so say so.
            Alert.alert("Couldn't remove connection", "We couldn't reach the server, so the connection wasn't removed. Check your internet and try again.");
          }
        } },
      ],
    );
  };

  const submitReport = async (reason: ReportReason) => {
    setReportOpen(false);
    if (!client) return;
    await reportUser(client, reason);
    Alert.alert(
      "Report received",
      `Thanks. We review reports within 24 hours. Would you also like to block ${client.name}?`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Block", style: "destructive", onPress: async () => {
          const { severed } = await blockContact(client, accountType);
          router.back();
          if (!severed) Alert.alert(`${client.name} is blocked`, "We couldn't reach the server to sever the connection. It will finish when you're back online.");
        } },
      ],
    );
  };

  if (!loaded || !accountLoaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  // A client page is a trainer's. The only ways here (the hub's client list and
  // a group's "Open client page") are trainer-only already, and the server
  // refuses a gym user's read of anyone's training whatever this screen does.
  // This covers being opened any other way, such as by a link.
  if (accountType !== "pt") {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Text style={{ fontFamily: FontFamily.semibold, fontSize: 16, color: t.tp, textAlign: "center" }}>Only trainers can view client pages</Text>
        <BounceButton style={{ marginTop: 16 }} onPress={() => router.back()}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCT }}>
            <Text style={{ color: "#fff", fontFamily: FontFamily.bold }}>Back</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  const synced = data.backedUpAt ? fmtSynced(data.backedUpAt) : null;
  // Their numbers are shown in the unit THEY log in, so the page reads the way
  // it does on their phone. Said under their name so a kg trainer knows the
  // numbers below are lbs.
  const clientIsKg = data.unit ? data.unit === "kg" : undefined;
  const headerMeta = [synced, data.unit ? `Logs in ${unitLabel(data.unit)}` : null].filter(Boolean).join(" · ");
  const unitsDiffer = !!data.unit && data.unit !== unitOf(ownIsKg);

  if (!client) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Text style={{ fontFamily: FontFamily.semibold, fontSize: 16, color: t.tp }}>Client not found</Text>
        <BounceButton style={{ marginTop: 16 }} onPress={() => router.back()}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCT }}>
            <Text style={{ color: "#fff", fontFamily: FontFamily.bold }}>Back</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + BACK_TOP }]}>
        <BackButton inline />

        <View style={styles.headerCenter}>
          <Avatar
            uri={client.photoUri}
            initials={client.initials}
            size={36}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textColor={ACCT}
            textStyle={[styles.avatarText, { color: ACCT }]}
          />
          <View style={styles.nameCol}>
            {/* Photo, star, name: the group page header's order. The star
                shares the NAME's row, so it sits level with the name rather
                than centred between it and the Synced line. */}
            <View style={styles.nameRow}>
              {isFavourite && <FavouriteStar size={16} />}
              <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{client.name}</Text>
            </View>
            {!!headerMeta && (
              <Text style={[styles.synced, { color: t.ts }]} numberOfLines={1}>{headerMeta}</Text>
            )}
          </View>
        </View>

        <TouchableOpacity onPress={() => setMenuOpen(true)} activeOpacity={0.8} accessibilityLabel="Client options" accessibilityRole="button">
          <View style={[styles.iconBtn, { backgroundColor: t.ctrl }]}>
            <Ionicons name="ellipsis-horizontal" size={20} color={t.tp} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={openChat} activeOpacity={0.8} accessibilityLabel="Chat with client" accessibilityRole="button">
          <View>
            <View style={[styles.chatBtn, { backgroundColor: t.ctrl, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
              <ChatIcon size={18} color={t.tp} />
            </View>
            <UnreadBadge count={unreadFromClient} style={styles.msgBadge} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Tab segmented control — animated sliding pill */}
      <View style={styles.tabsWrap}>
        <View
          style={[styles.tabs, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}
          onLayout={e => setTabsWidth(e.nativeEvent.layout.width - styles.tabs.padding * 2)}
        >
          {tabsWidth > 0 && TABS.slice(1).map((_, g) => (
            <TabDivider
              key={g}
              gap={g}
              pillX={pillX}
              segW={tabsWidth / TABS.length}
              color={isDark ? "rgba(255,255,255,0.22)" : "rgba(60,60,67,0.29)"}
            />
          ))}
          {tabsWidth > 0 && (
            <Reanimated.View
              pointerEvents="none"
              style={[
                styles.tabPill,
                { width: tabsWidth / TABS.length, backgroundColor: ACCT, shadowColor: ACCT },
                pillStyle,
              ]}
            />
          )}
          {TABS.map(k => {
            const active = tab === k;
            return (
              <TouchableOpacity
                key={k}
                style={styles.tab}
                onPress={() => selectTab(k)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, { color: active ? "#fff" : t.tp }]}>
                  {k === "progress" ? "Progress" : k === "journal" ? "Journal" : "Programs"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Tab content, in the client's unit */}
      <UnitLens isKg={clientIsKg}>
      <View style={{ flex: 1 }}>
        {tab === "progress" && (
          <ProgressView
            history={data.workoutHistory}
            programs={data.programs}
            customExercises={data.customExercises}
            loaded
            title=""
            asScreen={false}
            withTopInset={false}
            bottomPadding={insets.bottom + 140}
            refreshControl={refreshControl}
            clientId={client.id}
          />
        )}
        {tab === "journal" && (
          <ClientJournalView
            entries={data.journal}
            workoutHistory={data.workoutHistory}
            programs={data.programs}
            bottomPadding={insets.bottom + 140}
            // The user's own workout screen, read-only and reading this
            // client's copy (see workout-detail's `clientId`).
            onOpenWorkout={workoutId => router.navigate({ pathname: "/workout-detail", params: { id: workoutId, clientId: client.id } })}
            // setTab, not selectTab: the card already gave its own haptic.
            onOpenPrograms={() => setTab("programs")}
            refreshControl={refreshControl}
          />
        )}
        {tab === "programs" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 34, paddingBottom: insets.bottom + 140 }}
            refreshControl={refreshControl}
          >
            <BounceButton style={{ marginBottom: 16 }} onPress={() => setShareOpen(true)}>
              <View style={[styles.shareBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <SendIcon size={18} color="#fff" />
                <Text style={styles.shareBtnText}>Share a Program</Text>
              </View>
            </BounceButton>

            <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 4 }]}>{`${client.name.split(" ")[0]}'s Programs`}</Text>
            {clientPrograms.length === 0 ? (
              <NeuCard dark={isDark} radius={16}>
                <Text style={[styles.empty, { color: t.ts }]}>This client has no programs yet.</Text>
              </NeuCard>
            ) : (
              clientPrograms.map(p => {
                const isActive = p.status === "active";
                return (
                  // Opens the program in full, read-only: every day with its
                  // exercises, sets, rest and notes (app/program-view.tsx).
                  <BounceButton
                    key={p.id}
                    style={{ marginBottom: 10 }}
                    onPress={() => router.navigate({ pathname: "/program-view", params: { clientId: client.id, programId: p.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${p.name}`}
                  >
                  <NeuCard dark={isDark} radius={16}>
                    <View style={styles.programCardInner}>
                      <View style={styles.programTopRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{p.name}</Text>
                          <Text style={[styles.itemMeta, { color: t.ts }]}>{p.totalWeeks} weeks</Text>
                        </View>
                        {isActive && (
                          <View style={[styles.statusPill, { backgroundColor: `${ACCT}22` }]}>
                            <Text style={[styles.statusText, { color: ACCT }]}>Active</Text>
                          </View>
                        )}
                        <Ionicons name="chevron-forward" size={16} color={t.ts} />
                      </View>
                      <View style={styles.cycleGrid}>
                        {p.cyclePattern.map((day, i) => {
                          const isTraining = day !== "Rest" && day !== "";
                          return (
                            <View
                              key={i}
                              style={[
                                styles.cycleChip,
                                isTraining
                                  ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                                  : { backgroundColor: t.div },
                              ]}
                            >
                              <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                                {day || "Rest"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </NeuCard>
                  </BounceButton>
                );
              })
            )}

            <Text style={[styles.sectionHeading, { color: t.tp }]}>Shared with {client.name.split(" ")[0]}</Text>
            {sharedForClient.length === 0 ? (
              <NeuCard dark={isDark} radius={16}>
                <Text style={[styles.empty, { color: t.ts }]}>No programs shared yet.</Text>
              </NeuCard>
            ) : (
              sharedForClient.map(s => {
                const accepted = !!s.acceptedAtISO;
                return (
                  <NeuCard key={s.id} dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                    <View style={styles.itemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                        <Text style={[styles.itemMeta, { color: t.ts }]}>
                          {s.clientId === "all" ? "Broadcast" : "Direct"} · Sent {fmtAgo(s.sentAtISO)}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, accepted
                        ? { backgroundColor: `${ACCT}22` }
                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                      ]}>
                        <Text style={[styles.statusText, { color: accepted ? ACCT : t.ts }]}>
                          {accepted ? "Accepted" : "Pending"}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleUnshare(s)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                        accessibilityLabel="Remove program"
                        accessibilityRole="button"
                      >
                        <TrashIcon size={18} color={DANGER_BRIGHT} />
                      </TouchableOpacity>
                    </View>
                  </NeuCard>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
      </UnitLens>

      <ProgramPickerSheet
        visible={shareOpen}
        title={`Share with ${client.name}`}
        subtitle={unitsDiffer && data.unit
          ? `Pick one of your programs to send. ${client.name.split(" ")[0]} logs in ${unitLabel(data.unit)}, and will see your weights in the unit you entered them in (${unitLabel(unitOf(ownIsKg))}).`
          : "Pick one of your programs to send."}
        programs={myPrograms}
        onPick={handleShare}
        onClose={() => setShareOpen(false)}
      />

      {/* Client options — favourite first, then Report / Block / Remove (the
          same moderation trio as the chat screen). Starring is the everyday one
          and the only one that isn't destructive, so it leads. */}
      <SimpleSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.menuName, { color: t.tp }]} numberOfLines={1}>{client.name}</Text>
        <View style={styles.menu}>
          <SheetPill
            label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            tint={isFavourite ? favouriteGold : undefined}
            icon={() => <FavouriteStar size={20} filled={isFavourite} inactiveColor={t.tp} />}
            onPress={onToggleFavourite}
            accessibilityState={{ selected: isFavourite }}
          />
          <SheetPill label="Report" icon={c => <Ionicons name="flag-outline" size={18} color={c} />} onPress={onReportUser} />
          <SheetPill label="Block" variant="danger" icon={c => <Ionicons name="ban-outline" size={18} color={c} />} onPress={onBlock} />
          <SheetPill label="Remove connection" icon={c => <Ionicons name="person-remove-outline" size={18} color={c} />} onPress={onUnadd} />
        </View>
      </SimpleSheet>

      <ReportReasonSheet
        visible={reportOpen}
        title={`Report ${client.name}`}
        onSubmit={submitReport}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", paddingHorizontal: BACK_LEFT, paddingBottom: 10, gap: 12 },
  headerCenter:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn:       { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  chatBtn:       { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  msgBadge:      { position: "absolute", top: -5, right: -5 },
  avatar:        { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 13 },
  nameCol:       { flex: 1 },
  // 10 between star and name, the group header's spacing.
  nameRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  name:          { flexShrink: 1, fontFamily: FontFamily.bold, fontSize: 18 },
  synced:        { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 1 },
  tabsWrap:      { paddingHorizontal: 20, paddingBottom: 8 },
  tabs:          { flexDirection: "row", borderRadius: 999, padding: 4, position: "relative", overflow: "hidden" },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center", justifyContent: "center", zIndex: 1 },
  tabText:       { fontFamily: FontFamily.semibold, fontSize: 13 },
  tabPill:       { position: "absolute", top: 4, bottom: 4, left: 4, borderRadius: 999, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
  // Hairline tab separator, positioned on a boundary via translateX and
  // rendered under the green pill so it covers any it slides over. Its box has
  // the pill's own insets (top/bottom 4) and centres the line in them, so it
  // shares the pill's and the labels' middle. It was `top: "50%"` + a negative
  // margin, but an absolute child's percentage resolves against the track's
  // height LESS its padding while the offset starts at the padding edge, which
  // left every line 4pt above centre.
  tabDividerBox: { position: "absolute", top: 4, bottom: 4, left: 4 - 0.5, width: 1, justifyContent: "center" },
  tabDivider:    { width: 1, height: 16, borderRadius: 0.5 },
  section:       { fontFamily: FontFamily.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 16, marginBottom: 12 },
  sectionHeading:{ fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  programCardInner:{ padding: 14, gap: 10 },
  programTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cycleGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:     { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  empty:         { fontFamily: FontFamily.regular, fontSize: 13, padding: 18, textAlign: "center" },
  itemRow:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  itemName:      { fontFamily: FontFamily.semibold, fontSize: 14 },
  itemMeta:      { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  statusPill:    { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  statusText:    { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.3 },
  shareBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: PILL_RADIUS, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  shareBtnText:  { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  // Options sheet — mirrors the chat screen's menu styles.
  menuName:      { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 6 },
  menu:          { paddingHorizontal: 20, paddingTop: 10, gap: 12 },
});
