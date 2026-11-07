// Trainer review screen for a SentProgram (gym user → trainer).
// Shows the trainer's working copy and "Send Back"s it. Edits made in the
// builder are a draft until then (migration 0034): Send Back, and Send Update
// after it, are what hand the client that version with an Accept on it, with
// the trainer's comments on it (SendBackSheet, migration 0054).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scrollEndPadding } from "../../../constants/floatingBars";
import { useFloatingBarsReach, usePinnedLift } from "../../../hooks/useFloatingBars";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "../../../components/MaskedView";
import Svg, { Path } from "react-native-svg";

import BounceButton from "../../../components/BounceButton";
import OfflineBanner from "../../../components/OfflineBanner";
import { alertOffline, useOffline } from "../../../contexts/ConnectivityContext";
import ProgramHeaderCard from "../../../components/ProgramHeaderCard";
import ProgramSnapshotView from "../../../components/ProgramSnapshotView";
import ProgramActionFabs from "../../../components/ProgramActionFabs";
import ProgramSummarySheet from "../../../components/ProgramSummarySheet";
import SendBackSheet, { type SendBackMode } from "../../../components/trainer/SendBackSheet";
import { TrainerNote } from "../../../components/trainer/ReviewNote";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT } from "../../../constants/theme";
import { darkGlow, PILL_RADIUS, PILL_SHADOW } from "../../../constants/buttons";
import { useTheme } from "../../../contexts/ThemeContext";
import { useAuth } from "../../../contexts/AuthContext";
import { loadGroupReviewPrograms, loadSentPrograms, returnReview, type SentProgram } from "../../../utils/trainerStore";
import { peekPTHub } from "../../../utils/trainerHub";
import { peekGroupPage } from "../../../utils/groupPage";
import { firstName } from "../../../utils/trainerLists";
import { alertMessage } from "../../../utils/errors";
import BackButton, { BACK_TOP, BACK_SIZE } from "../../../components/BackButton";

