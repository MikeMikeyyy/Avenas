// The archive: programs taken off a list with Remove → Archive, each with
// Restore and Delete.
//
// ONE page for the three places a program can be archived from, told apart by
// `scope`, so the three archives look and behave the same:
//
//   programs  My Programs. Your own programs (SavedProgram.archivedAt), local
//             and backed up like any other program edit.
//   trainer   The Trainer tab. Sends you made (Programs Sent)
//             (loadTrainerArchive).
//   group     One group's page, for its trainers. Its archived Group Programs,
//             whoever sent them (loadGroupArchive). Needs `groupId`;
//             `groupName` is the caption.
//
// A program someone asked you to review is never here: it's reviewed or
// removed (user decision, 2026-11-05). Reviews were archived here until then,
// with Restore; one archived before reads Not reviewed to the person who
// asked, as a removed one does, and is gone from the trainers' lists for good.
//
// Summary shows what's in a program without putting it back: its Workout
// Summary, every cycle day and its exercises' names (components/
// ProgramSummarySheet.tsx, as on a program's page; user request, 2026-11-06).
// Restore puts a program back where it came from: an archived send reappears
// for everyone it went to, except a recipient who removed it themselves. Delete
// is what Delete on the source page does, asked once more because it's the last
// step. There's no View: Restore is harmless and gets you the page with all of
// its actions.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../constants/floatingBars";
import { useFloatingBarsReach } from "../hooks/useFloatingBars";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../components/MaskedView";
import { Ionicons } from "@expo/vector-icons";

import FadeScreen from "../components/FadeScreen";
import NeuCard from "../components/NeuCard";
import BounceButton from "../components/BounceButton";
import OfflineBanner from "../components/OfflineBanner";
import ProgramSummarySheet from "../components/ProgramSummarySheet";
import TrashIcon from "../components/TrashIcon";
import ArchiveIcon from "../components/icons/ArchiveIcon";
import BackButton, { BACK_SIZE, BACK_TOP } from "../components/BackButton";
import { APP_DARK, APP_LIGHT, ACCT, DANGER_BRIGHT, FontFamily } from "../constants/theme";
import { cardButton, haloGlow, pillGlow, PILL_RADIUS } from "../constants/buttons";
import { CARD_INNER, CARD_META, CARD_PILL, CARD_PILL_TEXT, CARD_TITLE, CARD_TOP } from "../constants/cards";
import { PROGRAMS_KEY, getCurrentWeek, type SavedProgram } from "../constants/programs";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";
import { scheduleCloudPush } from "../lib/syncManager";
import { noteDeleted } from "../utils/syncLocal";
import { useSyncedDataReload } from "../hooks/useSyncedDataReload";
import { fmtAgo, formatStoredDate, fromYMD } from "../utils/dates";
import { getJSON, setJSON } from "../utils/storage";
import { alertMessage } from "../utils/errors";
import { confirmDeleteArchived } from "../utils/archiveChoice";
import { archivedPrograms, restoreProgram } from "../utils/programArchive";
import { keepDeletedProgramName } from "../utils/programDelete";
import { programStatus } from "../utils/programStatus";
import { peekPTHub } from "../utils/trainerHub";
import { peekGroupPage } from "../utils/groupPage";
import {
  batchKeyOf,
  loadGroupArchive,
  loadTrainerArchive,
  removeGroupSharedProgramBatch,
  removeSharedProgramBatch,
  removeSharedProgramByLocalId,
  setSendBatchArchived,
  type ProgramArchive,
  type SharedProgram,
} from "../utils/trainerStore";

type Scope = "programs" | "trainer" | "group";

/** One archived send: its rows, one per person it went to. */
type ArchivedBatch = { key: string; head: SharedProgram; total: number; accepted: number };

