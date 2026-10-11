// Build the bundled exercise library.
//
// The catalogue is scripts/exercise-library.json, kept by hand: each exercise's
// name, muscle group, equipment, steps, picture, and the names it used to have.
// Pictures come from two places:
//   - { "library": "<id>" }  Open Exercise Illustrations (CC0): its frames
//     (start and end, or a single hold), resized here. Source folder:
//     scripts/exercise-source/open-exercise-illustrations (git-ignored; see
//     scripts/exercise-source/README.md).
//   - { "photo": "<file>" }  a photo kept from the old library, in
//     scripts/exercise-photos/.
// "hidden": true marks a retired exercise: never offered in the picker, kept so
// workouts and programs that used it still resolve its muscles and steps.
//
// Renaming an exercise: change its "name" and add the old name to its
// "formerNames" (keep every earlier one too). Anything logged under the old
// name then counts as the new one everywhere (utils/exerciseNames.ts), and the
// app renames it in saved programs, favourites and drafts on the next launch
// (utils/exerciseRenameMigration.ts). A former name can never also be a live
// exercise's name: every new session under it would be counted as the renamed
// exercise. The build refuses that, and the other mistakes below.
//
// Writes:
//   assets/exercises/<id>-thumb.webp, <id>-<frame>.webp   (illustrations)
//   assets/exercises/<id>.jpg                              (kept photos)
//   assets/exerciseImages.ts
//   constants/exerciseData.ts
//
// Run from the project root:  node scripts/build-exercises.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGUE = path.join(ROOT, "scripts/exercise-library.json");
const PHOTOS = path.join(ROOT, "scripts/exercise-photos");
const LIBRARY = path.join(ROOT, "scripts/exercise-source/open-exercise-illustrations");
const OUT_IMAGES = path.join(ROOT, "assets/exercises");
const OUT_IMAGE_MAP = path.join(ROOT, "assets/exerciseImages.ts");
const OUT_DATA = path.join(ROOT, "constants/exerciseData.ts");

