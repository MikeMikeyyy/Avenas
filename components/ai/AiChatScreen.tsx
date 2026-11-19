// The AI's chat screen (docs/ARCHITECTURE.md "AI"), shared by Insights (Home,
// app/insights.tsx) and the Program Builder (My Programs,
// app/program-builder.tsx): each passes its AiChatConfig (its name and mark,
// what it says, its suggestions, which feature it asks and where its chats
// are kept). Their chats are apart: one never lists the other's.
//
// Presented as a modal (app/_layout.tsx), so it slides up and swipes down to
// close. Layout, top to bottom:
//   - grabber (top middle), the mark and name (top left), Chats and New chat
//     (top right)
//   - before the first question, once per account (shared by both): what the
//     AI is sent and who gets it, to agree to (Apple 5.1.2(i);
//     utils/agreements.ts acceptAiTerms). The server checks it too (0061).
//   - the conversation: the assistant's words as plain text from the top, the
//     person's in a bubble. A reply writes itself out as it comes (streamed,
//     lib/ai.ts streamAi); until its first words a line that changes every
//     couple of seconds says it's working. What went wrong shows below, with
//     Try again when it might work. Closing mid-answer stops it (the server
//     stops the model too).
//   - suggested questions, then the field to write in
//
// The Program Builder interviews (feature "interview"); once its reply ends
// with READY_MARK the chat is ready and Build my program shows. Building
// (feature "program") turns the conversation into a program, made a draft for
// the builder (utils/aiProgram.ts) and opened there to check and save: nothing
// the AI makes is saved unseen. A draft of the person's own already in the
// builder is never written over without asking.
//
// Each question goes with the conversation's last messages and a summary of
// the person's training, built fresh from this phone (utils/aiContext.ts).
// Chats are kept as a list on this phone per account (utils/aiChatStore.ts,
// never synced): it opens on the latest; New chat starts another (nothing is
// lost, so nothing is asked); Chats lists them newest first, titled by their
// first message, to open one or delete it (or all). Deleting is final.

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  View, Text, StyleSheet, TextInput, Platform, ScrollView, ActivityIndicator, Alert, Keyboard,
  type ScrollViewInstance,
} from "react-native";
import Animated, { useAnimatedStyle, interpolate, Extrapolation } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import BounceButton from "../BounceButton";
import GlassButton from "../GlassButton";
import { BACK_SIZE } from "../BackButton";
import DeleteCircleButton from "../DeleteCircleButton";
import SheetPill from "../SheetPill";
import ChatBubble from "../trainer/ChatBubble";
import SimpleSheet from "../trainer/SimpleSheet";
import MicButton from "../MicButton";
import ChatHistoryIcon from "../icons/ChatHistoryIcon";
import NewChatIcon from "../icons/NewChatIcon";
import SendIcon from "../icons/SendIcon";
import { APP_DARK, APP_LIGHT, FontFamily, ACCT, ON_FILL, accentTextColor, washOver } from "../../constants/theme";
import { darkGlow, pill, PILL_H_SM } from "../../constants/buttons";
import type { ChatMessage } from "../../constants/chat";
import { CUSTOM_KEY, type CustomExercise } from "../../constants/exercises";
import {
  NEW_PROGRAM_DRAFT_KEY, PROGRAMS_KEY, WORKOUT_DAY_OVERRIDE_KEY, WORKOUT_HISTORY_KEY,
  type CompletedWorkout, type SavedProgram, type WorkoutMap,
} from "../../constants/programs";
import { useAuth } from "../../contexts/AuthContext";
import { useDictation } from "../../hooks/useDictation";
import { useTheme } from "../../contexts/ThemeContext";
import { useUnit } from "../../contexts/UnitContext";
import {
  AI_LIMITS, AiError, aiErrorMessage, aiRetryable, streamAi,
  type AiErrorCode, type StreamHandlers, type Turn,
} from "../../lib/ai";
import { splitReady } from "../../supabase/functions/ai/request";
import { acceptAiTerms, hasAcceptedAiTerms, syncAgreements } from "../../utils/agreements";
import { buildTrainingSummary } from "../../utils/aiContext";
import { blankChat, cleanReply, dropChat, newChatId, putChat, turnsFor, withMessages, type AiChat } from "../../utils/aiChat";
import { loadChats, saveChats } from "../../utils/aiChatStore";
import { builtMessage, draftFromGenerated, listOf, newExercisesIn, parseGeneratedProgram } from "../../utils/aiProgram";
import { addCustomExercises } from "../../utils/customExerciseStore";
import { relativeDayLabel } from "../../utils/dates";
import { getJSON, setJSON } from "../../utils/storage";
import type { DayOverride } from "../../utils/workout";

