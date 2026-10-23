// Every "add a photo / video" in the app opens the library through here: a
// group's photo, your profile photo, and a custom exercise's photo and video.
//
// Three things made those taps unreliable (user report, 2026-10-13: "sometimes
// it does not work"), and each is handled once, here:
//
//   1. No permission request first. The system picker runs outside the app
//      and needs no photo-library access, on iOS (11+ for the editing picker,
//      14+ for the plain one) and Android alike. Asking anyway put a system
//      prompt in front of the picker, which then had to open while that prompt
//      was still closing and sometimes didn't, and anyone who had once tapped
//      "Don't Allow" could never pick a photo at all.
//   2. One picker at a time. A second tap while the first was still opening
//      made the native side refuse the second, an error nobody caught, and
//      sometimes left neither on screen. A tap while one is open is ignored.
//   3. Opened from an Alert ("Change Photo"), the picker could be presented
//      while the alert was still going away, and iOS drops a presentation made
//      mid-dismissal without a word. `afterAlert` waits for it to finish.

import * as ImagePicker from "expo-image-picker";

/** Long enough for an alert's dismissal to finish before the picker opens.
 *  The same wait serves any sheet opened from an Alert button (an import's
 *  exercise picker, app/import-review.tsx). */
export const ALERT_SETTLE_MS = 350;

let picking = false;

/**
 * Open the photo library and return what was picked, or null when nothing was
 * (cancelled, or a picker already open). Throws only when the picker itself
 * fails, which the screen reports.
 */
export async function pickFromLibrary(
  options: ImagePicker.ImagePickerOptions,
  { afterAlert = false }: { afterAlert?: boolean } = {},
): Promise<ImagePicker.ImagePickerAsset | null> {
  if (picking) return null;
  picking = true;
  try {
    if (afterAlert) await new Promise(r => setTimeout(r, ALERT_SETTLE_MS));
    const result = await ImagePicker.launchImageLibraryAsync(options);
    return result.canceled ? null : result.assets?.[0] ?? null;
  } finally {
    picking = false;
  }
}

/** A square crop, for a profile or group photo. */
export const SQUARE_PHOTO: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
};