const GROUPS = new Set(["Chest", "Back", "Shoulders", "Legs", "Arms", "Core"]);
// Frames for the exercise screen: sharp on a phone, small in the bundle (the
// dark studio backgrounds compress well). Thumbnails for lists are their own
// small square files, so a scrolling list never decodes a full frame.
const FRAME_WIDTH = 720;
const THUMB_SIZE = 192;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const norm = (s) => String(s || "").trim().toLowerCase();

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
  const libJson = path.join(LIBRARY, "exercises.json");
  const hasLibrary = fs.existsSync(libJson);
  if (!hasLibrary) fail(`Illustration source not found: ${libJson}\n  See scripts/exercise-source/README.md.`);
  const library = new Map(JSON.parse(fs.readFileSync(libJson, "utf8")).exercises.map((e) => [e.id, e]));

  // ── Check the catalogue ──
  const names = new Map();
  for (const e of catalogue) {
    if (!e.name || !e.name.trim()) fail("an exercise has no name");
    if (names.has(norm(e.name))) fail(`two exercises are called "${e.name}"`);
    names.set(norm(e.name), e);
    if (!GROUPS.has(e.primaryMuscle)) fail(`"${e.name}": unknown primaryMuscle "${e.primaryMuscle}"`);
    if (/—/.test([e.name, e.equipment, ...(e.instructions || [])].join(" "))) fail(`"${e.name}": em dash in its text`);
    if (e.hidden) continue;
    if (!e.picture) fail(`"${e.name}": no picture`);
    if (!e.instructions || !e.instructions.length) fail(`"${e.name}": no steps`);
    if (e.picture.library && !library.has(e.picture.library)) fail(`"${e.name}": unknown illustration "${e.picture.library}"`);
    if (e.picture.photo && !fs.existsSync(path.join(PHOTOS, e.picture.photo))) fail(`"${e.name}": photo not found: ${e.picture.photo}`);
  }
  const formerOwner = new Map();
  for (const e of catalogue) {
    for (const f of e.formerNames || []) {
      if (names.has(norm(f))) fail(`"${f}" is a former name of "${e.name}" but also a live exercise`);
      if (formerOwner.has(norm(f))) fail(`"${f}" is a former name of both "${formerOwner.get(norm(f))}" and "${e.name}"`);
      formerOwner.set(norm(f), e.name);
    }
  }

  // ── Images ──
  fs.rmSync(OUT_IMAGES, { recursive: true, force: true });
  fs.mkdirSync(OUT_IMAGES, { recursive: true });
  const usedIds = new Set();
  const records = [];
  const thumbs = [];
  const frames = [];
  for (const e of [...catalogue].sort((a, b) => a.name.localeCompare(b.name))) {
    let id = slugify(e.name);
    for (let i = 2; usedIds.has(id); i++) id = `${slugify(e.name)}-${i}`;
    usedIds.add(id);

    if (e.picture?.library) {
      const src = library.get(e.picture.library);
      const files = [];
      for (const frame of src.frames) {
        const file = `${id}-${frame}.webp`;
        await sharp(path.join(LIBRARY, src.images[frame]))
          .resize({ width: FRAME_WIDTH, withoutEnlargement: true })
          .webp({ quality: 74, effort: 5 })
          .toFile(path.join(OUT_IMAGES, file));
        files.push(file);
      }
      await sharp(path.join(LIBRARY, src.images[src.frames[0]]))
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover", position: sharp.strategy.attention })
        .webp({ quality: 74, effort: 5 })
        .toFile(path.join(OUT_IMAGES, `${id}-thumb.webp`));
      thumbs.push(`  "${id}": require("./exercises/${id}-thumb.webp"),`);
      frames.push(`  "${id}": [${files.map((f) => `require("./exercises/${f}")`).join(", ")}],`);
    } else if (e.picture?.photo) {
      // One picture, used as both the list still and the exercise screen's
      // (ExerciseImage fills the square with it, as photos always have).
      fs.copyFileSync(path.join(PHOTOS, e.picture.photo), path.join(OUT_IMAGES, `${id}.jpg`));
      thumbs.push(`  "${id}": require("./exercises/${id}.jpg"),`);
    }

    records.push({
      id,
      name: e.name,
      primaryMuscle: e.primaryMuscle,
      equipment: e.equipment,
      ...(e.hidden ? { hidden: true } : {}),
      ...(e.formerNames?.length ? { formerNames: e.formerNames } : {}),
      ...(e.searchTerms?.length ? { searchTerms: e.searchTerms } : {}),
      secondaryMuscles: e.secondaryMuscles || [],
      instructions: e.instructions || [],
    });
  }

  fs.writeFileSync(OUT_DATA,
    `// AUTO-GENERATED by scripts/build-exercises.mjs — do not edit by hand.\n` +
    `// Catalogue: scripts/exercise-library.json. Illustrations: Open Exercise Illustrations (CC0).\n\n` +
    `import type { Exercise } from "./exercises";\n\n` +
    `export const EXERCISES: Exercise[] = [\n` +
    records.map((r) => `  ${JSON.stringify(r)},`).join("\n") +
    `\n];\n`);

  fs.writeFileSync(OUT_IMAGE_MAP,
    `// AUTO-GENERATED by scripts/build-exercises.mjs — do not edit by hand.\n` +
    `//   EXERCISE_THUMBS: a still per exercise for lists (an illustration's small\n` +
    `//   square crop, or a kept photo).\n` +
    `//   EXERCISE_FRAMES: an illustration's full positions for the exercise screen\n` +
    `//   (start and end, or one hold). Kept photos have none: their still is it.\n\n` +
    `import type { ImageSourcePropType } from "react-native";\n\n` +
    `export const EXERCISE_THUMBS: Record<string, ImageSourcePropType> = {\n` + thumbs.join("\n") + `\n};\n\n` +
    `export const EXERCISE_FRAMES: Record<string, ImageSourcePropType[]> = {\n` + frames.join("\n") + `\n};\n`);

  const visible = records.filter((r) => !r.hidden).length;
  const bytes = fs.readdirSync(OUT_IMAGES).reduce((s, f) => s + fs.statSync(path.join(OUT_IMAGES, f)).size, 0);
  console.log(`✓ ${records.length} exercises (${visible} in the picker, ${records.length - visible} retired)  →  constants/exerciseData.ts`);
  console.log(`✓ ${thumbs.length} pictures, ${(bytes / 1048576).toFixed(1)} MB  →  assets/exercises/`);
  console.log(`✓ ${formerOwner.size} former names`);
  console.log(`\n⚠  Images were rewritten — cold-restart Metro to pick them up:`);
  console.log(`   stop the bundler, then:  npx expo start --clear`);
}

main().catch((e) => fail(e.stack || String(e)));
