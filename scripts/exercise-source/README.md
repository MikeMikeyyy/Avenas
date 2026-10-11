# Exercise library sources

This folder holds the **raw picture sources** for the exercise-library build.
It is git-ignored: nothing in here ships in the app or gets committed. The
build script (`node scripts/build-exercises.mjs`) reads it and writes the
optimized pictures into `assets/exercises/`.

The list itself is **not** here: it's `scripts/exercise-library.json`
(committed), and the photos kept from the old library are in
`scripts/exercise-photos/` (committed).

## What to put here

Download [Open Exercise Illustrations](https://github.com/hitmanrepo/open-exercise-illustrations)
(green **Code** button → **Download ZIP**, or `git clone`) and place its
contents in `open-exercise-illustrations/`, so you end up with:

```
scripts/exercise-source/
  open-exercise-illustrations/
    exercises.json      ← metadata: names, other names, muscles, frames
    images/             ← start/end (or hold) frames as WebP, per exercise
```

An exercise in `exercise-library.json` points at an illustration by its id
there: `"picture": { "library": "<id>" }`.

`free-exercise-db-main/` was the old photo source; the build no longer reads it.

License: Open Exercise Illustrations is released under CC0 1.0 (public domain).
No attribution is required.
