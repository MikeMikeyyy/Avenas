// PT-side detail screen for a single client.
// Tabs: Progress | Journal | Programs. Chat is a stub.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, ScrollView } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";

import NeuCard from "../../../components/NeuCard";
import BounceButton from "../../../components/BounceButton";
import ProgressView from "../../../components/progress/ProgressView";
import ClientJournalView from "../../../components/journal/ClientJournalView";
import ProgramPickerSheet from "../../../components/trainer/ProgramPickerSheet";
import ChatIcon from "../../../components/icons/ChatIcon";
import SendIcon from "../../../components/icons/SendIcon";
import TrashIcon from "../../../components/TrashIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../../constants/theme";
import { useTheme } from "../../../contexts/ThemeContext";
import {
  appendSharedPrograms,
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
import { getJSON } from "../../../utils/storage";
import { PROGRAMS_KEY, type SavedProgram } from "../../../constants/programs";

type Tab = "progress" | "journal" | "programs";

function fmtAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();

  const [client, setClient] = useState<Client | null>(null);
  const [data, setData] = useState<ClientData>({ workoutHistory: [], programs: [], journal: [] });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("progress");
  const [myPrograms, setMyPrograms] = useState<SavedProgram[]>([]);
  const [shared, setShared] = useState<SharedProgram[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [tabsWidth, setTabsWidth] = useState(0);

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

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      const [list, d, progs, sharedAll] = await Promise.all([
        loadClients(),
        id ? loadClientData(id) : Promise.resolve({ workoutHistory: [], programs: [], journal: [] } as ClientData),
        getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
        loadSharedPrograms(),
      ]);
      let found: Client | null = list.find(c => c.id === id) ?? null;
      if (!found && id) {
        // Real connected account (not in the local roster) — build a lightweight
        // client from the connection's safe profile (real name + photo). Their
        // training data isn't shared cross-account yet, so the data tabs stay
        // empty for now.
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
      if (cancelled) return;
      setClient(found);
      setData(d);
      setMyPrograms(Array.isArray(progs) ? progs : []);
      setShared(sharedAll);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [id]));

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
    Alert.alert(
      "Unsend Program",
      `Unsend "${entry.programName}" from ${client?.name ?? "this client"}? ${entry.acceptedAtISO ? "They have already accepted it — the program will stay in their library." : "They will no longer see it."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
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
    };
    await appendSharedPrograms([entry]);
    setShared(prev => [entry, ...prev]);
    Alert.alert("Program Sent", `"${program.name}" was sent to ${client?.name ?? "this client"}.`);
  }, [id, client]);

  const openChat = () => {
    if (!client) return;
    router.push({ pathname: "/trainer/chat/[id]", params: { id: client.id, name: client.name, initials: client.initials } });
  };

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

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
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} accessibilityLabel="Go back" accessibilityRole="button">
          {isGlassEffectAPIAvailable() ? (
            <GlassView glassEffectStyle="regular" style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={22} color={t.tp} />
            </GlassView>
          ) : (
            <View style={[styles.iconBtn, { backgroundColor: isDark ? t.div : "#fff" }]}>
              <Ionicons name="chevron-back" size={22} color={t.tp} />
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Avatar
            uri={client.photoUri}
            initials={client.initials}
            size={36}
            backgroundColor={isDark ? "rgba(29,236,160,0.12)" : "rgba(29,236,160,0.18)"}
            textColor={ACCT}
            textStyle={[styles.avatarText, { color: ACCT }]}
          />
          <Text style={[styles.name, { color: t.tp }]} numberOfLines={1}>{client.name}</Text>
        </View>

        <TouchableOpacity onPress={openChat} activeOpacity={0.8} accessibilityLabel="Chat with client" accessibilityRole="button">
          <View style={[styles.chatBtn, { backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4 }]}>
            <ChatIcon size={18} color={APP_LIGHT.tp} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Tab segmented control — animated sliding pill */}
      <View style={styles.tabsWrap}>
        <View
          style={[styles.tabs, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}
          onLayout={e => setTabsWidth(e.nativeEvent.layout.width - styles.tabs.padding * 2)}
        >
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

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {tab === "progress" && (
          <ProgressView
            history={data.workoutHistory}
            programs={data.programs}
            loaded
            title=""
            asScreen={false}
            withTopInset={false}
            bottomPadding={insets.bottom + 140}
          />
        )}
        {tab === "journal" && (
          <ClientJournalView
            entries={data.journal}
            workoutHistory={data.workoutHistory}
            programs={data.programs}
            bottomPadding={insets.bottom + 140}
          />
        )}
        {tab === "programs" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 34, paddingBottom: insets.bottom + 140 }}
          >
            <BounceButton style={{ marginBottom: 16 }} onPress={() => setShareOpen(true)}>
              <View style={[styles.shareBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
                <SendIcon size={18} color="#fff" />
                <Text style={styles.shareBtnText}>Share a Program</Text>
              </View>
            </BounceButton>

            <Text style={[styles.sectionHeading, { color: t.tp, marginTop: 4 }]}>{client.name.split(" ")[0]}'s Programs</Text>
            {data.programs.length === 0 ? (
              <NeuCard dark={isDark} radius={16}>
                <Text style={[styles.empty, { color: t.ts }]}>This client has no programs yet.</Text>
              </NeuCard>
            ) : (
              data.programs.map(p => {
                const isActive = p.status === "active";
                return (
                  <NeuCard key={p.id} dark={isDark} radius={16} style={{ marginBottom: 10 }}>
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
                    </View>
                  </NeuCard>
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
                        accessibilityLabel="Unsend program"
                        accessibilityRole="button"
                      >
                        <TrashIcon size={18} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  </NeuCard>
                );
              })
            )}
          </ScrollView>
        )}
      </View>

      <ProgramPickerSheet
        visible={shareOpen}
        title={`Share with ${client.name}`}
        subtitle="Pick one of your programs to send."
        programs={myPrograms}
        onPick={handleShare}
        onClose={() => setShareOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  headerCenter:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn:       { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  chatBtn:       { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatar:        { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText:    { fontFamily: FontFamily.bold, fontSize: 13 },
  name:          { fontFamily: FontFamily.bold, fontSize: 18, flex: 1 },
  tabsWrap:      { paddingHorizontal: 20, paddingBottom: 8 },
  tabs:          { flexDirection: "row", borderRadius: 999, padding: 4, position: "relative", overflow: "hidden" },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center", justifyContent: "center", zIndex: 1 },
  tabText:       { fontFamily: FontFamily.semibold, fontSize: 13 },
  tabPill:       { position: "absolute", top: 4, bottom: 4, left: 4, borderRadius: 999, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8 },
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
  shareBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  shareBtnText:  { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
});
