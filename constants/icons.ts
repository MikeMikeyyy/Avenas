// constants/icons.ts
//
// The app's image icons: full-colour artwork shipped as PNGs, as opposed to the
// Ionicons glyphs drawn in a theme colour. One require per asset, so every
// surface that shows an icon points at the same file and a redraw lands
// everywhere at once. Draw them with expo-image; they ignore theme colours.

/** Achievements: the PR card's badge and the Notifications page's row. */
export const TROPHY_ICON: number = require("../assets/images/trophy.png");

/** A finished program: a clipboard with a blue tick (user request, 2026-11-19:
 *  "for completed programs can we change the icon from that blue medal we have
 *  to this on all pages"). The program achievement card's badge, the program
 *  page's "Finished" line and Your Training's programs finished. It replaced
 *  the aqua Ionicons ribbon. */
export const PROGRAM_DONE_ICON: number = require("../assets/images/program-complete.png");