export type AiChatConfig = {
  /** insights: questions about training (Home). builder: makes a program (My Programs). */
  kind: "insights" | "builder";
  /** "Insights", "Program Builder": the top bar, the agreement, the alerts. */
  name: string;
  /** The assistant's mark (components/icons). */
  Mark: ComponentType<{ size?: number; color?: string }>;
  /** What it opens with (the app's words, not the model's). */
  intro: string;
  suggestions: readonly string[];
  /** Suggestions only before the first message (answers to the intro). */
  suggestOnlyAtStart?: boolean;
  placeholder: string;
  /** What the screen says while a reply hasn't started, in turn. */
  waitingLines: readonly string[];
  /** Where this assistant's chats are kept (constants/ai.ts). */
  chatsKey: string;
};

const WAITING_STEP_MS = 2200;

/** What the screen says while a program is built, in turn. */
const BUILDING_LINES = ["Choosing your exercises…", "Laying out your week…", "Setting your sets and reps…", "Checking it over…"];

/** What the program builder is told when Build my program is tapped (not shown). */
const BUILD_REQUEST = "Build my program now.";

function makeMessage(mine: boolean, text: string): ChatMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, mine, text, sentAtISO: new Date().toISOString() };
}

/** The person's training as the AI is sent it, read fresh for each question. */
async function trainingSummary(isKg: boolean): Promise<string> {
  const [history, programs, customs, override] = await Promise.all([
    getJSON<CompletedWorkout[]>(WORKOUT_HISTORY_KEY, []),
    getJSON<SavedProgram[]>(PROGRAMS_KEY, []),
    getJSON<CustomExercise[]>(CUSTOM_KEY, []),
    getJSON<DayOverride | null>(WORKOUT_DAY_OVERRIDE_KEY, null),
  ]);
  return buildTrainingSummary({
    history: Array.isArray(history) ? history : [],
    programs: Array.isArray(programs) ? programs : [],
    customs: Array.isArray(customs) ? customs : [],
    override: override && typeof override === "object" ? override : null,
    isKg,
  });
}

/** Whether the builder holds a new program of the person's own, unsaved. */
async function hasOwnDraft(): Promise<boolean> {
  const draft = await getJSON<{ name?: string; editId?: string; workouts?: WorkoutMap } | null>(NEW_PROGRAM_DRAFT_KEY, null);
  if (!draft || typeof draft !== "object" || draft.editId) return false;
  return !!draft.name?.trim() || Object.values(draft.workouts ?? {}).some(list => Array.isArray(list) && list.length > 0);
}

