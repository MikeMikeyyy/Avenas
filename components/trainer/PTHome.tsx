import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn, FadeOut, LinearTransition,
  useSharedValue, useAnimatedStyle, withTiming,
} from "react-native-reanimated";

import FadeScreen from "../FadeScreen";
import NeuCard from "../NeuCard";
import BounceButton from "../BounceButton";
import ClientCard from "./ClientCard";
import AddClientSheet from "./AddClientSheet";
import ProgramPickerSheet from "./ProgramPickerSheet";
import RecipientPickerSheet from "./RecipientPickerSheet";
import PeopleIcon from "../icons/PeopleIcon";
import ChatIcon from "../icons/ChatIcon";
import PlusIcon from "../icons/PlusIcon";
import SendIcon from "../icons/SendIcon";
import TrashIcon from "../TrashIcon";
import UnreadBadge from "../UnreadBadge";
import { useUnreadMessages } from "../../hooks/useUnreadMessages";
import { Ionicons } from "@expo/vector-icons";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  appendSharedPrograms,
  batchKeyOf,
  loadClientData,
  loadClients,
  loadSentPrograms,
  loadSharedPrograms,
  makeInitials,
  migrateBroadcastShares,
  migrateCoachReceivedShares,
  removeCoach,
  removeSharedProgramBatch,
  saveClients,
  type Client,
  type SentProgram,
  type SharedProgram,
} from "../../utils/trainerStore";
import { seedMockClientsIfNeeded } from "../../utils/mockClientSeed";
import { getJSON } from "../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../constants/programs";

// Same SVG used by workout.tsx / new-program.tsx / review screen.
function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function ChevronToggle({ expanded, color, upDown }: { expanded: boolean; color: string; upDown?: boolean }) {
  const sv = useSharedValue(expanded ? 1 : 0);
  useEffect(() => { sv.value = withTiming(expanded ? 1 : 0, { duration: 220 }); }, [expanded, sv]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: upDown ? `${sv.value * 180}deg` : `${sv.value * 90 - 90}deg` }],
  }));
  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={20} color={color} />
    </Animated.View>
  );
}

