// scripts/verify-photo-frame.ts
//
// Move and Scale's geometry (utils/photoFrame.ts): where a framed photo can go,
// and that the crop is what the frame showed: square, inside the photo, the
// edge the photo was pushed to, and the same however big the photo is decoded
// to cut it.
//
// Run: npx tsx scripts/verify-photo-frame.ts

import {
  MAX_ZOOM, coverSize, cropRect, decodeBounds, frameCrop, panLimit, rubberBand,
} from "../utils/photoFrame";

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${what}\n    expected ${b}\n    actual   ${a}`);
}
function ok(cond: boolean, what: string) { eq(cond, true, what); }

const FRAME = 360;
// A phone photo held sideways (4:3), as the picker reports it: turned upright.
const W = 4032;
const H = 3024;
const cover = coverSize(W, H, FRAME);
const rect = (k: number, tx: number, ty: number, w = W, h = H) => cropRect(frameCrop(cover, k, tx, ty), w, h);

// ── Filling the frame ──
eq(cover, { w: 480, h: 360 }, "its short side fills the frame");
eq(panLimit(cover, FRAME, 1), { x: 60, y: 0 }, "unzoomed, it moves sideways only");
eq(panLimit(cover, FRAME, 2), { x: 300, y: 180 }, "zoomed 2x, both ways");
eq(coverSize(3024, 4032, FRAME), { w: 360, h: 480 }, "held upright, it's the width that fills");
eq(panLimit(coverSize(1000, 1000, FRAME), FRAME, 1), { x: 0, y: 0 }, "a square photo can't move till zoomed");

// ── The crop is what the frame shows ──
eq(rect(1, 0, 0), { originX: 504, originY: 0, width: 3024, height: 3024 }, "centred: the middle square");
eq(rect(1, 60, 0).originX, 0, "pushed right as far as it goes: the photo's left edge");
eq(rect(1, -60, 0).originX, W - H, "pushed left: its right edge");
eq(rect(2, 0, 0), { originX: 1260, originY: 756, width: 1512, height: 1512 }, "zoomed 2x: the middle half");
eq(rect(2, 300, 180), { originX: 0, originY: 0, width: 1512, height: 1512 }, "zoomed, pushed to a corner: that corner");
eq(rect(2, -300, -180), { originX: W - 1512, originY: H - 1512, width: 1512, height: 1512 }, "and the other");
eq(cropRect(frameCrop(coverSize(3024, 4032, FRAME), 1, 0, -60), 3024, 4032).originY, 1008, "upright, pushed up: its foot");

// Anywhere the limits allow, the crop is square and inside the photo without
// being pushed back in (more than rounding).
let inside = true;
for (const k of [1, 1.3, 2, 2.75, MAX_ZOOM]) {
  const lim = panLimit(cover, FRAME, k);
  for (const fx of [-1, -0.5, 0, 0.5, 1]) {
    for (const fy of [-1, -0.37, 0, 0.6, 1]) {
      const crop = frameCrop(cover, k, fx * lim.x, fy * lim.y);
      const r = cropRect(crop, W, H);
      const x = crop.cx * W - r.width / 2;
      const y = crop.cy * H - r.height / 2;
      if (r.width !== r.height || r.originX < 0 || r.originY < 0 || r.originX + r.width > W || r.originY + r.height > H
        || x < -1 || y < -1 || x + r.width > W + 1 || y + r.height > H + 1) inside = false;
    }
  }
}
ok(inside, "anywhere it can be moved to, the crop is square and inside the photo");

// ── Decoded smaller to cut it ──
const centred = frameCrop(cover, 1, 0, 0);
eq(decodeBounds(W, H, centred, 640), { maxWidth: 854, maxHeight: 640 }, "a 640px photo needs it no bigger than 854 x 640");
eq(decodeBounds(W, H, frameCrop(cover, 4, 0, 0), 1080), undefined, "zoomed in 4x for 1080px, it's needed whole");
eq(decodeBounds(500, 400, centred, 640), undefined, "a photo smaller than the result is never shrunk first");
eq(decodeBounds(0, 0, centred, 640), undefined, "a photo the picker couldn't size is decoded whole");
const pushed = frameCrop(cover, 1.5, -100, 60);
const big = cropRect(pushed, W, H);
const small = cropRect(pushed, 1008, 756);
ok(Math.abs(big.originX / W - small.originX / 1008) < 0.002 && Math.abs(big.originY / H - small.originY / 756) < 0.002
  && Math.abs(big.width / H - small.width / 756) < 0.002, "decoded a quarter the size, the crop is the same part of the photo");
const tight = cropRect(centred, 853, 639);
ok(tight.width === tight.height && tight.originX + tight.width <= 853 && tight.originY + tight.height <= 639,
  "decoded a pixel short of the bounds, the crop still fits");

// ── Past the limits ──
eq(rubberBand(50, 0, 100, 360), 50, "inside the limits, it follows the finger");
const past = [110, 150, 300, 1000].map(v => rubberBand(v, 0, 100, 360));
ok(past.every((v, i) => v > 100 && v < 100 + 360 && (i === 0 || v > past[i - 1])), "past one, it gives less and less, never past its room");
ok(past[0] - 100 < 10, "and less than the finger moved");
ok(Math.abs(rubberBand(-50, 0, 100, 360) + (rubberBand(150, 0, 100, 360) - 100)) < 1e-9, "the same either way");
ok(rubberBand(0.05, 1, MAX_ZOOM, 1) > 0.5, "a pinch to nothing still leaves the photo there");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
