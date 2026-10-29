// The geometry of framing a photo square (components/PhotoFramer.tsx): how big
// the photo sits behind the frame, how far it can be moved and zoomed, and which
// part of it the frame holds when it's chosen. No React or native code here, so
// scripts/verify-photo-frame.ts checks it on its own.
//
// Sizes are the photo's as displayed, EXIF orientation applied: the picker
// reports them that way, expo-image draws it that way, and expo-image-manipulator
// turns the pixels upright before it crops.

/** Furthest the photo zooms in, against just filling the frame. */
export const MAX_ZOOM = 4;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The photo drawn just filling the frame: its short side the frame's side. */
export function coverSize(width: number, height: number, frame: number): { w: number; h: number } {
  const s = frame / Math.min(width, height);
  return { w: width * s, h: height * s };
}

/** How far the photo's centre may sit from the frame's, either way, at zoom
 *  `k`: as far as still keeps the frame covered. */
export function panLimit(cover: { w: number; h: number }, frame: number, k: number): { x: number; y: number } {
  return { x: Math.max(0, (cover.w * k - frame) / 2), y: Math.max(0, (cover.h * k - frame) / 2) };
}

/** Past [lo, hi] a drag gives less and less, as iOS's own scrolling does, so
 *  the edge is felt rather than hit. It never gives more than `room`. */
export function rubberBand(v: number, lo: number, hi: number, room: number): number {
  const give = (over: number) => (1 - 1 / ((over * 0.55) / room + 1)) * room;
  if (v < lo) return lo - give(lo - v);
  if (v > hi) return hi + give(v - hi);
  return v;
}

/** What the frame holds: its centre as a share of the photo's width and
 *  height, and its side as a share of the photo's short side. A share, so it
 *  holds however big the photo is decoded to crop it. */
export type FrameCrop = { cx: number; cy: number; side: number };

/** The frame's hold on a photo drawn `cover` at zoom `k`, its centre moved
 *  (tx, ty) from the frame's. */
export function frameCrop(cover: { w: number; h: number }, k: number, tx: number, ty: number): FrameCrop {
  return { cx: 0.5 - tx / (cover.w * k), cy: 0.5 - ty / (cover.h * k), side: 1 / k };
}

/** The crop in pixels of the photo decoded `width` x `height`: whole pixels,
 *  square, and inside the photo (expo-image-manipulator would otherwise cut a
 *  crop off at the photo's edge, and it would come back a rectangle). */
export function cropRect(crop: FrameCrop, width: number, height: number) {
  const side = clamp(Math.round(crop.side * Math.min(width, height)), 1, Math.min(width, height));
  return {
    originX: clamp(Math.round(crop.cx * width - side / 2), 0, width - side),
    originY: clamp(Math.round(crop.cy * height - side / 2), 0, height - side),
    width: side,
    height: side,
  };
}

/** How small the photo can be decoded (expo-image-manipulator's maxWidth and
 *  maxHeight) and still give a crop `px` pixels a side: a 24MP photo framed for
 *  a 640px profile photo needn't be decoded whole. Undefined when it's needed
 *  whole (a small photo, or one zoomed in that far). */
export function decodeBounds(
  width: number, height: number, crop: FrameCrop, px: number,
): { maxWidth: number; maxHeight: number } | undefined {
  const f = px / (crop.side * Math.min(width, height));
  if (!(f < 1)) return undefined;
  return { maxWidth: Math.ceil(width * f), maxHeight: Math.ceil(height * f) };
}
