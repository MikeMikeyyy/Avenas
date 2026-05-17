// Typed AsyncStorage wrapper.
//
// Use these helpers in NEW code paths (e.g. the future Program Page) to
// guarantee a consistent error-handling surface:
//   - getJSON: returns the fallback on missing key, malformed JSON, or IO error
//   - setJSON: serializes and writes; surfaces dev-only warnings on failure
//   - removeKey: deletes a key; dev-only warning on failure
//
// All failures emit `if (__DEV__) console.warn("[avenas]", ...)` and never
// surface as user-facing Alerts (that would change behavior).
//
// Note: existing screens (workout / home / journal / new-program) still call
// AsyncStorage directly with their own bespoke ordering and rollback logic.
// Do NOT retrofit them in bulk — each call site has subtle invariants.

import AsyncStorage from "@react-native-async-storage/async-storage";

function warn(key: string, op: string, err: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn("[avenas]", op, key, err);
  }
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (parseErr) {
      warn(key, "getJSON.parse", parseErr);
      return fallback;
    }
  } catch (err) {
    warn(key, "getJSON", err);
    return fallback;
  }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    warn(key, "setJSON", err);
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    warn(key, "removeKey", err);
  }
}
