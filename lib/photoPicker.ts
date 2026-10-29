// Every "add a photo / video" in the app opens the library through here: a
// group's photo, your profile photo, and a custom exercise's photo and video.
//
// Three things made those taps unreliable (user report, 2026-10-13: "sometimes
// it does not work"), and each is handled once, here:
//
//   1. No permission request first. The system picker runs outside the app
//      and needs no photo-library access, on iOS 14+ and Android alike. Asking
//      anyway put a system prompt in front of the picker, which then had to
//      open while that prompt was still closing and sometimes didn't, and
//      anyone who had once tapped "Don't Allow" could never pick a photo at all.
//   2. One picker at a time. A second tap while the first was still opening
//      made the native side refuse the second, an error nobody caught, and
//      sometimes left neither on screen. A tap while one is open is ignored.
//   3. Opened from an Alert ("Change Photo"), the picker could be presented
//      while the alert was still going away, and iOS drops a presentation made
//      mid-dismissal without a word. `afterAlert` waits for it to finish.
//
// And a square photo is framed by the app, never by the picker (user report,
// 2026-10-29: the group photo's picker took 3 to 5 seconds to come up). Asked
// for a crop (`allowsEditing`), expo-image-picker opens iOS's old picker,
// UIImagePickerController, the only one with a crop step, and that's the slow
// one. Without it, it opens Apple's current picker, which is up at once, and
// `pickSquarePhoto` frames what comes back on the app's own Move and Scale
// (components/PhotoFramer.tsx), then crops it here.

import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { cropRect, decodeBounds, type FrameCrop } from "../utils/photoFrame";

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

/** The shape a photo is framed in, and how many pixels a side it's kept at. */
export type SquarePhotoKind = { shape: "circle" | "square"; px: number };

/** A profile or group photo: a circle, never drawn much past 100pt, so 640px
 *  is sharp on a 3x screen and small for everyone who loads it. */
export const AVATAR_PHOTO: SquarePhotoKind = { shape: "circle", px: 640 };

/** A custom exercise's photo: a rounded square, up to 340pt wide on its page
 *  (app/exercise-summary.tsx), so 1080px. */
export const EXERCISE_PHOTO: SquarePhotoKind = { shape: "square", px: 1080 };

/** A framed photo: a JPEG in the app's cache, to upload or copy somewhere it's kept. */
export type SquarePhoto = { uri: string; mimeType: string; width: number; height: number };

/** The picker at its quickest: Apple's current one, handing back the photo's
 *  own file, with no editing and nothing re-encoded. The crop encodes it once. */
const PLAIN_PHOTO: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  quality: 1,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
};

/** How hard the framed JPEG is compressed. */
const JPEG_QUALITY = 0.8;

/**
 * Pick a photo and frame it square: the library, then Move and Scale, then the
 * crop. Null when either is cancelled. Throws when the picker or the crop
 * fails, which the screen reports.
 */
export async function pickSquarePhoto(
  kind: SquarePhotoKind,
  { afterAlert = false }: { afterAlert?: boolean } = {},
): Promise<SquarePhoto | null> {
  const asset = await pickFromLibrary(PLAIN_PHOTO, { afterAlert });
  if (!asset) return null;
  return new Promise<SquarePhoto | null>((resolve, reject) => {
    // Nothing can ask while one is up (it covers the screen), but a second
    // would otherwise strand the first's promise.
    if (frameRequest) { resolve(null); return; }
    setFrameRequest({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      kind,
      done: photo => { setFrameRequest(null); resolve(photo); },
      fail: e => { setFrameRequest(null); reject(e); },
    });
  });
}

/** A photo waiting on Move and Scale (components/PhotoFramer.tsx draws it). */
export type FrameRequest = {
  uri: string;
  /** As displayed (EXIF orientation applied); 0 when the picker couldn't tell. */
  width: number;
  height: number;
  kind: SquarePhotoKind;
  /** Chosen (the framed photo), or cancelled (null). */
  done: (photo: SquarePhoto | null) => void;
  fail: (e: unknown) => void;
};

let frameRequest: FrameRequest | null = null;
const frameListeners = new Set<() => void>();

function setFrameRequest(next: FrameRequest | null) {
  frameRequest = next;
  frameListeners.forEach(l => l());
}

export function getFrameRequest(): FrameRequest | null {
  return frameRequest;
}

export function subscribeFrameRequest(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => { frameListeners.delete(listener); };
}

/**
 * Crop a picked photo to what the frame held and shrink it to `px` a side.
 * It's decoded only as big as that needs (decodeBounds), and expo-image-
 * manipulator turns it upright first, so the crop is in the pixels as shown.
 */
export async function renderSquarePhoto(
  uri: string, width: number, height: number, crop: FrameCrop, px: number,
): Promise<SquarePhoto> {
  const decoded = await ImageManipulator.manipulate(uri, decodeBounds(width, height, crop, px)).renderAsync();
  try {
    const rect = cropRect(crop, decoded.width, decoded.height);
    const side = Math.min(rect.width, px);
    const framed = await ImageManipulator.manipulate(decoded).crop(rect).resize({ width: side, height: side }).renderAsync();
    try {
      const saved = await framed.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
      return { uri: saved.uri, mimeType: "image/jpeg", width: saved.width, height: saved.height };
    } finally {
      framed.release();
    }
  } finally {
    decoded.release();
  }
}
