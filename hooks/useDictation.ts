// Voice typing for a chat's text box (user ask, 2026-11-14: a mic in every
// chat, the AI's and people's; components/MicButton.tsx draws it). Tap to
// listen: what's said is typed into the box as it's heard, after anything
// already typed, and the person sends it as any message (or edits it first).
// Listening stops on a second tap, after a few seconds of silence, or after a
// minute; the box's send cancels it (`cancel`), so nothing heard after is
// typed into the cleared box.
//
// The phone's own speech recognition (lib/speech.ts): on the iPhone itself
// where it can (requiresOnDeviceRecognition), so it works offline and the
// recording never leaves the phone; else Apple's speech service, which needs
// a connection. Never Avenas' server or the AI. `available` is false where
// it can't work: no recognizer in this build (Expo Go), none for the phone or
// its language, or offline without on-device recognition.
//
// Only one screen listens at a time: the recognizer's events are the whole
// app's, so each one is taken only by the hook that started it (`listener`).

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking } from "react-native";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

import { useOffline } from "../contexts/ConnectivityContext";
import { speechRecognizer } from "../lib/speech";
import { absorb, dictatedText, loudness, NOTHING_HEARD, phoneLanguage, type Heard } from "../utils/dictation";

/** Silence that ends listening, and the longest it listens. */
const SILENCE_MS = 3000;
const LONGEST_MS = 60_000;

export type Dictation = {
  /** Voice typing can work here: show the mic. */
  available: boolean;
  listening: boolean;
  /** How loud they're speaking, 0 to 1, for the mic's rings (UI thread). */
  level: SharedValue<number>;
  /** Start listening, or stop and keep what was heard. */
  toggle: () => void;
  /** Stop and drop anything still coming (the message was sent). */
  cancel: () => void;
};

/** Which hook's listening the recognizer's events belong to (see above). */
let listener = 0;
let nextHook = 1;

function alertNoAccess(): void {
  Alert.alert(
    "Voice typing is off",
    "To speak a message, allow Avenas to use the microphone and speech recognition in Settings.",
    [{ text: "Not now", style: "cancel" }, { text: "Open Settings", onPress: () => { void Linking.openSettings(); } }],
  );
}

/** Voice typing into a box holding `text`, written with `setText`, kept to
 *  `max` characters. */
export function useDictation(text: string, setText: (text: string) => void, max = Infinity): Dictation {
  const speech = speechRecognizer();
  const offline = useOffline();
  const me = useRef(0);
  if (!me.current) me.current = nextHook++;

  const [onDevice] = useState(() => {
    try { return !!speech?.supportsOnDeviceRecognition(); } catch { return false; }
  });
  const [recognizes] = useState(() => {
    try { return !!speech?.isRecognitionAvailable(); } catch { return false; }
  });
  const available = !!speech && recognizes && (onDevice || !offline);

  const [listening, setListening] = useState(false);
  const level = useSharedValue(0);
  const before = useRef("");
  const heard = useRef<Heard>(NOTHING_HEARD);
  const usingOnDevice = useRef(onDevice);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longest = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest of what the screen holds, for the listeners set up once.
  const latest = useRef({ text, setText, max });
  latest.current = { text, setText, max };

  const clearTimers = useCallback(() => {
    if (silence.current) clearTimeout(silence.current);
    if (longest.current) clearTimeout(longest.current);
    silence.current = null;
    longest.current = null;
  }, []);

  /** Listening is over: what was heard stays in the box. */
  const finished = useCallback(() => {
    clearTimers();
    if (listener === me.current) listener = 0;
    setListening(false);
    level.value = withTiming(0, { duration: 200 });
  }, [clearTimers, level]);

  const stop = useCallback(() => {
    if (listener !== me.current) return;
    try { speech?.stop(); } catch { finished(); }
  }, [finished, speech]);

  const begin = useCallback((deviceOnly: boolean) => {
    if (!speech) return;
    usingOnDevice.current = deviceOnly;
    speech.start({
      lang: phoneLanguage(),
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: deviceOnly,
      addsPunctuation: true,
      iosTaskHint: "dictation",
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
    if (longest.current) clearTimeout(longest.current);
    longest.current = setTimeout(stop, LONGEST_MS);
  }, [speech, stop]);

  const start = useCallback(async () => {
    if (!speech || listener) return;
    const access = await speech.requestPermissionsAsync().catch(() => null);
    if (!access?.granted) { alertNoAccess(); return; }
    listener = me.current;
    before.current = latest.current.text;
    heard.current = NOTHING_HEARD;
    setListening(true);
    try {
      begin(onDevice);
    } catch {
      finished();
    }
  }, [begin, finished, onDevice, speech]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else void start();
  }, [listening, start, stop]);

  const cancel = useCallback(() => {
    if (listener !== me.current) return;
    listener = 0;
    try { speech?.abort(); } catch { /* already stopped */ }
    finished();
  }, [finished, speech]);

  useEffect(() => {
    if (!speech) return;
    const mine = () => listener === me.current;
    const subscriptions = [
      speech.addListener("result", event => {
        if (!mine()) return;
        heard.current = absorb(heard.current, event.results[0]?.transcript ?? "", event.isFinal);
        latest.current.setText(dictatedText(before.current, heard.current, latest.current.max));
        // Quiet for a while after the last words: done.
        if (silence.current) clearTimeout(silence.current);
        silence.current = setTimeout(stop, SILENCE_MS);
      }),
      speech.addListener("volumechange", event => {
        if (mine()) level.value = withTiming(loudness(event.value), { duration: 100 });
      }),
      speech.addListener("error", event => {
        if (!mine()) return;
        // This language isn't on the phone for offline use: Apple's service
        // instead, when there's a connection.
        if (event.error === "language-not-supported" && usingOnDevice.current) {
          try { begin(false); return; } catch { /* below */ }
        }
        if (event.error === "not-allowed") alertNoAccess();
        finished();
      }),
      speech.addListener("end", () => { if (mine()) finished(); }),
    ];
    return () => subscriptions.forEach(s => s.remove());
  }, [begin, finished, level, speech, stop]);

  // Leaving the app, or the screen, ends it.
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state !== "active") stop(); });
    return () => {
      sub.remove();
      if (listener === me.current) {
        listener = 0;
        try { speech?.abort(); } catch { /* already stopped */ }
      }
      clearTimers();
    };
  }, [clearTimers, speech, stop]);

  return { available, listening, level, toggle, cancel };
}
