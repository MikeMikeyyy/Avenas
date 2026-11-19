// The phone's speech recognition (expo-speech-recognition), for voice typing
// in every chat (hooks/useDictation.ts). RN-only.
//
// The package loads its native part as soon as it's imported, and Expo Go
// doesn't have it, so importing it there would crash the app. It's loaded
// here on first use instead, and where it isn't there (Expo Go, a build from
// before voice typing) this is null and the mic button doesn't show.

type SpeechModule = typeof import("expo-speech-recognition")["ExpoSpeechRecognitionModule"];

let loaded: SpeechModule | null | undefined;

/** The speech recognizer, or null where this build has none. */
export function speechRecognizer(): SpeechModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use, see above
    loaded = (require("expo-speech-recognition") as typeof import("expo-speech-recognition")).ExpoSpeechRecognitionModule;
  } catch {
    loaded = null;
  }
  return loaded;
}
