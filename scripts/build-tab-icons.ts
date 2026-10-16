// Renders the tab bar's icons (constants/tabIcons.ts) into the images Apple's
// tab bar shows on iOS 26 and later (app/(tabs)/_layout.tsx), which can't draw
// an SVG: black on clear at 1x, 2x and 3x, in assets/images/tab-icons/. Only
// their alpha counts: iOS paints them in the bar's own colours ("template"
// images), as it does its own icons. Run it after changing a drawing:
//
//   npx tsx scripts/build-tab-icons.ts

import { TAB_ICONS, TAB_ICON_SIZE, type IconDrawing } from "../constants/tabIcons";

// The app has no Node type definitions (see ./harness/db.ts), so the little of
// Node and sharp used here is typed here.
declare const __dirname: string;
declare const Buffer: { from(text: string): Uint8Array };
/* eslint-disable @typescript-eslint/no-require-imports -- an `import` would need @types/node, see above */
const { mkdirSync } = require("node:fs") as {
  mkdirSync(dir: string, options: { recursive: boolean }): void;
};
const path = require("node:path") as {
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
};
type Sharp = { png(): Sharp; toFile(file: string): Promise<unknown> };
const sharp = require("sharp") as (input: Uint8Array) => Sharp;
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, "assets/images/tab-icons");
const SCALES = [1, 2, 3];

/** The drawing as an SVG `px` pixels square, in black. */
function svgOf(drawing: IconDrawing, px: number): string {
  const { stroke } = drawing;
  const paint = stroke
    ? `fill="none" stroke="black" stroke-width="${stroke.width}"` +
      (stroke.round ? ` stroke-linecap="round" stroke-linejoin="round"` : "")
    : `fill="black"`;
  const shapes = [
    ...drawing.paths.map((d) => `<path d="${d}" ${paint}/>`),
    ...(drawing.circles ?? []).map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" ${paint}/>`),
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${drawing.viewBox}">` +
    shapes.join("") +
    `</svg>`
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [route, drawing] of Object.entries(TAB_ICONS)) {
    for (const scale of SCALES) {
      const file = path.resolve(OUT, `${route}${scale === 1 ? "" : `@${scale}x`}.png`);
      await sharp(Buffer.from(svgOf(drawing, TAB_ICON_SIZE * scale))).png().toFile(file);
      console.log(path.relative(ROOT, file));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