export default function PTHome() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unreadMessages = useUnreadMessages();

  const [clients, setClients] = useState<Client[]>([]);
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [reviews, setReviews] = useState<SentProgram[]>([]);
  const [activeProgramByClient, setActiveProgramByClient] = useState<Record<string, string>>({});
  const [sharedOut, setSharedOut] = useState<SharedProgram[]>([]);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pendingProgram, setPendingProgram] = useState<SavedProgram | null>(null);
  const [expandedShared, setExpandedShared] = useState<Set<string>>(new Set());
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  const [collapsedSharedSection, setCollapsedSharedSection] = useState(false);
  const [collapsedReviewsSection, setCollapsedReviewsSection] = useState(false);
  const [collapsedClientsSection, setCollapsedClientsSection] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSharedSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedSharedSection(v => !v);
  }, []);
  const toggleReviewsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedReviewsSection(v => !v);
  }, []);
  const toggleClientsSection = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedClientsSection(v => !v);
  }, []);
  const toggleSearch = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Closing: clear the query and drop the keyboard in the same tap, so the X
    // removes the search row and dismisses the keyboard together.
    if (searchOpen) {
      setSearch("");
      Keyboard.dismiss();
    }
    setSearchOpen(v => !v);
  }, [searchOpen]);

  const toggleShared = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedShared(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleReview = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedReviews(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      const seeded = await seedMockClientsIfNeeded();
      const fresh = seeded.length > 0 ? seeded : await loadClients();
      const progs = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
      const sent = await loadSentPrograms();
      await migrateBroadcastShares(fresh);
      await migrateCoachReceivedShares();
      const shared = await loadSharedPrograms();
      const activeMap: Record<string, string> = {};
      await Promise.all(fresh.map(async c => {
        const data = await loadClientData(c.id);
        const active = data.programs.find(p => p.status === "active");
        if (active) activeMap[c.id] = active.name;
      }));
      if (!cancelled) {
        setClients(fresh);
        setMyPrograms(Array.isArray(progs) ? progs : []);
        setReviews(sent);
        setSharedOut(shared);
        setActiveProgramByClient(activeMap);
      }
    })();
    return () => { cancelled = true; };
  }, []));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  const handleAddClient = useCallback(async (name: string, note: string) => {
    const newClient: Client = {
      id: `client_${Date.now()}`,
      name,
      initials: makeInitials(name),
      note: note || undefined,
      lastActiveISO: new Date().toISOString(),
      streak: 0,
    };
    const next = [newClient, ...clients];
    setClients(next);
    await saveClients(next);
  }, [clients]);

  const handleRemoveClient = useCallback((client: Client) => {
    const isTrainer = !!client.isTrainer;
    Alert.alert(
      isTrainer ? "Remove Trainer" : "Remove Client",
      isTrainer
        ? `Remove ${client.name}? This ends your connection, so they'll also be removed from your coaches.`
        : `Remove ${client.name} from your roster? Their data will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const next = clients.filter(c => c.id !== client.id);
            setClients(next);
            await saveClients(next);
            // A trainer connection is symmetric — drop the coach link too.
            if (isTrainer) await removeCoach(client.id);
          },
        },
      ]
    );
  }, [clients]);

  const openRemovePicker = useCallback(() => {
    if (clients.length === 0) {
      Alert.alert("No Clients", "You haven't added any clients yet.");
      return;
    }
    Alert.alert(
      "Remove a Client",
      "Pick a client to remove.",
      [
        { text: "Cancel", style: "cancel" },
        ...clients.map(c => ({
          text: c.name,
          style: "destructive" as const,
          onPress: () => handleRemoveClient(c),
        })),
      ]
    );
  }, [clients, handleRemoveClient]);

  const openManageClients = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Manage Clients",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add a Client", onPress: () => setAddOpen(true) },
        { text: "Remove a Client", style: "destructive", onPress: openRemovePicker },
      ]
    );
  }, [openRemovePicker]);

  const batches = useMemo(() => {
    const byKey = new Map<string, SharedProgram[]>();
    for (const s of sharedOut) {
      // Skip programs a coach sent ME — those belong on the My Coaches page,
      // not in this trainer's "Programs You've Sent" list.
      if (s.receivedFromCoachId) continue;
      const k = batchKeyOf(s);
      const arr = byKey.get(k);
      if (arr) arr.push(s);
      else byKey.set(k, [s]);
    }
    return Array.from(byKey.entries()).map(([key, entries]) => {
      const head = entries[0];
      const acceptedCount = entries.filter(e => !!e.acceptedAtISO).length;
      return {
        key,
        programId: head.programId,
        programName: head.programName,
        sentAtISO: head.sentAtISO,
        programSnapshot: head.programSnapshot,
        entries,
        acceptedCount,
        total: entries.length,
        allAccepted: entries.length > 0 && acceptedCount === entries.length,
      };
    });
  }, [sharedOut]);

  const handleUnshareBatch = useCallback((batch: typeof batches[number]) => {
    const anyAccepted = batch.entries.some(e => !!e.acceptedAtISO);
    Alert.alert(
      "Unsend Program",
      `Unsend "${batch.programName}" from ${batch.total} client${batch.total === 1 ? "" : "s"}? ${anyAccepted ? "Clients who already accepted will keep the program in their library." : "They will no longer see it."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
          style: "destructive",
          onPress: async () => {
            await removeSharedProgramBatch(batch.key);
            setSharedOut(prev => prev.filter(s => batchKeyOf(s) !== batch.key));
          },
        },
      ]
    );
  }, []);

  const handleProgramPicked = useCallback((program: SavedProgram) => {
    if (clients.length === 0) {
      Alert.alert("No clients", "Add a client before sending a program.");
      return;
    }
    setPendingProgram(program);
  }, [clients]);

  const handleConfirmRecipients = useCallback(async (recipients: string[] | "all") => {
    if (!pendingProgram) return;
    const now = new Date().toISOString();
    const base = `share_${Date.now()}`;
    const targets = recipients === "all" ? clients.map(c => c.id) : recipients;
    if (targets.length === 0) {
      Alert.alert("No recipients", "Add a client before sending a program.");
      return;
    }
    const entries: SharedProgram[] = targets.map((cid, i) => ({
      id: `${base}_${i}`,
      clientId: cid,
      programId: pendingProgram.id,
      programName: pendingProgram.name,
      sentAtISO: now,
      programSnapshot: pendingProgram,
    }));
    await appendSharedPrograms(entries);
    setSharedOut(prev => [...entries, ...prev]);
    Alert.alert("Program Sent", `"${pendingProgram.name}" was sent to ${targets.length} client${targets.length === 1 ? "" : "s"}.`);
    setPendingProgram(null);
  }, [pendingProgram, clients]);

  return (
    <FadeScreen style={{ backgroundColor: t.bg }}>
      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFillObject} maskElement={
          <LinearGradient
            colors={["black", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.5)", "transparent"]}
            locations={[0, 0.6, 0.85, 1]}
            style={StyleSheet.absoluteFillObject}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFillObject} />
        </MaskedView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        // Without this the keyboard eats the first tap on any button (incl. the
        // search-close X) while the search field is focused, forcing a double tap.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 140 }}
      >
        <View style={styles.coachesRow}>
          <BounceButton
            style={styles.coachesBtnWrap}
            onPress={() => router.push("/trainer/coaches")}
            accessibilityLabel="Open my coaches"
          >
            <NeuCard dark={isDark} radius={12} shadowSize="sm">
              <View style={styles.coachesBtn}>
                <Ionicons name="person-outline" size={16} color={ACCT} />
                <Text style={[styles.coachesBtnText, { color: t.tp }]}>My Coaches</Text>
                <Ionicons name="chevron-forward" size={14} color={t.ts} />
              </View>
            </NeuCard>
          </BounceButton>
          <View style={{ flex: 1 }} />
          <BounceButton onPress={() => router.push("/trainer/messages")} accessibilityLabel="Open messages">
            <View>
              <View style={[styles.searchBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
                <ChatIcon size={18} color={t.tp} />
              </View>
              <UnreadBadge count={unreadMessages} style={styles.msgBadge} />
            </View>
          </BounceButton>
          <BounceButton onPress={toggleSearch} accessibilityLabel={searchOpen ? "Close search" : "Search clients"}>
            <View style={[styles.searchBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
              <Ionicons name={searchOpen ? "close" : "search"} size={18} color={t.tp} />
            </View>
          </BounceButton>
          <BounceButton onPress={openManageClients} accessibilityLabel="Manage clients">
            <View style={[styles.manageBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "#ffffff" }]}>
              <Ionicons name="add" size={24} color={t.tp} />
            </View>
          </BounceButton>
        </View>

        <View style={styles.titleRow}>
          <Pressable onPress={toggleClientsSection} style={styles.clientsHeaderLeft} accessibilityRole="button" accessibilityLabel="Toggle clients list">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.title, { color: t.tp }]}>My Clients</Text>
              <ChevronToggle expanded={!collapsedClientsSection} color={t.ts} />
            </View>
            <Text style={[styles.subtitle, { color: t.ts }]}>
              {clients.length} {clients.length === 1 ? "client" : "clients"}
            </Text>
          </Pressable>
        </View>

        {searchOpen && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search clients"
              placeholderTextColor={t.ts}
              autoFocus
              style={[styles.search, { color: t.tp, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}
            />
          </Animated.View>
        )}

        <BounceButton style={{ marginBottom: 18 }} onPress={() => setSendOpen(true)}>
          <View style={[styles.broadcast, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <SendIcon size={18} color="#fff" />
            <Text style={styles.broadcastText}>Send a Program</Text>
          </View>
        </BounceButton>

        {filtered.length === 0 ? (
          search ? (
            <NeuCard dark={isDark} radius={12}>
              <View style={styles.noMatchRow}>
                <Ionicons name="search-outline" size={15} color={t.ts} />
                <Text style={[styles.noMatchText, { color: t.ts }]}>No matches for "{search}"</Text>
              </View>
            </NeuCard>
          ) : (
            <NeuCard dark={isDark} radius={20}>
              <View style={styles.emptyInner}>
                <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                  <PeopleIcon size={28} color={ACCT} />
                </View>
                <Text style={[styles.emptyTitle, { color: t.tp }]}>No clients yet</Text>
                <Text style={[styles.emptyBody, { color: t.ts }]}>Tap the + button to add your first client.</Text>
              </View>
            </NeuCard>
          )
        ) : collapsedClientsSection ? (
          <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
            {filtered.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => router.push({ pathname: "/trainer/client/[id]", params: { id: c.id } })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Open ${c.name}`}
                style={[styles.summaryRow, { borderBottomColor: t.div, borderBottomWidth: i === filtered.length - 1 ? 0 : 1 }]}
              >
                <View style={[styles.summaryAvatar, { backgroundColor: isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)" }]}>
                  <Text style={[styles.summaryAvatarText, { color: ACCT }]}>{c.initials}</Text>
                </View>
                <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{c.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={t.ts} />
              </TouchableOpacity>
            ))}
          </NeuCard>
        ) : (
          filtered.map(c => (
            <ClientCard
              key={c.id}
              client={c}
              activeProgramName={activeProgramByClient[c.id]}
              onPress={() => router.push({ pathname: "/trainer/client/[id]", params: { id: c.id } })}
            />
          ))
        )}

        {batches.length > 0 && (
          <>
            <Pressable onPress={toggleSharedSection} style={styles.sectionHeaderRow} accessibilityRole="button">
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Programs You've Sent</Text>
              <ChevronToggle expanded={!collapsedSharedSection} color={t.ts} />
            </Pressable>
            {collapsedSharedSection ? (
              <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                {batches.map((b, i) => {
                  const pillLabel = b.allAccepted ? "Accepted" : `${b.acceptedCount}/${b.total} accepted`;
                  return (
                    <TouchableOpacity
                      key={b.key}
                      onPress={() => router.push({ pathname: "/program-view", params: { sharedId: b.entries[0].id } })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${b.programName}`}
                      style={[
                        styles.summaryRow,
                        { borderBottomColor: t.div, borderBottomWidth: i === batches.length - 1 ? 0 : 1 },
                      ]}
                    >
                      <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{b.programName}</Text>
                      <View style={[styles.statusPill, b.allAccepted
                        ? { backgroundColor: `${ACCT}22` }
                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                      ]}>
                        <Text style={[styles.statusText, { color: b.allAccepted ? ACCT : t.ts }]}>
                          {pillLabel}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </NeuCard>
            ) : batches.map(b => {
              const cycle = b.programSnapshot?.cyclePattern ?? [];
              const isExpanded = expandedShared.has(b.key);
              const pillLabel = b.allAccepted ? "Accepted" : `${b.acceptedCount}/${b.total} accepted`;
              return (
                <Animated.View key={b.key} layout={LinearTransition.duration(220)}>
                  <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                    <Pressable onPress={() => toggleShared(b.key)} style={styles.reviewInner}>
                      <View style={styles.reviewTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reviewName, { color: t.tp }]} numberOfLines={1}>{b.programName}</Text>
                          <Text style={[styles.reviewMeta, { color: t.ts }]} numberOfLines={1}>
                            Sent {fmtAgo(b.sentAtISO)} · {b.total} client{b.total === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <View style={[styles.statusPill, b.allAccepted
                          ? { backgroundColor: `${ACCT}22` }
                          : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                        ]}>
                          <Text style={[styles.statusText, { color: b.allAccepted ? ACCT : t.ts }]}>
                            {pillLabel}
                          </Text>
                        </View>
                      </View>
                      {cycle.length > 0 && (
                        <View style={styles.cycleGrid}>
                          {cycle.map((day, i) => {
                            const isTraining = day !== "Rest" && day !== "";
                            return (
                              <View
                                key={i}
                                style={[
                                  styles.cycleChip,
                                  isTraining
                                    ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                                    : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                                ]}
                              >
                                <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                                  {day || "Rest"}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {isExpanded && (
                        <Animated.View
                          entering={FadeIn.duration(180)}
                          exiting={FadeOut.duration(140)}
                          style={{ gap: 4 }}
                        >
                          <View style={[styles.recipientList, { borderColor: t.div }]}>
                            {b.entries.map((e, i) => {
                              const eAccepted = !!e.acceptedAtISO;
                              const name = clients.find(c => c.id === e.clientId)?.name ?? "Removed client";
                              return (
                                <View
                                  key={e.id}
                                  style={[
                                    styles.recipientRow,
                                    { borderBottomColor: t.div, borderBottomWidth: i === b.entries.length - 1 ? 0 : StyleSheet.hairlineWidth },
                                  ]}
                                >
                                  <View
                                    style={[
                                      styles.recipientDot,
                                      eAccepted
                                        ? { backgroundColor: ACCT, borderColor: ACCT }
                                        : { backgroundColor: "transparent", borderColor: t.ts },
                                    ]}
                                  />
                                  <Text style={[styles.recipientName, { color: t.tp }]} numberOfLines={1}>{name}</Text>
                                  <Text style={[styles.recipientStatus, { color: eAccepted ? ACCT : t.ts }]}>
                                    {eAccepted ? `Accepted · ${fmtAgo(e.acceptedAtISO!)}` : "Pending"}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                          <View style={styles.sharedActionRow}>
                            <BounceButton
                              style={{ flex: 2 }}
                              onPress={() => router.push({ pathname: "/program-view", params: { sharedId: b.entries[0].id } })}
                              accessibilityLabel={`View ${b.programName}`}
                            >
                              <NeuCard dark={isDark} radius={14} innerStyle={styles.sharedActionBtnInner}>
                                <Text style={[styles.reviewBtnText, { color: t.tp }]}>View Program</Text>
                              </NeuCard>
                            </BounceButton>
                            <BounceButton
                              style={{ flex: 1 }}
                              onPress={() => handleUnshareBatch(b)}
                              accessibilityLabel={`Delete ${b.programName}`}
                            >
                              <NeuCard dark={isDark} radius={14} innerStyle={styles.sharedActionBtnInner}>
                                <TrashIcon size={16} color="#E53935" />
                                <Text style={styles.deleteBtnText}>Delete</Text>
                              </NeuCard>
                            </BounceButton>
                          </View>
                        </Animated.View>
                      )}
                      <View style={styles.chevronRow}>
                        <ChevronToggle expanded={isExpanded} color={t.ts} upDown />
                      </View>
                    </Pressable>
                  </NeuCard>
                </Animated.View>
              );
            })}
          </>
        )}

        {reviews.length > 0 && (
          <>
            <Pressable onPress={toggleReviewsSection} style={styles.sectionHeaderRow} accessibilityRole="button">
              <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 0, marginBottom: 0 }]}>Programs Received</Text>
              <ChevronToggle expanded={!collapsedReviewsSection} color={t.ts} />
            </Pressable>
            {collapsedReviewsSection ? (
              <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                {reviews.map((r, i) => {
                  const returned = r.status === "returned";
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => router.push({ pathname: "/trainer/review/[id]", params: { id: r.id } })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Open review for ${r.programName}`}
                      style={[
                        styles.summaryRow,
                        { borderBottomColor: t.div, borderBottomWidth: i === reviews.length - 1 ? 0 : 1 },
                      ]}
                    >
                      <Text style={[styles.summaryName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                      <View style={[styles.statusPill, returned
                        ? { backgroundColor: `${ACCT}22` }
                        : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                      ]}>
                        <Text style={[styles.statusText, { color: returned ? ACCT : t.ts }]}>
                          {returned ? "Returned" : "Awaiting review"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </NeuCard>
            ) : reviews.map(r => {
              const returned = r.status === "returned";
              const cycle = r.programSnapshot?.cyclePattern ?? [];
              const isExpanded = expandedReviews.has(r.id);
              return (
                <Animated.View key={r.id} layout={LinearTransition.duration(220)}>
                  <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                    <Pressable onPress={() => toggleReview(r.id)} style={styles.reviewInner}>
                      <View style={styles.reviewTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reviewName, { color: t.tp }]} numberOfLines={1}>{r.programName}</Text>
                          <Text style={[styles.reviewMeta, { color: t.ts }]}>
                            From a client · Sent {fmtAgo(r.sentAtISO)}
                          </Text>
                        </View>
                        <View style={[styles.statusPill, returned
                          ? { backgroundColor: `${ACCT}22` }
                          : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" },
                        ]}>
                          <Text style={[styles.statusText, { color: returned ? ACCT : t.ts }]}>
                            {returned ? "Returned" : "Awaiting review"}
                          </Text>
                        </View>
                      </View>
                      {cycle.length > 0 && (
                        <View style={styles.cycleGrid}>
                          {cycle.map((day, i) => {
                            const isTraining = day !== "Rest" && day !== "";
                            return (
                              <View
                                key={i}
                                style={[
                                  styles.cycleChip,
                                  isTraining
                                    ? { backgroundColor: ACCT + "22", borderColor: ACCT, borderWidth: 1 }
                                    : { backgroundColor: isDark ? "rgba(255,255,255,0.1)" : t.div },
                                ]}
                              >
                                <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]}>
                                  {day || "Rest"}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {isExpanded && (
                        <Animated.View
                          entering={FadeIn.duration(180)}
                          exiting={FadeOut.duration(140)}
                        >
                          <BounceButton onPress={() => router.push({ pathname: "/trainer/review/[id]", params: { id: r.id } })}>
                            <NeuCard dark={isDark} radius={14} innerStyle={styles.sharedActionBtnInner}>
                              <Text style={[styles.reviewBtnText, { color: t.tp }]}>
                                {returned ? "View Review" : "Edit & Send Back"}
                              </Text>
                            </NeuCard>
                          </BounceButton>
                        </Animated.View>
                      )}
                      <View style={styles.chevronRow}>
                        <ChevronToggle expanded={isExpanded} color={t.ts} upDown />
                      </View>
                    </Pressable>
                  </NeuCard>
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>

      <AddClientSheet visible={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAddClient} />
      <ProgramPickerSheet
        visible={sendOpen}
        title="Send a Program"
        subtitle="Pick a program, then choose who receives it."
        programs={myPrograms}
        onPick={handleProgramPicked}
        onClose={() => setSendOpen(false)}
      />
      <RecipientPickerSheet
        visible={pendingProgram !== null}
        programName={pendingProgram?.name ?? ""}
        clients={clients}
        onConfirm={handleConfirmRecipients}
        onClose={() => setPendingProgram(null)}
      />

      {kbHeight > 0 && Platform.OS === "ios" && (
        <View style={{ position: "absolute", right: 10, bottom: kbHeight + 8, zIndex: 999 }}>
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            activeOpacity={0.75}
            style={[styles.kbFloatBtn, { backgroundColor: isDark ? "rgba(58,58,60,0.97)" : "#fff" }]}
            accessibilityLabel="Dismiss keyboard"
            accessibilityRole="button"
          >
            <KeyboardDismissIcon color={isDark ? "#fff" : "#333"} />
          </TouchableOpacity>
        </View>
      )}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient:  { position: "absolute", left: 0, right: 0, zIndex: 5 },
  coachesRow:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  coachesBtnWrap: { alignSelf: "center" },
  coachesBtn:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, gap: 8 },
  coachesBtnText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  titleRow:     { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  clientsHeaderLeft: { flex: 1, flexDirection: "column" },
  title:        { fontFamily: FontFamily.bold, fontSize: 32 },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  addBtn:       { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  manageBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  searchBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 },
  msgBadge:     { position: "absolute", top: -5, right: -5 },
  searchRow:    { marginBottom: 14 },
  search:       { fontFamily: FontFamily.regular, fontSize: 15, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  summaryAvatar:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  summaryAvatarText:{ fontFamily: FontFamily.bold, fontSize: 11 },
  broadcast:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  broadcastText:{ fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  emptyInner:   { padding: 28, alignItems: "center", gap: 10 },
  noMatchRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  noMatchText:  { fontFamily: FontFamily.regular, fontSize: 13 },
  emptyIcon:    { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
  sectionHeading:{ fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 12 },
  summaryRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  summaryName:   { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14 },
  reviewInner:  { padding: 14, gap: 12 },
  reviewTop:    { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewName:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  reviewMeta:   { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  statusPill:   { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  statusText:   { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.3 },
  reviewBtnText:{ fontFamily: FontFamily.bold, fontSize: 14 },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  kbFloatBtn:   { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  chevronRow:    { alignItems: "center", paddingTop: 2 },
  sharedActionRow:{ flexDirection: "row", gap: 10, marginTop: 4 },
  sharedActionBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, minHeight: 44 },
  deleteBtnText:  { fontFamily: FontFamily.bold, fontSize: 14, color: "#E53935", letterSpacing: 0.2 },
  recipientList:  { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, marginTop: 2 },
  recipientRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  recipientDot:   { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  recipientName:  { flex: 1, fontFamily: FontFamily.semibold, fontSize: 13 },
  recipientStatus:{ fontFamily: FontFamily.regular, fontSize: 11 },
});