// Matches the floating dismiss button used in workout.tsx / log-workout.tsx /
// new-program.tsx — single canonical SVG kept local to each screen.
function KeyboardDismissIcon({ color }: { color: string }) {
  return (
    <Svg width={34} height={29} viewBox="0 0 26 22" fill="none">
      <Path d="M2 2.5C2 1.67 2.67 1 3.5 1h19c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5h-19C2.67 14 2 13.33 2 12.5v-10z" stroke={color} strokeWidth="1.4"/>
      <Path d="M6 5.5h1.2M10 5.5h1.2M14 5.5h1.2M18 5.5h1.2M6 8.5h1.2M10 8.5h1.2M14 8.5h1.2M18 8.5h1.2M8 11.5h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <Path d="M13 16v4M10.5 18.5l2.5 2.5 2.5-2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

export default function ReviewScreen() {
  const { id, groupId } = useLocalSearchParams<{ id: string; groupId?: string }>();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  // How far up the workout bar reaches, so the page scrolls clear of it.
  const barsReach = useFloatingBarsReach();
  // Open in Builder and Summary stand on the workout bar while it shows.
  const { lift: pinnedLift, liftStyle: pinnedStyle } = usePinnedLift(insets.bottom + 24);
  const offline = useOffline();
  // The account the Trainer tab's saved copy belongs to (utils/pageSnapshot.ts).
  const { userId } = useAuth();

  const [entry, setEntry] = useState<SentProgram | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      // A GROUP review is a single row addressed to the group's owner, so a
      // trainer who isn't that owner would never find it in their own inbox.
      // The group page passes groupId, which routes the lookup through the
      // group's queue instead — where every coach of the group can see it.
      const list = groupId ? await loadGroupReviewPrograms(groupId) : await loadSentPrograms();
      if (cancelled) return;
      const found = list.find(s => s.id === id) ?? null;
      setEntry(found);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [id, groupId]));

  /** Send Back and Send Update are the same step (returnReview): the client
   *  gets this version, with the comments, and an Accept for it. Both open
   *  SendBackSheet, which says which it is (it was an "Are you sure?" alert,
   *  with nowhere to say anything: user request, 2026-11-06). */
  const [sendMode, setSendMode] = useState<SendBackMode | null>(null);
  // Whether the sheet is up, and whether what it sent has gone, so the page
  // leaves once the sheet has slid away. Sent with the sheet already swiped
  // down, the page leaves at once.
  const sheetUp = useRef(false);
  const sent = useRef(false);
  const openSend = useCallback((mode: SendBackMode) => {
    sheetUp.current = true;
    sent.current = false;
    setSendMode(mode);
  }, []);
  const sendBack = useCallback(async (comments: string): Promise<boolean> => {
    if (!entry) return false;
    try {
      await returnReview(entry.id, comments);
    } catch (e) {
      Alert.alert("Couldn't send it", alertMessage(e, "Check your connection and try again."));
      return false;
    }
    if (sheetUp.current) sent.current = true;
    else router.back();
    return true;
  }, [entry, router]);
  const sheetClosed = useCallback(() => {
    sheetUp.current = false;
    setSendMode(null);
    // Back to the list once it's gone, as Send Back always went.
    if (sent.current) router.back();
  }, [router]);

  const handleSendUpdate = useCallback(() => openSend("update"), [openSend]);
  // Comments alone, once it's back, with no new edits to send (user request,
  // 2026-11-06): they keep the version they have, and their accept.
  const handleSendComment = useCallback(() => openSend("comment"), [openSend]);

  /**
   * Who it goes back to, in words. A group review came from a member of the
   * group, who may be nobody's client ("Send Back to Client" was wrong for
   * them). A 1:1 one is from a client, or from a fellow trainer coached by me
   * who asked from their My Trainers (user decision, 2026-10-29): named, when
   * they aren't my client too. Read off the Trainer tab's saved copy. `name`
   * is for the comments box ("Comments for Cara"): their first name, from
   * that copy or the group page's, wherever it's known.
   */
  const asker = useMemo(() => {
    if (entry?.groupId) {
      const member = peekGroupPage(userId ?? "", entry.groupId)?.members.find(m => m.id === entry.senderId);
      return { the: "the member", The: "The member", To: "Member", name: member ? firstName(member.name) : "the member" };
    }
    const hub = peekPTHub(userId ?? "");
    const client = entry?.senderId ? hub?.clients.find(c => c.id === entry.senderId) : undefined;
    const trainer = !client && entry?.senderId ? hub?.trainers?.find(tr => tr.id === entry.senderId) : undefined;
    if (trainer) {
      const name = firstName(trainer.name);
      return { the: name, The: name, To: name, name };
    }
    return { the: "the client", The: "The client", To: "Client", name: client ? firstName(client.name) : "the client" };
  }, [entry, userId]);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  }

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Text style={{ fontFamily: FontFamily.semibold, fontSize: 16, color: t.tp }}>Review not found</Text>
        <BounceButton style={{ marginTop: 16 }} onPress={() => router.back()}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCT }}>
            <Text style={{ color: "#fff", fontFamily: FontFamily.bold }}>Back</Text>
          </View>
        </BounceButton>
      </View>
    );
  }

  const snap = entry.programSnapshot;
  const isReturned = entry.status === "returned";
  // Edits in the builder not yet sent: before Send Back, what decides whether
  // it goes back with changes or as it came (reviewed, comments alone); after
  // it, a "Send Update to Client" CTA so they can push the new version. A
  // cloud review knows exactly (it has a draft); a local one compares times.
  const hasEdits = entry.unsentEdits ?? (
    !!entry.lastEditedAtISO &&
    (!entry.returnedAtISO || entry.lastEditedAtISO > entry.returnedAtISO)
  );
  const hasUnsentEdits = isReturned && hasEdits;
  // Where the version they were sent stands: still theirs to accept, or taken
  // (seen, for one sent back with no changes: Got it).
  const returnedLine = entry.noChanges
    ? (entry.appliedAtISO
      ? `Sent back with no changes. ${asker.The} has seen it.`
      : `Sent back with no changes. Waiting for ${asker.the} to see it.`)
    : (entry.appliedAtISO
      ? `Sent back. ${asker.The} has accepted your changes.`
      : `Sent back. Waiting for ${asker.the} to accept it.`);
  // What they're reading with it: the comments sent with the version they
  // have (what Send Update's box opens with).
  const sentComments = isReturned && entry.trainerComments ? (
    <View style={styles.sentComments}>
      <TrainerNote label="YOUR COMMENTS" note={entry.trainerComments} />
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <BackButton />

      <View pointerEvents="none" style={[styles.topGradient, { top: 0, height: insets.top + 10 }]}>
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <LinearGradient
            colors={["black", "rgba(0, 0, 0, 0.8)", "rgba(0, 0, 0, 0.65)", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.25)", "rgba(0, 0, 0, 0.1)", "transparent"]}
            locations={[0, 0.5, 0.6, 0.7, 0.75, 0.85, 0.9, 0.95, 1]}
            style={StyleSheet.absoluteFill}
          />
        }>
          <BlurView intensity={40} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        </MaskedView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + BACK_TOP, paddingBottom: scrollEndPadding(insets.bottom + 120 + pinnedLift, barsReach) }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.titleRow}>
            <View style={{ width: 66 }} />
            <Text style={[styles.screenTitle, { color: t.tp }]} numberOfLines={1}>REVIEW PROGRAM</Text>
            <View style={{ width: 66 }} />
          </View>
          <OfflineBanner />
          <ProgramHeaderCard name={snap?.name ?? entry.programName} snapshot={snap} isDark={isDark} />

          {/* Send Back sits UNDER THE TITLE, where you land, not at the foot of
              the page. It used to follow the whole program, and once this
              screen started showing every day in full — sets, reps, weights —
              it ended up a long scroll down, below the floating Builder and
              Summary pills, and read as missing. The decision is "is this ready
              to go back?", and that button belongs next to the name of the
              thing you're deciding about. */}
          {!isReturned ? (
            // With nothing changed it goes back as it came, reviewed, with the
            // comments: an answer that isn't removing it.
            <BounceButton style={{ marginTop: 14 }} onPress={() => openSend(hasEdits ? "back" : "back-unchanged")} needsConnection accessibilityLabel={`Send back to ${asker.the}`}>
              <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
                <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                <Text style={styles.sendBtnText}>{`Send Back to ${asker.To}`}</Text>
              </View>
            </BounceButton>
          ) : hasUnsentEdits ? (
            <>
              <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
                <Ionicons name="checkmark-circle" size={18} color={ACCT} />
                <Text style={[styles.returnedText, { color: ACCT }]}>{returnedLine}</Text>
              </View>
              {sentComments}
              <BounceButton style={{ marginTop: 12 }} onPress={handleSendUpdate} needsConnection accessibilityLabel={`Send your latest edits to ${asker.the}`}>
                <View style={[styles.sendBtn, { backgroundColor: ACCT, shadowColor: ACCT }, darkGlow(styles.sendBtn, isDark)]}>
                  <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                  <Text style={styles.sendBtnText}>{`Send Update to ${asker.To}`}</Text>
                </View>
              </BounceButton>
            </>
          ) : (
            <>
              <View style={[styles.returnedBanner, { backgroundColor: `${ACCT}1a` }]}>
                <Ionicons name="checkmark-circle" size={18} color={ACCT} />
                <Text style={[styles.returnedText, { color: ACCT }]}>{returnedLine}</Text>
              </View>
              {sentComments}
              {/* Nothing new to send but words: the page's white button, the
                  green one being for changes. */}
              <BounceButton style={{ marginTop: 12 }} onPress={handleSendComment} needsConnection accessibilityLabel={`Send ${asker.the} a comment`}>
                <View style={[styles.sendBtn, PILL_SHADOW, { backgroundColor: t.ctrl }]}>
                  <Ionicons name="chatbubble-outline" size={16} color={t.tp} />
                  <Text style={[styles.sendBtnText, { color: t.tp }]}>{`Send a Comment to ${asker.To}`}</Text>
                </View>
              </BounceButton>
            </>
          )}

          {/* The program itself, in the same detail as viewing a program that
              was sent: a trainer deciding whether this needs changing is being
              asked about the sets, reps, weights and rest, so those have to be
              on the screen where the decision is made. */}
          {snap && (
            <View style={{ marginTop: 18 }}>
              <ProgramSnapshotView snapshot={snap} isDark={isDark} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Builder + Summary. The builder carries the groupId: a group review is
          addressed to the group's owner and can't be found in a coach's own
          inbox, so without it the builder opens blank and saves into nothing.
          Both hide while the keyboard is up, like every other floating control
          in the app. */}
      {snap && kbHeight === 0 && (
        <ProgramActionFabs
          bottom={insets.bottom + 24}
          liftStyle={pinnedStyle}
          isDark={isDark}
          // The builder saves this review to the server as you go, so with no
          // signal it says why rather than opening onto edits it can't keep.
          onOpenBuilder={offline ? alertOffline : () => router.navigate({
            pathname: "/new-program",
            params: groupId ? { reviewId: entry.id, groupId } : { reviewId: entry.id },
          })}
          onOpenSummary={() => setSummaryOpen(true)}
        />
      )}

      {summaryOpen && snap && (
        <ProgramSummarySheet
          visible
          snapshot={snap}
          isDark={isDark}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* Mounted only while open, and never with the Summary up: one RN
          Modal at a time. */}
      {sendMode && !summaryOpen && (
        <SendBackSheet
          review={entry}
          mode={sendMode}
          askerName={asker.name}
          onSend={sendBack}
          onClose={sheetClosed}
        />
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  topGradient:    { position: "absolute", left: 0, right: 0, zIndex: 5 },
  iconBtn:        { width: 40, height: 40, borderRadius: 20, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  titleRow:       { flexDirection: "row", alignItems: "center", height: BACK_SIZE, marginBottom: 24 },
  screenTitle:    { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", flex: 1 },
  // The name card is components/ProgramHeaderCard.tsx, and the cycle strip and
  // the day-by-day breakdown are components/ProgramSnapshotView.tsx; each owns
  // its styles, shared with /program-view.
  // Opening the builder moved out of this card and onto the floating pair at
  // the bottom (components/ProgramActionFabs.tsx), beside Summary.
  sendBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: PILL_RADIUS, paddingVertical: 14, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  sendBtnText:    { fontFamily: FontFamily.bold, fontSize: 15, color: "#fff" },
  returnedBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, padding: 14, borderRadius: 14 },
  returnedText:   { fontFamily: FontFamily.semibold, fontSize: 13 },
  sentComments:   { marginTop: 12 },
  kbFloatBtn:     { minWidth: 52, height: 42, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 4 },
});