/** The cycle strip every program card carries. */
function CycleStrip({ cycle, isDark }: { cycle: string[]; isDark: boolean }) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  if (cycle.length === 0) return null;
  return (
    <View style={styles.cycleGrid}>
      {cycle.map((day, i) => {
        const isTraining = day !== "Rest" && day !== "";
        return (
          <View
            key={i}
            style={[
              styles.cycleChip,
              isTraining
                ? { backgroundColor: `${ACCT}22`, borderColor: ACCT, borderWidth: 1 }
                : { backgroundColor: t.div },
            ]}
          >
            <Text style={[styles.cycleChipText, { color: isTraining ? t.tp : t.ts }]} numberOfLines={1}>
              {day || "Rest"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The one card every archive draws: name, where it stands, its cycle, and
 * Summary, Restore and Delete at the same width: the white button, the green
 * and the red, in the order of a trainer page's open row (View, Accept,
 * Remove). Always open: this page is only for acting on what's in it, so
 * nothing sits behind a tap.
 */
function ArchiveCard({ name, meta, pill, cycle, isDark, onSummary, onRestore, onDelete, needsConnection }: {
  name: string;
  meta: string;
  pill?: ReactNode;
  cycle: string[];
  isDark: boolean;
  /** Omitted when there's no program to show (a send kept without its copy). */
  onSummary?: () => void;
  onRestore: () => void;
  onDelete: () => void;
  /** The Trainer tab's and a group's archives act on the server; My Programs'
   *  is all on this phone. Summary needs neither: it shows what's loaded. */
  needsConnection?: boolean;
}) {
  const t = isDark ? APP_DARK : APP_LIGHT;
  return (
    <NeuCard dark={isDark} radius={16} style={{ marginBottom: 10 }}>
      <View style={styles.cardInner}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            {/* Whole, wrapping, never "…" (user request, 2026-11-06). */}
            <Text style={[styles.cardName, { color: t.tp }]}>{name}</Text>
            <Text style={[styles.cardMeta, { color: t.ts }]}>{meta}</Text>
          </View>
          {pill}
        </View>
        <CycleStrip cycle={cycle} isDark={isDark} />
        <View style={styles.actionRow}>
          {onSummary ? (
            <BounceButton style={{ flex: 1 }} onPress={onSummary} accessibilityLabel={`Summary of ${name}`}>
              <View style={[styles.actionBtn, cardButton(t)]}>
                <Text style={[styles.actionText, { color: t.tp }]}>Summary</Text>
              </View>
            </BounceButton>
          ) : null}
          <BounceButton style={{ flex: 1 }} onPress={onRestore} needsConnection={needsConnection} accessibilityLabel={`Restore ${name}`}>
            <View style={[styles.actionBtn, { backgroundColor: ACCT, ...pillGlow(ACCT, 0.4, isDark) }]}>
              <Ionicons name="arrow-undo" size={15} color="#fff" />
              <Text style={styles.actionText}>Restore</Text>
            </View>
          </BounceButton>
          <BounceButton style={{ flex: 1 }} onPress={onDelete} needsConnection={needsConnection} accessibilityLabel={`Delete ${name} for good`}>
            <View style={[styles.actionBtn, { backgroundColor: DANGER_BRIGHT, ...haloGlow(DANGER_BRIGHT, 0.5, 6, isDark) }]}>
              <TrashIcon size={15} color="#fff" />
              <Text style={styles.actionText}>Delete</Text>
            </View>
          </BounceButton>
        </View>
      </View>
    </NeuCard>
  );
}

export default function ProgramArchiveScreen() {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  const { userId } = useAuth();
  const owner = userId ?? "";
  const params = useLocalSearchParams<{ scope?: string; groupId?: string; groupName?: string }>();
  const scope: Scope = params.scope === "trainer" ? "trainer" : params.scope === "group" && params.groupId ? "group" : "programs";
  const groupId = scope === "group" ? params.groupId : undefined;

  // My Programs: the whole list, since a restore or delete writes it back.
  const [programs, setPrograms] = useState<SavedProgram[]>([]);
  // The Trainer tab / a group: what the server has archived there.
  const [archive, setArchive] = useState<ProgramArchive>({ sends: [] });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // One action at a time: a second tap while a card is on its way out would
  // act on it twice.
  const busy = useRef(false);
  // The program whose Summary is up. The sheet is the page's one RN Modal,
  // mounted only while it shows.
  const [summaryOf, setSummaryOf] = useState<SavedProgram | null>(null);

  const load = useCallback(async (isCancelled: () => boolean) => {
    if (scope === "programs") {
      const list = await getJSON<SavedProgram[]>(PROGRAMS_KEY, []);
      if (isCancelled()) return;
      setPrograms(Array.isArray(list) ? list : []);
    } else {
      const next = groupId ? await loadGroupArchive(groupId) : await loadTrainerArchive();
      if (isCancelled()) return;
      // A failed read keeps what's showing and says so, rather than claiming
      // the archive is empty.
      setFailed(next === null);
      if (next) setArchive(next);
    }
    setLoaded(true);
  }, [scope, groupId]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]));
  // My Programs' archive saves the list it holds: read it again when the
  // account's other phone's changes merge in while it's open.
  useSyncedDataReload(() => { if (scope === "programs") void load(() => false); });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(() => false);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Names, from the saved copy of the page this archive belongs to: no reads
  // of its own, and a name it can't find falls back rather than blocking.
  const hub = useMemo(() => (scope === "trainer" ? peekPTHub(owner) : null), [scope, owner]);
  const groupPage = useMemo(() => (groupId ? peekGroupPage(owner, groupId) : null), [groupId, owner]);
  const groupNameFor = (id: string | undefined) => (id ? hub?.groups.find(g => g.id === id)?.name ?? "a group" : undefined);
  const memberName = (id: string | undefined) => {
    if (id && id === owner) return "You";
    return groupPage?.members.find(m => m.id === id)?.name ?? "A member";
  };

  const archivedMine = useMemo(() => archivedPrograms(programs), [programs]);

  /** A send is one card however many people it went to, as on the page it
   *  came from. `archive.sends` is newest-archived first, and so is this. */
  const batches = useMemo<ArchivedBatch[]>(() => {
    const byKey = new Map<string, SharedProgram[]>();
    for (const s of archive.sends) {
      const k = batchKeyOf(s);
      const list = byKey.get(k);
      if (list) list.push(s); else byKey.set(k, [s]);
    }
    return [...byKey.entries()].map(([key, entries]) => ({
      key,
      head: entries[0],
      total: entries.length,
      accepted: entries.filter(e => !!e.acceptedAtISO).length,
    }));
  }, [archive.sends]);

  /** Run one card's action once, and report a failure instead of leaving the
   *  card looking like a dead button. */
  const run = useCallback(async (failTitle: string, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } catch (e) {
      Alert.alert(failTitle, alertMessage(e, "Check your connection and try again."));
    } finally {
      busy.current = false;
    }
  }, []);

  // ── My Programs ────────────────────────────────────────────────────────────

  const writePrograms = async (next: SavedProgram[]) => {
    setPrograms(next);
    await setJSON(PROGRAMS_KEY, next);
    scheduleCloudPush();
  };

  const restoreMine = (p: SavedProgram) => {
    void run("Couldn't restore it", () => writePrograms(restoreProgram(programs, p.id)));
  };

  const deleteMine = (p: SavedProgram) => {
    confirmDeleteArchived({
      name: p.name,
      note: "This can't be undone.",
      onDelete: () => void run("Couldn't delete it", async () => {
        // Its sessions keep its name, to say whose they were (utils/programDelete.ts).
        await keepDeletedProgramName(p);
        // Recorded before it goes, so the delete reaches the account's other
        // phone and no merge brings it back (utils/syncLocal.ts).
        await noteDeleted("programs", [p]);
        await writePrograms(programs.filter(x => x.id !== p.id));
        // The same clean-up as My Programs' Delete: a received program's card
        // stops pointing at a copy that's gone.
        await removeSharedProgramByLocalId(p.id);
      }),
    });
  };

  // ── Sends ─────────────────────────────────────────────────────────────────

  const dropBatch = (key: string) =>
    setArchive(a => ({ ...a, sends: a.sends.filter(s => batchKeyOf(s) !== key) }));

  const restoreBatch = (b: ArchivedBatch) => {
    void run("Couldn't restore it", async () => {
      await setSendBatchArchived(b.key, false, groupId);
      dropBatch(b.key);
    });
  };

  const deleteBatch = (b: ArchivedBatch) => {
    confirmDeleteArchived({
      name: b.head.programName,
      note: b.accepted > 0
        ? "Anyone who accepted it keeps their copy."
        : "Nobody accepted it, so it's gone for everyone it was sent to.",
      onDelete: () => void run("Couldn't delete it", async () => {
        if (groupId) await removeGroupSharedProgramBatch(groupId, b.key);
        else await removeSharedProgramBatch(b.key);
        dropBatch(b.key);
      }),
    });
  };

  // ── Page ──────────────────────────────────────────────────────────────────

  const caption = scope === "programs" ? "My Programs" : scope === "trainer" ? "Trainer" : (params.groupName || "Group");
  const isEmpty = scope === "programs" ? archivedMine.length === 0 : batches.length === 0;
  // Only programs sent out are archived on a trainer's or a group's page (a
  // program sent for review is reviewed or removed), so the words say sent.
  const emptyBody =
    scope === "programs" ? "Programs you archive from My Programs are kept here. Restore one to put it back in your list."
    : scope === "trainer" ? "Programs you've sent and then archived are kept here. Restore one to put it back, for the people you sent it to as well."
    : "Programs sent to this group and then archived are kept here. Restore one to put it back in the group.";

  const weekText = (p: SavedProgram) =>
    p.status === "completed" ? `Completed ${p.currentWeek} of ${p.totalWeeks} weeks`
    : p.status === "created" ? `${p.totalWeeks} weeks planned`
    : `Week ${getCurrentWeek(p)} of ${p.totalWeeks}`;
  const archivedOn = (ymd: string | undefined) => {
    const d = ymd ? fromYMD(ymd) : null;
    return d ? `Archived ${formatStoredDate(d)}` : "Archived";
  };

  const sectionHeading = (label: string) => (
    <Text style={[styles.sectionHeading, { color: t.tp }]}>{label}</Text>
  );

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
        refreshControl={scope === "programs" ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCT} colors={[ACCT]} progressViewOffset={insets.top} />
        )}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={[styles.screenTitle, { color: t.tp }]}>Archive</Text>
          <View style={styles.headerSide} />
        </View>
        <Text style={[styles.caption, { color: t.ts }]} numberOfLines={1}>{caption}</Text>
        {scope !== "programs" && <OfflineBanner />}

        {!loaded ? (
          <View style={styles.loading}><ActivityIndicator color={ACCT} /></View>
        ) : failed && isEmpty ? (
          <NeuCard dark={isDark} radius={16}>
            <Text style={[styles.message, { color: t.ts }]}>
              {"Couldn't load the archive. Pull down to try again."}
            </Text>
          </NeuCard>
        ) : isEmpty ? (
          <NeuCard dark={isDark} radius={20}>
            <View style={styles.emptyInner}>
              <View style={[styles.emptyIcon, { backgroundColor: `${ACCT}1F` }]}>
                <ArchiveIcon size={28} color={ACCT} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.tp }]}>Nothing archived</Text>
              <Text style={[styles.emptyBody, { color: t.ts }]}>{emptyBody}</Text>
            </View>
          </NeuCard>
        ) : scope === "programs" ? (
          archivedMine.map(p => {
            const status = programStatus(p, t.ts);
            return (
              <ArchiveCard
                key={p.id}
                name={p.name}
                meta={`${archivedOn(p.archivedAt)} · ${weekText(p)}`}
                pill={
                  <View style={[styles.pill, { backgroundColor: `${status.color}22` }]}>
                    <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
                  </View>
                }
                cycle={p.cyclePattern}
                isDark={isDark}
                onSummary={() => setSummaryOf(p)}
                onRestore={() => restoreMine(p)}
                onDelete={() => deleteMine(p)}
              />
            );
          })
        ) : (
          <>
            {sectionHeading(scope === "group" ? "Group Programs" : "Programs Sent")}
            {batches.map(b => {
              const all = b.accepted === b.total;
              // The program as it was sent, the copy its recipients got.
              const snap = b.head.programSnapshot;
              const sentTo = scope === "group"
                ? `${memberName(b.head.senderId)} · Sent ${fmtAgo(b.head.sentAtISO)} · ${b.total} member${b.total === 1 ? "" : "s"}`
                : b.head.groupId
                  ? `Sent ${fmtAgo(b.head.sentAtISO)} · ${groupNameFor(b.head.groupId)} · ${b.total} member${b.total === 1 ? "" : "s"}`
                  : `Sent ${fmtAgo(b.head.sentAtISO)} · ${b.total} client${b.total === 1 ? "" : "s"}`;
              return (
                <ArchiveCard
                  key={b.key}
                  name={b.head.programName}
                  meta={sentTo}
                  pill={
                    <View style={[styles.pill, { backgroundColor: all ? `${ACCT}22` : t.div }]}>
                      <Text style={[styles.pillText, { color: all ? ACCT : t.ts }]}>
                        {all ? "Accepted" : `${b.accepted}/${b.total} accepted`}
                      </Text>
                    </View>
                  }
                  cycle={snap?.cyclePattern ?? []}
                  isDark={isDark}
                  onSummary={snap ? () => setSummaryOf(snap) : undefined}
                  onRestore={() => restoreBatch(b)}
                  onDelete={() => deleteBatch(b)}
                  needsConnection
                />
              );
            })}
          </>
        )}
      </ScrollView>

      {summaryOf ? (
        <ProgramSummarySheet
          visible
          snapshot={summaryOf}
          isDark={isDark}
          onClose={() => setSummaryOf(null)}
        />
      ) : null}
    </FadeScreen>
  );
}

