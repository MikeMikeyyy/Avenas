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
import PlusIcon from "../icons/PlusIcon";
import SendIcon from "../icons/SendIcon";
import TrashIcon from "../TrashIcon";
import { Ionicons } from "@expo/vector-icons";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../constants/theme";
import { useTheme } from "../../contexts/ThemeContext";
import {
  appendSharedPrograms,
  loadClientData,
  loadClients,
  loadSentPrograms,
  loadSharedPrograms,
  makeInitials,
  removeSharedProgram,
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

function ChevronToggle({ expanded, color }: { expanded: boolean; color: string }) {
  const sv = useSharedValue(expanded ? 1 : 0);
  useEffect(() => { sv.value = withTiming(expanded ? 1 : 0, { duration: 220 }); }, [expanded, sv]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${sv.value * 180}deg` }] }));
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

  const handleUnshare = useCallback((entry: SharedProgram) => {
    const recipient = entry.clientId === "all"
      ? "all clients"
      : clients.find(c => c.id === entry.clientId)?.name ?? "the client";
    Alert.alert(
      "Unsend Program",
      `Unsend "${entry.programName}" from ${recipient}? ${entry.acceptedAtISO ? "They have already accepted it — the program will stay in their library." : "They will no longer see it."}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
          style: "destructive",
          onPress: async () => {
            await removeSharedProgram(entry.id);
            setSharedOut(prev => prev.filter(s => s.id !== entry.id));
          },
        },
      ]
    );
  }, [clients]);

  const recipientLabel = useCallback((entry: SharedProgram) => {
    if (entry.clientId === "all") return "Broadcast to all clients";
    const c = clients.find(cl => cl.id === entry.clientId);
    return c ? `Sent to ${c.name}` : "Sent to a client";
  }, [clients]);

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
    const entries: SharedProgram[] = recipients === "all"
      ? [{
          id: base,
          clientId: "all",
          programId: pendingProgram.id,
          programName: pendingProgram.name,
          sentAtISO: now,
          programSnapshot: pendingProgram,
        }]
      : recipients.map((cid, i) => ({
          id: `${base}_${i}`,
          clientId: cid,
          programId: pendingProgram.id,
          programName: pendingProgram.name,
          sentAtISO: now,
          programSnapshot: pendingProgram,
        }));
    await appendSharedPrograms(entries);
    const count = recipients === "all" ? clients.length : recipients.length;
    Alert.alert("Program Sent", `"${pendingProgram.name}" was sent to ${count} client${count === 1 ? "" : "s"}.`);
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
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 140 }}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.tp }]}>My Clients</Text>
            <Text style={[styles.subtitle, { color: t.ts }]}>
              {clients.length} {clients.length === 1 ? "client" : "clients"}
            </Text>
          </View>
          <BounceButton onPress={() => setAddOpen(true)} accessibilityLabel="Add client">
            <View style={[styles.addBtn, { backgroundColor: ACCT, shadowColor: ACCT }]}>
              <PlusIcon size={20} color="#fff" />
            </View>
          </BounceButton>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search clients"
            placeholderTextColor={t.ts}
            style={[styles.search, { color: t.tp, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)" }]}
          />
        </View>

        <BounceButton style={{ marginBottom: 18 }} onPress={() => setSendOpen(true)}>
          <View style={[styles.broadcast, { backgroundColor: ACCT, shadowColor: ACCT }]}>
            <SendIcon size={18} color="#fff" />
            <Text style={styles.broadcastText}>Send a Program</Text>
          </View>
        </BounceButton>

        {filtered.length === 0 ? (
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: isDark ? "rgba(29,236,160,0.1)" : "rgba(29,236,160,0.14)" }]}>
                <PeopleIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>
                {search ? "No matches" : "No clients yet"}
              </Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>
                {search ? "Try a different name." : "Tap the + button to add your first client."}
              </Text>
            </View>
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

        {sharedOut.length > 0 && (
          <>
            <Text style={[styles.sectionHeading, { color: t.tp }]}>Programs You've Sent</Text>
            {sharedOut.map(s => {
              const accepted = !!s.acceptedAtISO;
              const cycle = s.programSnapshot?.cyclePattern ?? [];
              const isExpanded = expandedShared.has(s.id);
              return (
                <Animated.View key={s.id} layout={LinearTransition.duration(220)}>
                  <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
                    <Pressable onPress={() => toggleShared(s.id)} style={styles.reviewInner}>
                      <View style={styles.reviewTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reviewName, { color: t.tp }]} numberOfLines={1}>{s.programName}</Text>
                          <Text style={[styles.reviewMeta, { color: t.ts }]} numberOfLines={1}>
                            {recipientLabel(s)} · {fmtAgo(s.sentAtISO)}
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
                          style={styles.sharedActionRow}
                        >
                          <BounceButton
                            style={{ flex: 1 }}
                            onPress={() => router.push({ pathname: "/new-program", params: { sharedId: s.id } })}
                          >
                            <View style={[styles.reviewBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                              <Ionicons name="create-outline" size={16} color={t.tp} />
                              <Text style={[styles.reviewBtnText, { color: t.tp }]}>Edit</Text>
                            </View>
                          </BounceButton>
                          <BounceButton style={styles.deleteSharedBtn} onPress={() => handleUnshare(s)}>
                            <View style={[styles.reviewBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                              <TrashIcon size={16} color="#E53935" />
                            </View>
                          </BounceButton>
                        </Animated.View>
                      )}
                      <View style={styles.chevronRow}>
                        <ChevronToggle expanded={isExpanded} color={t.ts} />
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
            <Text style={[styles.sectionHeading, { color: t.tp }]}>Programs Received</Text>
            {reviews.map(r => {
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
                            <View style={[styles.reviewBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }]}>
                              <Text style={[styles.reviewBtnText, { color: t.tp }]}>
                                {returned ? "View Review" : "Edit & Send Back"}
                              </Text>
                            </View>
                          </BounceButton>
                        </Animated.View>
                      )}
                      <View style={styles.chevronRow}>
                        <ChevronToggle expanded={isExpanded} color={t.ts} />
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
  titleRow:     { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  title:        { fontFamily: FontFamily.bold, fontSize: 32 },
  subtitle:     { fontFamily: FontFamily.regular, fontSize: 13, marginTop: 2 },
  addBtn:       { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  searchRow:    { marginBottom: 14 },
  search:       { fontFamily: FontFamily.regular, fontSize: 15, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  broadcast:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  broadcastText:{ fontFamily: FontFamily.bold, fontSize: 15, color: "#fff", letterSpacing: 0.2 },
  emptyInner:   { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon:    { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:   { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:    { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
  sectionHeading:{ fontFamily: FontFamily.bold, fontSize: 18, marginTop: 24, marginBottom: 12 },
  reviewInner:  { padding: 14, gap: 12 },
  reviewTop:    { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewName:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  reviewMeta:   { fontFamily: FontFamily.regular, fontSize: 12, marginTop: 2 },
  statusPill:   { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  statusText:   { fontFamily: FontFamily.semibold, fontSize: 11, letterSpacing: 0.3 },
  reviewBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14 },
  reviewBtnText:{ fontFamily: FontFamily.bold, fontSize: 14 },
  cycleGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  cycleChip:    { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText:{ fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  kbFloatBtn:   { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
  sharedActionRow:{ flexDirection: "row", gap: 8 },
  deleteSharedBtn:{ width: 56 },
  chevronRow:    { alignItems: "center", paddingTop: 2 },
});
