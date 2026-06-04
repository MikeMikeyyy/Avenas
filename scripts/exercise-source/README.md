# Drop the free-exercise-db repo contents here

This folder is the **raw source** for the exercise-library build. It is
git-ignored — nothing in here ships in the app or gets committed; the build
script processes it into optimized assets under `assets/`.

## What to put here

Download [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
(green **Code** button → **Download ZIP**, or `git clone`) and place its
contents directly in this folder, so you end up with:

```
scripts/exercise-source/
  dist/exercises.json        ← the full dataset (metadata)
  exercises/                 ← the JPG images, in per-exercise subfolders
  site/                      ← (their demo site — unused, fine to leave or delete)
```

The build script (`scripts/build-exercises.mjs`) reads `dist/exercises.json`
and the `exercises/` image folder, then generates:

- `constants/exerciseData.ts` — the bundled catalogue
- `assets/exercises/` — optimized images
- `assets/exerciseImages.ts` — the require-maps

License: free-exercise-db is released under the Unlicense (public domain).