const styles = StyleSheet.create({
  topGradient:   { position: "absolute", left: 0, right: 0, zIndex: 5 },
  // The title row is the back button's row: it starts at the same top and is
  // as tall, so the title is centred on it (components/BackButton.tsx).
  header:        { flexDirection: "row", alignItems: "center", height: BACK_SIZE },
  headerSide:    { width: BACK_SIZE + 4 },
  screenTitle:   { flex: 1, fontFamily: FontFamily.bold, fontSize: 20, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center" },
  caption:       { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: "center", marginTop: 2, marginBottom: 20 },
  loading:       { paddingVertical: 40, alignItems: "center" },
  message:       { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 19, padding: 18, textAlign: "center" },
  sectionHeading:{ fontFamily: FontFamily.bold, fontSize: 18, marginTop: 6, marginBottom: 12 },
  emptyInner:    { padding: 28, alignItems: "center", gap: 10 },
  emptyIcon:     { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:    { fontFamily: FontFamily.bold, fontSize: 17 },
  emptyBody:     { fontFamily: FontFamily.regular, fontSize: 13, textAlign: "center", lineHeight: 18 },
  cardInner:     { ...CARD_INNER },
  cardTop:       { ...CARD_TOP },
  cardName:      { ...CARD_TITLE },
  cardMeta:      { ...CARD_META },
  pill:          { ...CARD_PILL },
  pillText:      { ...CARD_PILL_TEXT },
  cycleGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 12 },
  cycleChip:     { alignItems: "center", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, minWidth: 56 },
  cycleChipText: { fontFamily: FontFamily.bold, fontSize: 9, textAlign: "center" },
  actionRow:     { flexDirection: "row", gap: 10, paddingTop: 14 },
  // A trainer page's row buttons (components/trainer/ProgramRow.tsx), so a
  // card's buttons match the page it was archived from: Summary the card's
  // button (cardButton, no shadow), Restore and Delete their own glows. The
  // padding is only the label's least room before it wraps, since three
  // buttons share the width and centre their labels: on a 375pt-wide phone a
  // button is 96pt, Restore with its arrow 73 of it, and 14 a side would
  // leave it 68 and wrap it.
  actionBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 8, minHeight: 38, borderRadius: PILL_RADIUS },
  actionText:    { fontFamily: FontFamily.bold, fontSize: 14, color: "#fff" },
});