/** An Alert as a yes or no. */
function confirm(title: string, message: string, yes: string, no = "Cancel", destructive = true): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: no, style: "cancel", onPress: () => resolve(false) },
      { text: yes, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** What went wrong, and what Try again does (ask again, or build again). */
type Failure = { code: AiErrorCode; retryable: boolean; action: "ask" | "build"; message?: string };

export default function AiChatScreen({ config }: { config: AiChatConfig }) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const owner = userId ?? "";
  const { isKg } = useUnit();
  const builder = config.kind === "builder";
  const { Mark } = config;

  /** Null while this account's answer is read off the phone. */
  const [agreed, setAgreed] = useState<boolean | null>(null);
  /** This account's chats, newest first (the one open may not be among them
   *  yet: a new chat joins with its first message). */
  const [chats, setChats] = useState<AiChat[]>([]);
  const chatsRef = useRef<AiChat[]>([]);
  const [currentId, setCurrentId] = useState<string>(() => newChatId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const current = chats.find(c => c.id === currentId);
  const messages = current?.messages ?? [];
  const [input, setInput] = useState("");
  /** A reply, or a program, is on its way. */
  const [pending, setPending] = useState<"reply" | "build" | null>(null);
  /** The reply so far while it's written; null when none is coming. */
  const [draft, setDraft] = useState<string | null>(null);
  const [waitingLine, setWaitingLine] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const requestRef = useRef<AbortController | null>(null);
  // Voice typing into the box (components/MicButton.tsx).
  const dictation = useDictation(input, setInput, AI_LIMITS.userChars);

  // Closing the screen stops a reply being written (and the server stops the model).
  useEffect(() => () => requestRef.current?.abort(), []);

  // The waiting line moves on every couple of seconds until the first words.
  const writing = !!draft;
  const lines = pending === "build" ? BUILDING_LINES : config.waitingLines;
  useEffect(() => {
    if (!pending || writing) return;
    setWaitingLine(0);
    const timer = setInterval(() => setWaitingLine(i => i + 1), WAITING_STEP_MS);
    return () => clearInterval(timer);
  }, [pending, writing]);

  useEffect(() => {
    let cancelled = false;
    setAgreed(null);
    setLoaded(false);
    if (!owner) return;
    void Promise.all([hasAcceptedAiTerms(owner), loadChats(owner, config.chatsKey)]).then(([ok, list]) => {
      if (cancelled) return;
      setAgreed(ok);
      chatsRef.current = list;
      setChats(list);
      // Opens on the latest chat.
      setCurrentId(list[0]?.id ?? newChatId());
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [owner, config.chatsKey]);

  /** Keeps the list as `next` and puts it on screen. */
  const keep = useCallback((next: AiChat[]) => {
    chatsRef.current = next;
    setChats(next);
    if (owner) saveChats(owner, next, config.chatsKey);
  }, [owner, config.chatsKey]);

  /** Chat `chatId` now holds `next` (and `patch`), kept and on screen. */
  const commit = useCallback((chatId: string, next: ChatMessage[], patch: Partial<AiChat> = {}) => {
    const chat = chatsRef.current.find(c => c.id === chatId) ?? blankChat(chatId);
    keep(putChat(chatsRef.current, withMessages({ ...chat, ...patch }, next)));
  }, [keep]);

  /** Streams `turns` to the AI, sending this account's agreement first if the
   *  server hasn't got it (given with no signal) and asking once more. */
  const stream = useCallback(async (turns: Turn[], on: StreamHandlers, signal: AbortSignal, feature: "chat" | "interview" | "program") => {
    const context = await trainingSummary(isKg);
    try {
      await streamAi(turns, context, on, signal, feature);
    } catch (e) {
      if (!(e instanceof AiError && e.code === "ai_consent")) throw e;
      await syncAgreements(owner);
      await streamAi(turns, context, on, signal, feature);
    }
  }, [isKg, owner]);

  /** What failed, shown under the conversation (nothing when the screen was closed). */
  const failed = useCallback((e: unknown, request: AbortController, action: Failure["action"], message?: string) => {
    if (request.signal.aborted) return;
    const code: AiErrorCode = e instanceof AiError ? e.code : "ai_unavailable";
    if (code === "ai_consent") setAgreed(false);
    setFailure({ code, retryable: aiRetryable(code), action, message: code === "ai_unavailable" ? message : undefined });
  }, []);

  /** Asks for a reply to `thread` in chat `chatId` (its last message is the
   *  person's), and shows it as it's written. */
  const ask = useCallback(async (chatId: string, thread: ChatMessage[]) => {
    const request = new AbortController();
    requestRef.current = request;
    setPending("reply");
    setFailure(null);
    setDraft(null);
    let text = "";
    const on: StreamHandlers = {
      onText: (more: string) => { text += more; setDraft(text); },
      onReset: () => { text = ""; setDraft(null); },
    };
    try {
      await stream(turnsFor(thread), on, request.signal, builder ? "interview" : "chat");
      const { text: reply, ready } = builder ? splitReady(cleanReply(text)) : { text: cleanReply(text), ready: false };
      if (!reply) throw new AiError("ai_unavailable");
      commit(chatId, [...thread, makeMessage(false, reply)], builder ? { ready } : {});
    } catch (e) {
      failed(e, request, "ask");
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      setDraft(null);
      setPending(null);
    }
  }, [builder, commit, failed, stream]);

  /** Program Builder: builds the program the conversation describes, makes it
   *  the builder's draft and opens it there to check and save. */
  const build = useCallback(async () => {
    const chatId = currentId;
    const thread = messages;
    if (pending || !thread.length) return;
    if (await hasOwnDraft()) {
      const replace = await confirm(
        "Replace your unsaved program?",
        "The builder has a new program you haven't saved yet. Building this one puts it in its place.",
        "Replace",
      );
      if (!replace) return;
    }
    const request = new AbortController();
    requestRef.current = request;
    setPending("build");
    setFailure(null);
    setDraft(null);
    let json = "";
    try {
      // The interview (all of it the server takes), then the ask to build.
      const turns: Turn[] = [...turnsFor(thread).slice(-(AI_LIMITS.turns - 1)), { role: "user", text: BUILD_REQUEST }];
      await stream(turns, { onText: more => { json += more; }, onReset: () => { json = ""; } }, request.signal, "program");
      const generated = parseGeneratedProgram(json);
      if (!generated) throw new AiError("ai_unavailable");
      const stored = await getJSON<CustomExercise[]>(CUSTOM_KEY, []);
      const customs = Array.isArray(stored) ? stored : [];
      // New custom exercises the person agreed to in the chat: made only on a
      // last yes here, so the AI never adds one to their list on its own.
      const { create, noRoom } = newExercisesIn(generated, customs);
      let added: CustomExercise[] = [];
      let notMade: string[] = create.map(c => c.name);
      if (create.length) {
        const one = create.length === 1;
        const names = listOf(create.map(c => c.name));
        const yes = await confirm(
          one ? `Add ${create[0].name} to your exercises?` : `Add ${create.length} new exercises?`,
          `${names} ${one ? "isn't" : "aren't"} in your exercise list. The program uses ${one ? "it" : "them"}, so ${one ? "it's" : "they're"} added as ${one ? "a custom exercise" : "custom exercises"} you can edit or delete any time.`,
          "Add",
          "Leave out",
          false,
        );
        if (yes) {
          const result = await addCustomExercises(create);
          added = result.added;
          notMade = result.skipped;
        }
      }
      const made = draftFromGenerated(generated, [...customs, ...added], { notCreated: [...notMade, ...noRoom] });
      if (!made) throw new AiError("ai_unavailable");
      await setJSON(NEW_PROGRAM_DRAFT_KEY, made.draft);
      commit(chatId, [...thread, makeMessage(false, builtMessage(made.draft.name, {
        added: added.map(c => c.name),
        noRoom,
        dropped: made.dropped,
        swapped: made.swapped,
        minutes: made.minutes,
        sessionLimit: made.sessionLimit,
        trimmed: made.trimmed,
        howToRun: made.howToRun,
      }))], { ready: false, built: { name: made.draft.name, atISO: new Date().toISOString() } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/new-program");
    } catch (e) {
      failed(e, request, "build", "The program couldn't be built just now. Try again in a moment.");
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      setPending(null);
    }
  }, [commit, currentId, failed, messages, pending, router, stream]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    // The keyboard goes down so the reply has the screen (user ask, 2026-11-13).
    Keyboard.dismiss();
    // Nothing still being heard is typed into the cleared box.
    dictation.cancel();
    setInput("");
    const next = [...messages, makeMessage(true, trimmed)];
    commit(currentId, next, builder ? { ready: false } : {});
    void ask(currentId, next);
  }, [ask, builder, commit, currentId, dictation, messages, pending]);

  const retry = useCallback(() => {
    if (pending) return;
    if (failure?.action === "build") { void build(); return; }
    if (!messages.length || !messages[messages.length - 1].mine) return;
    void ask(currentId, messages);
  }, [ask, build, currentId, failure, messages, pending]);

  const agree = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Asked again because the server didn't have it: the question that was
    // waiting goes once the agreement is sent.
    const waiting = failure?.code === "ai_consent" && messages.length > 0 && messages[messages.length - 1].mine;
    const chatId = currentId;
    setAgreed(true);
    setFailure(null);
    void acceptAiTerms(owner).then(() => { if (waiting) void ask(chatId, messages); });
  }, [ask, currentId, failure, messages, owner]);

  /** A new, empty chat. The one before stays in the list. */
  const newChat = useCallback(() => {
    setCurrentId(newChatId());
    setFailure(null);
  }, []);

  const openChat = useCallback((id: string) => {
    setCurrentId(id);
    setFailure(null);
  }, []);

  const deleteChat = useCallback((chat: AiChat) => {
    Alert.alert("Delete this chat?", "It's gone for good once it's deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const next = dropChat(chatsRef.current, chat.id);
          keep(next);
          if (chat.id === currentId) { setCurrentId(next[0]?.id ?? newChatId()); setFailure(null); }
          if (!next.length) setHistoryOpen(false);
        },
      },
    ]);
  }, [currentId, keep]);

  const deleteAll = useCallback(() => {
    Alert.alert("Delete all chats?", `Every ${config.name} chat on this phone goes for good.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: () => {
          keep([]);
          setCurrentId(newChatId());
          setFailure(null);
          setHistoryOpen(false);
        },
      },
    ]);
  }, [config.name, keep]);

  const canSend = input.trim().length > 0 && !pending;

  // Input bar tracks the live keyboard frame (interactive drag included).
  const { height, progress } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: -height.value }));
  const barStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [insets.bottom + 8, 6], Extrapolation.CLAMP),
  }));

  const topBar = (
    <View style={styles.topBar}>
      <View style={styles.grabberWrap} pointerEvents="none">
        <View style={[styles.grabber, { backgroundColor: t.div }]} />
      </View>
      <View style={[styles.brand, { backgroundColor: t.ctrl }]}>
        <View style={styles.brandBadge}>
          <Mark size={13} color={ON_FILL} />
        </View>
        <Text style={[styles.brandText, { color: accentTextColor(isDark) }]}>{config.name}</Text>
      </View>
      {/* Not while a reply is coming: it belongs to the chat that's open. */}
      {agreed && !pending ? (
        <View style={styles.topActions}>
          {chats.length > 0 ? (
            <GlassButton onPress={() => setHistoryOpen(true)} size={BACK_SIZE} accessibilityLabel="Your chats">
              <ChatHistoryIcon size={20} color={t.tp} />
            </GlassButton>
          ) : null}
          {messages.length > 0 ? (
            <GlassButton onPress={newChat} size={BACK_SIZE} accessibilityLabel="Start a new chat">
              <NewChatIcon size={20} color={t.tp} />
            </GlassButton>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  // Every chat, newest first: open one, or delete it or all of them.
  const historySheet = (
    <SimpleSheet
      visible={historyOpen}
      onClose={() => setHistoryOpen(false)}
      footer={(close) => (
        <View style={styles.sheetFooter}>
          <SheetPill
            label="New chat"
            variant="primary"
            icon={c => <NewChatIcon size={18} color={c} />}
            onPress={() => { newChat(); close(); }}
          />
          <SheetPill label="Delete all chats" variant="danger" onPress={deleteAll} />
        </View>
      )}
    >
      {(close) => (
        <View>
          <Text style={[styles.sheetTitle, { color: t.tp }]}>Chats</Text>
          {chats.map((chat, i) => (
            <View
              key={chat.id}
              style={[styles.chatRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sheetLine }]}
            >
              <BounceButton
                style={styles.chatOpen}
                onPress={() => { openChat(chat.id); close(); }}
                accessibilityRole="button"
                accessibilityLabel={`Open chat: ${chat.title || "Untitled"}`}
              >
                <Text
                  style={[styles.chatTitle, { color: chat.id === currentId ? accentTextColor(isDark) : t.tp }]}
                  numberOfLines={1}
                >
                  {chat.title || "Untitled"}
                </Text>
                {/* A program's name wraps, never cut short. */}
                <Text style={[styles.chatDate, { color: t.ts }]}>
                  {relativeDayLabel(new Date(chat.updatedAtISO))}{chat.built ? `, built "${chat.built.name}"` : ""}
                </Text>
              </BounceButton>
              <DeleteCircleButton onPress={() => deleteChat(chat)} accessibilityLabel={`Delete chat: ${chat.title || "Untitled"}`} />
            </View>
          ))}
        </View>
      )}
    </SimpleSheet>
  );

  // Signed out: the AI needs an account.
  if (!owner) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {topBar}
        <View style={styles.centered}>
          <Text style={[styles.body, { color: t.ts }]}>{aiErrorMessage("unauthorized")}</Text>
        </View>
      </View>
    );
  }

  // This account's agreement and chats are still being read.
  if (agreed === null || !loaded) {
    return <View style={[styles.root, { backgroundColor: t.bg }]}>{topBar}</View>;
  }

  if (!agreed) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {topBar}
        <ScrollView contentContainerStyle={styles.agreeScroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.agreeIcon, { backgroundColor: washOver(t.bg, ACCT, 0.16) }]}>
            <Mark size={30} color={accentTextColor(isDark)} />
          </View>
          <Text style={[styles.title, { color: t.tp }]}>Before you ask</Text>
          <Text style={[styles.body, { color: t.ts }]}>
            {config.name} is powered by Claude, an AI made by Anthropic. To answer you, Avenas sends Anthropic your questions and a summary of your training: your program, the workouts you've logged and the exercises in them.
          </Text>
          <Text style={[styles.body, { color: t.ts }]}>
            It never sends your name, email, photos, journal or messages.
          </Text>
          <Text style={[styles.body, { color: t.ts }]}>
            The AI can get things wrong, and it isn't medical advice. For pain, an injury or a health condition, check with a doctor or physio.
          </Text>
          <Text
            style={[styles.link, { color: accentTextColor(isDark) }]}
            onPress={() => router.navigate("/privacy-policy")}
            accessibilityRole="link"
          >
            Privacy Policy
          </Text>
        </ScrollView>
        <View style={[styles.agreeActions, { paddingBottom: insets.bottom + 12 }]}>
          <BounceButton onPress={agree} accessibilityLabel="Agree to sharing your training with the AI">
            <View style={[styles.primaryBtn, { shadowColor: ACCT }, darkGlow(styles.primaryBtn, isDark)]}>
              <Text style={[styles.primaryText, { color: ON_FILL }]}>I agree</Text>
            </View>
          </BounceButton>
          <BounceButton style={styles.secondaryWrap} onPress={() => router.back()} accessibilityLabel="Not now">
            <View style={[styles.secondaryBtn, { backgroundColor: t.quietCtrl }]}>
              <Text style={[styles.secondaryText, { color: t.tp }]}>Not now</Text>
            </View>
          </BounceButton>
        </View>
      </View>
    );
  }

  const lastIsMine = messages.length > 0 && messages[messages.length - 1].mine;
  // The interview knows enough: offer to build (again, after a change).
  const canBuild = builder && !!current?.ready && !pending && !lastIsMine;
  const showSuggestions = !config.suggestOnlyAtStart || messages.length === 0;
  const shown = (text: string) => cleanReply(builder ? splitReady(text).text : text);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {topBar}

      <Animated.View style={[{ flex: 1 }, liftStyle]}>
        {/* Conversation: flows from the top. Assistant = plain text, person = bubble. */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <View style={styles.aiBlock}>
            <Text style={[styles.aiText, { color: t.tp }]}>{config.intro}</Text>
          </View>
          {messages.map((m) =>
            m.mine ? (
              <ChatBubble key={m.id} msg={m} />
            ) : (
              <View key={m.id} style={styles.aiBlock}>
                <Text style={[styles.aiText, { color: t.tp }]} selectable>{m.text}</Text>
              </View>
            )
          )}
          {pending === "reply" && draft ? (
            <View style={styles.aiBlock}>
              <Text style={[styles.aiText, { color: t.tp }]}>{shown(draft)}</Text>
            </View>
          ) : pending ? (
            <View style={styles.thinking} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={t.ts} />
              <Text style={[styles.thinkingText, { color: t.ts }]}>{lines[waitingLine % lines.length]}</Text>
            </View>
          ) : null}
          {canBuild ? (
            <BounceButton style={styles.buildWrap} needsConnection onPress={() => { void build(); }} accessibilityLabel="Build my program">
              <View style={[styles.primaryBtn, styles.buildBtn, { shadowColor: ACCT }, darkGlow(styles.primaryBtn, isDark)]}>
                <Mark size={18} color={ON_FILL} />
                <Text style={[styles.primaryText, { color: ON_FILL }]}>Build my program</Text>
              </View>
            </BounceButton>
          ) : null}
          {!pending && (failure || lastIsMine) ? (
            <View style={styles.failure} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={18} color={t.ts} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.failureText, { color: t.ts }]}>
                  {failure ? failure.message ?? aiErrorMessage(failure.code) : "This question didn't get an answer."}
                </Text>
                {(failure ? failure.retryable && (failure.action === "build" || lastIsMine) : lastIsMine) ? (
                  <Text style={[styles.retry, { color: accentTextColor(isDark) }]} onPress={retry} accessibilityRole="button">
                    Try again
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Suggested questions: one horizontal line. alignItems:center on the
            content + flexGrow:0 on the ScrollView keep the chips at their
            natural size (a horizontal ScrollView otherwise stretches them). */}
        {showSuggestions ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.suggestScroll}
            contentContainerStyle={styles.suggestRow}
          >
            {config.suggestions.map((s) => (
              <BounceButton
                key={s}
                needsConnection
                onPress={() => send(s)}
                style={[styles.suggestChip, { backgroundColor: t.ctrl }]}
                accessibilityRole="button"
                accessibilityLabel={s}
              >
                <Text style={[styles.suggestText, { color: t.tp }]}>{s}</Text>
              </BounceButton>
            ))}
          </ScrollView>
        ) : null}

        {/* Input bar: barStyle collapses the bottom inset as the keyboard rises */}
        <Animated.View style={[styles.inputBar, { borderTopColor: t.div }, barStyle]}>
          <View style={[styles.inputBox, { backgroundColor: t.ctrl, borderColor: t.div }]}>
            <TextInput
              style={[styles.input, { color: t.tp }]}
              value={input}
              onChangeText={setInput}
              placeholder={dictation.listening ? "Listening…" : config.placeholder}
              placeholderTextColor={t.ts}
              maxLength={AI_LIMITS.userChars}
              multiline
            />
          </View>
          <MicButton dictation={dictation} size={44} />
          <BounceButton
            needsConnection
            onPress={canSend ? () => send(input) : undefined}
            accessibilityLabel="Send message"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
          >
            <View style={[styles.sendBtn, { opacity: canSend ? 1 : 0.4 }, darkGlow(styles.sendBtn, isDark)]}>
              <SendIcon size={18} color={ON_FILL} />
            </View>
          </BounceButton>
        </Animated.View>
      </Animated.View>
      {historySheet}
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  topBar:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 26, paddingBottom: 12, minHeight: 26 + 12 + BACK_SIZE },
  topActions:  { flexDirection: "row", alignItems: "center", gap: 10 },
  grabberWrap: { position: "absolute", top: 8, left: 0, right: 0, alignItems: "center" },
  grabber:     { width: 40, height: 5, borderRadius: 3 },
  brand:       { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 5, paddingRight: 12, paddingVertical: 5, borderRadius: 999 },
  brandBadge:  { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: ACCT,
                 shadowColor: ACCT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 5 },
  brandText:   { fontFamily: FontFamily.semibold, fontSize: 14 },

  sheetTitle:  { fontFamily: FontFamily.bold, fontSize: 18, textAlign: "center", paddingHorizontal: 24, paddingBottom: 10 },
  chatRow:     { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20, paddingVertical: 12 },
  chatOpen:    { flex: 1, gap: 2 },
  chatTitle:   { fontFamily: FontFamily.semibold, fontSize: 15 },
  chatDate:    { fontFamily: FontFamily.regular, fontSize: 13 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },

  centered:    { flex: 1, justifyContent: "center", paddingHorizontal: 32 },

  agreeScroll:  { alignItems: "center", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 12 },
  agreeIcon:    { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title:        { fontFamily: FontFamily.bold, fontSize: 22, textAlign: "center" },
  body:         { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  link:         { fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center", paddingVertical: 6 },
  agreeActions: { paddingHorizontal: 24, paddingTop: 12 },
  primaryBtn:   { ...pill(), backgroundColor: ACCT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10 },
  primaryText:  { fontFamily: FontFamily.bold, fontSize: 15 },
  secondaryWrap: { marginTop: 10 },
  secondaryBtn: { ...pill(PILL_H_SM) },
  secondaryText: { fontFamily: FontFamily.bold, fontSize: 14 },
  buildWrap:    { marginTop: 6, marginBottom: 10 },
  buildBtn:     { flexDirection: "row", gap: 8 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 },
  aiBlock:       { width: "100%", marginVertical: 8 },
  aiText:        { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  thinking:      { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 },
  thinkingText:  { fontFamily: FontFamily.regular, fontSize: 14 },
  failure:       { flexDirection: "row", gap: 8, marginVertical: 10 },
  failureText:   { fontFamily: FontFamily.regular, fontSize: 14, lineHeight: 20 },
  retry:         { fontFamily: FontFamily.semibold, fontSize: 14, marginTop: 6, alignSelf: "flex-start" },

  suggestScroll: { flexGrow: 0 },
  suggestRow:    { alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  suggestChip:   { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  suggestText:   { fontFamily: FontFamily.semibold, fontSize: 13 },

  inputBar:   { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  inputBox:   { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: Platform.OS === "ios" ? 10 : 4, maxHeight: 120, justifyContent: "center" },
  input:      { fontFamily: FontFamily.regular, fontSize: 15, maxHeight: 100 },
  sendBtn:    { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: ACCT, shadowColor: ACCT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
});
