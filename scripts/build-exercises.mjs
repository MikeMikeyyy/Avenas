// Build the bundled exercise library.
//
// The catalogue is the *authored* curated list (scripts/curated-exercises.json)
// — a Hevy-equivalent ~270 set, so it has no gaps and no junk. free-exercise-db
// is used only as a photo source: each curated exercise is token-matched to a
// free-exercise-db entry and, when found, that photo is bundled. Curated
// exercises with no match ship photo-less (ExerciseImage shows a fallback tile)
// until a photo is added later.
//
// Reads:
//   scripts/curated-exercises.json
//   scripts/exercise-source/free-exercise-db-main/dist/exercises.json
//   scripts/exercise-source/free-exercise-db-main/exercises/<id>/0.jpg
//
// Writes:
//   assets/exercises/<slug>.jpg
//   assets/exerciseImages.ts
//   constants/exerciseData.ts
//
// Run from the project root:  node scripts/build-exercises.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts/exercise-source/free-exercise-db-main");
const SRC_JSON = path.join(SOURCE, "dist/exercises.json");
const SRC_IMAGES = path.join(SOURCE, "exercises");
const CURATED_JSON = path.join(ROOT, "scripts/curated-exercises.json");
const OUT_IMAGES = path.join(ROOT, "assets/exercises");
const OUT_IMAGE_MAP = path.join(ROOT, "assets/exerciseImages.ts");
const OUT_DATA = path.join(ROOT, "constants/exerciseData.ts");

// Words dropped before token-matching — equipment labels + free-exercise-db's
// stock modifiers ("- Medium Grip" etc.). What's left is the actual movement.
const FILLER = new Set([
  "barbell", "dumbbell", "cable", "machine", "smith", "bar", "body", "weight",
  "plate", "band", "banded", "kettlebell", "kettlebells", "medium", "grip",
  "the", "with", "and",
]);

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Movement tokens: word-split, drop short words + equipment/filler noise.
const tokens = (s) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w));

// A loose, order-independent token relation that tolerates plurals
// (tricep/triceps) by allowing either token to contain the other.
const tokenRel = (a, b) => a.includes(b) || b.includes(a);

// A free-exercise-db candidate is usable as a photo for a curated exercise if
// it covers every curated movement token. Returns the count of *extra*
// candidate tokens (lower = closer match), or null when it isn't a match.
function matchExtras(curatedTokens, candTokens) {
  if (curatedTokens.length === 0 || candTokens.length === 0) return null;
  const covered = curatedTokens.every((x) => candTokens.some((y) => tokenRel(x, y)));
  if (!covered) return null;
  return candTokens.filter((y) => !curatedTokens.some((x) => tokenRel(x, y))).length;
}

function equipGroup(s) {
  s = (s || "").toLowerCase();
  if (s.includes("barbell")) return "barbell";
  if (s.includes("dumbbell")) return "dumbbell";
  if (s.includes("cable")) return "cable";
  if (s.includes("smith") || s.includes("machine")) return "machine";
  if (s.includes("body")) return "body";
  if (s.includes("e-z") || s.includes("ez ")) return "ez";
  if (s.includes("kettlebell")) return "kettlebell";
  if (s.includes("band")) return "band";
  return "other";
}

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error(`✗ Source not found: ${SRC_JSON}\n  Drop free-exercise-db into scripts/exercise-source/ first.`);
    process.exit(1);
  }

  const curated = JSON.parse(fs.readFileSync(CURATED_JSON, "utf8"));
  const fdb = JSON.parse(fs.readFileSync(SRC_JSON, "utf8")).map((e) => ({
    name: e.name,
    tokens: tokens(e.name),
    equipGroup: equipGroup(e.equipment),
    image: e.images && e.images[0] ? e.images[0] : null,
    instructions: e.instructions || [],
    secondaryMuscles: e.secondaryMuscles || [],
  }));

  fs.rmSync(OUT_IMAGES, { recursive: true, force: true });
  fs.mkdirSync(OUT_IMAGES, { recursive: true });

  const records = [];
  const imageEntries = [];
  const usedSlugs = new Set();
  let withPhoto = 0;

  for (const ex of curated) {
    let slug = slugify(ex.name);
    if (usedSlugs.has(slug)) {
      let i = 2;
      while (usedSlugs.has(`${slug}-${i}`)) i++;
      slug = `${slug}-${i}`;
    }
    usedSlugs.add(slug);

    // Pick the closest free-exercise-db photo: it must cover every curated
    // movement token (≤ 2 extra tokens to stay relevant), then rank by
    // equipment match → fewest extras → shortest name.
    const ct = tokens(ex.name);
    const want = equipGroup(ex.equipment);
    let match = null, matchScore = null;
    for (const f of fdb) {
      if (!f.image) continue;
      const extras = matchExtras(ct, f.tokens);
      if (extras === null || extras > 2) continue;
      const score = [f.equipGroup === want ? 0 : 1, extras, f.name.length];
      if (!matchScore ||
          score[0] < matchScore[0] ||
          (score[0] === matchScore[0] && score[1] < matchScore[1]) ||
          (score[0] === matchScore[0] && score[1] === matchScore[1] && score[2] < matchScore[2])) {
        match = f;
        matchScore = score;
      }
    }

    if (match) {
      const srcImg = path.join(SRC_IMAGES, match.image);
      if (fs.existsSync(srcImg)) {
        fs.copyFileSync(srcImg, path.join(OUT_IMAGES, `${slug}.jpg`));
        imageEntries.push(`  "${slug}": require("./exercises/${slug}.jpg"),`);
        withPhoto++;
      }
    }

    records.push({
      id: slug,
      name: ex.name,
      primaryMuscle: ex.primaryMuscle,
      equipment: ex.equipment,
      secondaryMuscles: match ? match.secondaryMuscles : [],
      instructions: match ? match.instructions : [],
    });
  }

  records.sort((a, b) => a.name.localeCompare(b.name));

  const dataFile =
    `// AUTO-GENERATED by scripts/build-exercises.mjs — do not edit by hand.\n` +
    `// Catalogue: scripts/curated-exercises.json. Photos: free-exercise-db (public domain).\n\n` +
    `import type { Exercise } from "./exercises";\n\n` +
    `export const EXERCISES: Exercise[] = [\n` +
    records.map((r) => `  ${JSON.stringify(r)},`).join("\n") +
    `\n];\n`;
  fs.writeFileSync(OUT_DATA, dataFile);

  const mapFile =
    `// AUTO-GENERATED by scripts/build-exercises.mjs — do not edit by hand.\n` +
    `// See assets/exerciseImages.ts header for how these maps are used.\n\n` +
    `import type { ImageSourcePropType } from "react-native";\n\n` +
    `export const EXERCISE_THUMBS: Record<string, ImageSourcePropType> = {\n` +
    imageEntries.join("\n") +
    `\n};\n\n` +
    `// No animated GIFs bundled yet — populated later if GymVisual GIFs are added.\n` +
    `export const EXERCISE_GIFS: Record<string, ImageSourcePropType> = {};\n`;
  fs.writeFileSync(OUT_IMAGE_MAP, mapFile);

  console.log(`✓ ${records.length} curated exercises  →  constants/exerciseData.ts`);
  console.log(`✓ ${withPhoto} with photos  →  assets/exercises/  (${records.length - withPhoto} photo-less)`);
  console.log(`\n⚠  Images were rewritten — cold-restart Metro to pick them up:`);
  console.log(`   stop the bundler, then:  npx expo start --clear`);
}

main();
