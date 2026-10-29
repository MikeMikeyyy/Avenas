// constants/theme.ts
// Update these values once design direction is confirmed
// Share Pinterest/reference images with Claude in Antigravity and say
// "update the theme file based on these"

// ─── Cards ────────────────────────────────────────────────────────────────────
// The card (NeuCard) on each theme's page: white on Porcelain's pale cool page,
// charcoal on Graphite's near-black one (user picks, 2026-10-28, from the Light
// Mode Whites and Dark Mode Home canvases; tried on Home, then app-wide). They
// replaced a grey-blue neumorphic card (#f2f4f8 on #e8ecf3) and a navy one
// (#252840 on #1B1E2C).
export const NEU_BG      = "#FFFFFF";
export const NEU_BG_DARK = "#1C1D21";
// A light card's two shadows: a cool shade down and to the right, softer and
// wider than the old #a3afc0, and a white glow up and to the left. A dark card
// casts plain black, and a faint white edge does the glow's job.
export const CARD_SHADE      = "#8896AF";
export const CARD_GLOW       = "#FFFFFF";
export const CARD_SHADE_DARK = "#000000";
export const CARD_EDGE_DARK  = "rgba(255,255,255,0.06)";

// ─── App-wide light / dark palette ────────────────────────────────────────────
// Import these in every screen instead of redefining LIGHT/DARK locally.
//
// Porcelain (light): a pale cool page, and greys dark enough to read on its
// white cards: ts is 5.4:1 on the card and 4.7:1 on the page (the old #8896A7
// was under 3:1 on its grey card).
export const APP_LIGHT = {
  bg:   "#EDF1F6",
  tp:   "#1E2738",  // text primary
  ts:   "#5E6B82",  // text secondary
  icon: "#2C3446",
  div:  "#E4E8EF",  // divider
  ctrl: "#ffffff",  // floating control surface — see the note on APP_DARK.ctrl
  cardCtrl: "#F7F9FC",  // a button inside a card — see the note on APP_DARK.cardCtrl
  nav:  "#ffffff",  // floating tab bar — see the note on APP_DARK.nav
  navEdge: "rgba(0,0,0,0.06)",
  field: "rgba(0,0,0,0.04)",  // a search field on the page — see the note on APP_DARK.field
  sheetLine: "rgba(30,39,56,0.12)",  // a line between rows on a sheet — see the note on APP_DARK.sheetLine
} as const;

// Graphite (dark): a near-black page under charcoal cards, neutral rather than
// the navy it replaced, and lighter greys: ts is 6.3:1 on the card (the old
// #6B7396 was about 3:1 on the navy card).
export const APP_DARK = {
  bg:   "#111214",
  tp:   "#F3F4F6",
  ts:   "#9A9EA8",
  icon: "#D1D4DA",
  // Dividers, hairlines, chart gridlines and the quiet control fills.
  //
  // A TRANSLUCENT WHITE, not a solid navy. It used to be #252840, which is
  // exactly the card colour (NEU_BG_DARK) and a hair off the page bg, so
  // anything drawn with it vanished in dark mode: every card divider, the
  // Progress charts' axis and dashed gridlines, the timer's tab track. Four
  // components had already worked around it with a local translucent white
  // (SegmentedControl's TRACK_DARK still names the problem). An overlay lifts
  // off whatever dark surface it sits on, so one token now works everywhere.
  //
  // 0.10 over Graphite's charcoal card lands about as far from it as light
  // mode's #E4E8EF does from white, so a hairline carries the same weight in
  // both themes (it was 0.14 over the old navy card).
  div:  "rgba(255,255,255,0.10)",
  // Background for floating chrome (back / plus / chat / jump buttons, timer
  // pills) — anything round that sits ON the page rather than in a card.
  // Slightly stronger than div: these are things you press.
  ctrl: "rgba(255,255,255,0.12)",
  // A button INSIDE a card (cardButton, constants/buttons.ts), with a div
  // hairline round it and no shadow (user pick, 2026-10-29, option D of the
  // Buttons on Cards canvas). Light mode's ctrl is white, the card's own colour,
  // so a white button on a card showed only as its faint shadow; light mode's
  // cardCtrl is a step off the white instead. Here ctrl already lifts off the
  // charcoal card, so cardCtrl is the same.
  cardCtrl: "rgba(255,255,255,0.12)",
  // The floating tab bar. A rung ABOVE the cards rather than level with them:
  // it used NEU_BG_DARK (#252840), which is the card colour and only ~6% off
  // the page bg, so the bar melted into the background. Solid rather than
  // translucent like ctrl, because content scrolls underneath it and there's no
  // blur behind the fallback bar to hide it.
  nav:  "#2A2B30",
  // Hairline that defines the bar's edge. Does most of the work in dark mode,
  // where a drop shadow is close to invisible.
  navEdge: "rgba(255,255,255,0.10)",
  // A search field laid on the page (components/SearchField.tsx): a faint tint
  // of whatever is under it, the faded look, quieter than ctrl so it reads as
  // a place to type rather than a button (user decision, 2026-10-22).
  field: "rgba(255,255,255,0.06)",
  // A line between rows on a sheet (the reorder sheet's exercises): stronger
  // than div, which is pitched for a solid card and all but vanished on a
  // glass sheet (user report, 2026-10-30: the lines between exercises had
  // gone). Light mode's is the ink at 12%, so it shows on glass and page alike.
  sheetLine: "rgba(255,255,255,0.16)",
} as const;

export type AppTheme = typeof APP_LIGHT;

// ─── Brand accent ─────────────────────────────────────────────────────────────
// The single source for the app's green accent — import this, never hardcode.
export const ACCT = "#1deca0";

// The exercise illustrations' own studio backdrop, top to bottom (sampled from
// their corners). Laid behind an illustration fitted whole into a square, so
// the space beside it reads as more of the same studio. Same in both themes:
// it's the picture's background, not the app's.
export const EXERCISE_STUDIO = ["#08090c", "#111317"] as const;

// Deeper green for small text/lines that sit over aurora-tinted LIGHT
// backgrounds — ACCT itself washes out over the mint glow. Dark mode keeps ACCT.
export const ACCT_DEEP = "#0c9f6e";

// The accent's WORDS on a light card: the Progress charts' gains ("▲ 9.4%"),
// the tapped bar's total, the radar's ▲, the reps on a Sets block. ACCT as
// text reads at about 1.5:1 on a light card; this reads at 4.8:1 (user
// decision, 2026-10-14: "nicer"). Dark mode keeps ACCT, and the marks (bars,
// lines, dots, fills, glows) stay ACCT in both themes. Not while comparing two
// programs: there the green program's numbers are ACCT, its dot's own green
// (user decision, the same day), all but the reps on its pale Sets blocks.
export const ACCT_INK = "#067A54";

/** The accent for text: ACCT_INK on a light card, ACCT on a dark one. */
export function accentTextColor(isDark: boolean): string {
  return isDark ? ACCT : ACCT_INK;
}

/** `color` laid over `base` at `alpha` (0 to 1), as one solid colour (both
 *  "#rrggbb"): a wash marking a row, which anything hollow drawn on it (a
 *  ring's fill, hiding the line through it) must match exactly. */
export function washOver(base: string, color: string, alpha: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const mixed = [0, 1, 2].map(i => Math.round(ch(base, i) + (ch(color, i) - ch(base, i)) * alpha));
  return `#${mixed.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// ─── Danger ───────────────────────────────────────────────────────────────────
// Two reds, split by job. Import them, never hardcode a red literal.
//
// DANGER: warnings and moderation. An error state ("Couldn't back up"), a
// warning hint, the block/report steps.
export const DANGER = "#E5484D";

// DANGER_BRIGHT: anything that deletes, removes or discards. The filled
// buttons (remove a set, delete a sent program, a danger SheetPill) and the
// trash icons and red "Delete" / "Remove" / "Discard" labels, so a delete looks
// the same on every screen. Fills pair with haloGlow() (constants/buttons.ts)
// rather than a drop shadow; the centred glow is what makes them one family.
// There were three reds for this before (#FF4D4F, #E53935, #ef4444).
export const DANGER_BRIGHT = "#FF4D4F";

// DANGER as words on a light card, where DANGER itself is too pale for small
// text (a review's "Not reviewed" pill, a tile's line): 5.9:1 on a white card,
// 4.9:1 on DANGER's own pale tint.
export const DANGER_INK = "#B8323A";

/** The warning red for text: DANGER_INK on a light card, DANGER on a dark one. */
export function dangerTextColor(isDark: boolean): string {
  return isDark ? DANGER : DANGER_INK;
}

// ─── Favourites ───────────────────────────────────────────────────────────────
// The star on a pinned group. A true yellow gold — the old #FFC24B carried
// enough blue to read dull and muddy next to the brand green. Still distinct
// from the yellow-orange WARMUP_ORANGE and the deeper PAUSED_ORANGE so the
// three never read as the same state.
//
// Dark mode gets its own value rather than reusing the light one: a fully
// saturated gold vibrates against a dark navy card, so GOLD_DARK is lifted in
// lightness and pulled back in saturation. Render both through
// <FavouriteStar /> (components/FavouriteStar.tsx), which also carries the
// glow — deliberately softer on dark, where a bloom on a dark ground reads far
// stronger than the same values do on light.
export const GOLD      = "#FFC61F";
export const GOLD_DARK = "#FFD35C";
// The light that passes over a gold record on the exercise chart every few
// seconds (a glint up the bar or block, a sparkle on the dot): white, in both
// themes, at the strengths the chart gives it.
export const GOLD_SHINE = "#FFFFFF";

// ─── Group roles ──────────────────────────────────────────────────────────────
// Badges beside a member's name on a group page. The OWNER keeps the brand
// green (they created the group); trainers and members get their own hues so
// the three are tellable apart at a glance, in both themes.
export const ROLE_OWNER   = ACCT;
export const ROLE_TRAINER = "#A78BFA";  // soft violet
export const ROLE_MEMBER  = "#60A5FA";  // soft blue
// The trainer and member badges' WORDS on a light card, where the soft hues
// above read at about 2.5:1 (these, 5:1 and more). Dark mode keeps the hues;
// the owner's words are accentTextColor. Fills stay the hues at 22 alpha.
export const ROLE_TRAINER_INK = "#6B4FD8";
export const ROLE_MEMBER_INK  = "#2563C9";

/** A role badge's colour: its fill, laid on at 22 alpha. */
export function roleColor(role: "owner" | "trainer" | "member"): string {
  if (role === "owner") return ROLE_OWNER;
  return role === "trainer" ? ROLE_TRAINER : ROLE_MEMBER;
}

/** A role badge's words: the deeper ink on a light card. */
export function roleTextColor(role: "owner" | "trainer" | "member", isDark: boolean): string {
  if (role === "owner") return accentTextColor(isDark);
  if (role === "trainer") return isDark ? ROLE_TRAINER : ROLE_TRAINER_INK;
  return isDark ? ROLE_MEMBER : ROLE_MEMBER_INK;
}

// ─── Group chat ───────────────────────────────────────────────────────────────
// A group's chat on its page: the Group Chat tile's icon and circle, and its
// "3 new messages". The aurora orchid, so it reads apart from the page's green
// Send button and its Programs tile (user decision, 2026-10-22: green was
// overused there). Marks are CHAT_ORCHID (AURORA.orchid on dark); words are
// CHAT_ORCHID_INK on a light card (5.7:1), lifted on dark.
export const CHAT_ORCHID          = "#D94FEA";
export const CHAT_ORCHID_DARK     = "#F18BFF";
export const CHAT_ORCHID_INK      = "#A3289B";
export const CHAT_ORCHID_INK_DARK = "#F5A8FF";

/** A group chat's marks: its icon and circle. */
export function chatOrchid(isDark: boolean): string {
  return isDark ? CHAT_ORCHID_DARK : CHAT_ORCHID;
}

/** A group chat's words. */
export function chatOrchidText(isDark: boolean): string {
  return isDark ? CHAT_ORCHID_INK_DARK : CHAT_ORCHID_INK;
}

// ─── A person's or group's own colour ─────────────────────────────────────────
// What stands in for a photo (components/Avatar.tsx, trainer/GroupAvatar.tsx):
// a pale circle in one of these, with the initials or the group's people icon
// in the same colour, deeper. Each person and group gets one colour, picked
// from their id, and keeps it everywhere they're drawn, so a list of people
// without photos isn't all green (user request, 2026-10-28: the soft tint, over
// orb-like gradients). `tint` is laid on at 18% on light and 16% on dark; `ink`
// reads at 4.8:1 or more on it over a light card or page, `inkDark` at 6.4:1
// or more over a dark one.
export const AVATAR_HUES = [
  { tint: "#1DECA0", ink: "#05704C", inkDark: "#1DECA0" }, // mint
  { tint: "#38C8F2", ink: "#0A6A8A", inkDark: "#6FDCFF" }, // sky
  { tint: "#2F86FF", ink: "#1A5BC4", inkDark: "#82B8FF" }, // ocean blue
  { tint: "#7D87FF", ink: "#3F49C2", inkDark: "#A7AEFF" }, // periwinkle
  { tint: "#A27BF5", ink: "#6236C9", inkDark: "#C3ABFF" }, // violet
  { tint: "#E35DF0", ink: "#9A1FA3", inkDark: "#F29BFA" }, // orchid
  { tint: "#FF6F9E", ink: "#B21F57", inkDark: "#FF9FC1" }, // rose
  { tint: "#FF9461", ink: "#A2461A", inkDark: "#FFB48E" }, // peach
] as const;

/** A 32-bit hash with every character of the key stirred into every bit of it
 *  (FNV-1a, then murmur3's finaliser). The colour is read off its low bits,
 *  and the djb2 it replaced left those as the key's character sum (user
 *  report, 2026-10-29: the colours went in the same order), so ids a character
 *  apart walked through the hues one after another. */
function mixedHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The colour a person or group is drawn in without a photo: the circle and
 *  what's on it. Keyed by their id (a person's user id, a group's id), so the
 *  same one comes out on every page; no key is the mint. People and groups are
 *  mixed apart (`kind`), so the two never share one pattern. */
export function avatarColors(
  key: string | undefined, isDark: boolean, kind: "person" | "group" = "person",
): { bg: string; ink: string } {
  const hue = AVATAR_HUES[key ? mixedHash(`${kind}:${key}`) % AVATAR_HUES.length : 0];
  return { bg: `${hue.tint}${isDark ? "29" : "2E"}`, ink: isDark ? hue.inkDark : hue.ink };
}

// ─── Warmups ──────────────────────────────────────────────────────────────────
// A warmup set: its row's accent on the Workout tab, and its dots beside the
// working sets' green (the timer's up-next card; the lock screen card draws
// the same colour in targets/workout-widget/index.swift). Several screens
// still keep their own copy of this value.
export const WARMUP_ORANGE = "#ffbf0f";

// ─── Paused ───────────────────────────────────────────────────────────────────
// A program on hold: the "Paused" badge and the Pause action. Deliberately a
// deeper orange than the bright yellow-orange WARMUP_ORANGE (#ffbf0f) that
// "Make Inactive" uses, so the two read as different actions at a glance.
export const PAUSED_ORANGE = "#FF9500";

// ─── Awaiting review ──────────────────────────────────────────────────────────
// A program sent for review that no trainer has sent back yet: its status pill
// on every trainer page and group page (text in this, fill at 22 alpha). The
// same orange as Paused on purpose: both mean "waiting, not done", where green
// means it's back or accepted. It was a grey pill, the same as a plain label,
// so a request still waiting on a trainer didn't stand out from one that
// wasn't.
export const AWAITING_ORANGE = PAUSED_ORANGE;

// ─── Replaced session ─────────────────────────────────────────────────────────
// A dot on a workout card's session track (components/SessionTrack.tsx) whose
// day came round and was trained with something ELSE: a custom workout, or
// another day picked with Change Workout Day. Grey is kept for a day with nothing
// logged at all. Orange because it's the app's "not quite done" colour: the
// user trained, just not this workout.
export const REPLACED_ORANGE = PAUSED_ORANGE;

// ─── Change cues ──────────────────────────────────────────────────────────────
// The quiet line under an exercise that was moved, swapped, added or skipped
// (components/ChangeCue.tsx, utils/exerciseChanges.ts). A grey held to 4.5:1
// because this line is information (5.2 on the light card, 6 on the dark). It
// was a shade darker than the text-secondary greys when those read at about
// 3:1; since Porcelain and Graphite it sits about level with them.
export const CUE_INK      = "#5F6E83";
export const CUE_INK_DARK = "#959AA5";
// The replaced orange's WORDS ("Instead of Push", "Instead of Cable Fly",
// "Last session: Pec Deck instead"), deepened for a light card, where
// REPLACED_ORANGE as text reads at 2:1 (this, 4.7:1). Dark mode keeps
// REPLACED_ORANGE itself. Dots and glows stay REPLACED_ORANGE in both themes:
// they're marks, not text (user decision, 2026-10-14).
export const REPLACED_ORANGE_INK = "#A65800";

/** The replaced orange for text: REPLACED_ORANGE_INK on a light card. */
export function replacedTextColor(isDark: boolean): string {
  return isDark ? REPLACED_ORANGE : REPLACED_ORANGE_INK;
}

// ─── Comparing two programs ───────────────────────────────────────────────────
// The Progress page compares the program picked at the top (green, ACCT) with a
// finished one: periwinkle (user pick, 2026-10-14, of three blues on the
// Program Compare canvas). The marks (lines, bars, rings, the radar's shape)
// are COMPARE_BLUE, lifted on dark; its words are COMPARE_BLUE_INK on a light
// card, 5.8:1, lighter again on dark. Its dots are rings, so the two programs
// read apart without colour.
export const COMPARE_BLUE          = "#7C83F7";
export const COMPARE_BLUE_DARK     = "#969CFA";
export const COMPARE_BLUE_INK      = "#4A4FC9";
export const COMPARE_BLUE_INK_DARK = "#ABB0FB";

/** The compared program's marks: lines, bars, rings, fills. */
export function compareBlue(isDark: boolean): string {
  return isDark ? COMPARE_BLUE_DARK : COMPARE_BLUE;
}

/** The compared program's words and numbers. */
export function compareBlueText(isDark: boolean): string {
  return isDark ? COMPARE_BLUE_INK_DARK : COMPARE_BLUE_INK;
}

// ─── Aurora (soft pastel gradient system) ─────────────────────────────────────
// Bubbly pastel accents built around the brand green, with an aqua and a blush
// counterpoint. Base colors are full-strength; surfaces fade them via gradient
// stop opacity so the same hex works in light and dark mode.
export const AURORA = {
  mint:  ACCT,
  aqua:  "#45c4f5",
  blush: "#ff9ec2",
  // ── Page lead glows ────────────────────────────────────────────────────────
  // Each is derived from its orb's DEEP stop by the same shift that produced
  // `blush` from the old pink orb: same hue, lightened ~8%. They exist as their
  // own tokens rather than replacing `mint`/`aqua`/`blush`, because those three
  // are still doing duty as counter-glows on other pages and in the Home mix —
  // repointing them would move backdrops that aren't part of this change.
  orchid:  "#F18BFF",  // journal family  — from the first blush orb's #ed64ff
  sky:     "#70E2FF",  // My Programs     — from the first aqua orb's  #47daff
  seafoam: "#56F5C5",  // New Program     — from the first green orb's #2ff3b8
} as const;

// Gradient orb buttons (Home's quick actions, the Journal's add button). `glow`
// doubles as the shadow color. New Program sky to mint, My Programs an ocean
// blue, View Journal periwinkle to orchid (user picks, 2026-10-28, from the
// Light Mode Whites canvas). The canvas's own values (#70E2FF to #1DECA0,
// #4BE1F2 to #1E88F5, #8F96F9 to #E06AF0) looked very dull on the phone (user
// report, the same day): a wide-colour monitor shows them more saturated than
// an iPhone, which draws them exactly. So each stop here is that colour pushed
// out to the most saturated version of itself the phone draws.
export const ORB_GRADS = {
  green: { colors: ["#2EE5FF", "#00F099"] as const, glow: "#10DDBD" },
  aqua:  { colors: ["#00E5F5", "#008AFD"] as const, glow: "#0AA6F7" },
  blush: { colors: ["#8D96FF", "#F161F7"] as const, glow: "#B56EF8" },
} as const;

// ─── The timer and the rest ───────────────────────────────────────────────────
// The Workout tab's timer ring, the rest pop-up's ring and the workout bar's
// rest line: the aurora sky into the brand mint (user decision, 2026-10-15,
// the Workout Timer canvas).
export const TIMER_GRADIENT = [AURORA.sky, ACCT] as const;

/** The timer dial's quiet marks: the ring's track and the ticks not yet lit.
 *  Lit ticks are the accent, deepened on light as small marks need. */
export function timerDialInk(isDark: boolean): { track: string; tickOff: string; tickOn: string } {
  return isDark
    ? { track: "rgba(255,255,255,0.08)", tickOff: "rgba(255,255,255,0.18)", tickOn: ACCT }
    : { track: "rgba(136,150,175,0.28)", tickOff: "rgba(94,107,130,0.45)", tickOn: ACCT_DEEP };
}


// ─── Bubble pill ──────────────────────────────────────────────────────────────
// Small floating pill controls that sit on cards (the SegmentedControl thumb):
// white with a soft drop shadow in light mode, a lifted charcoal one step above
// NEU_BG_DARK in dark mode. DropdownPicker's buttons used this too; they're now
// the app's pill button on `ctrl`, matching the sheet they open.
export const BUBBLE_LIGHT = "#FFFFFF";
export const BUBBLE_DARK  = "#2C2D33";

// ─── Set inputs ───────────────────────────────────────────────────────────────
// A set's weight and reps boxes on dark (the Workout tab, Log Workout, Workout
// Detail, the program builder): a step above the card, ringed in white. Light
// mode gives them the card's button look instead (setInputSurface in
// constants/buttons.ts, which draws them all). They were a lifted navy
// (#343759).
export const SET_INPUT_DARK = "#2C2D33";
export const SET_INPUT_RING_DARK = "rgba(255,255,255,0.45)";

// ─── Tips ─────────────────────────────────────────────────────────────────────
// A first-time tip inside a card (the program builder's warm-up tip): the
// accent washed over the card, solid rather than translucent, so the pointer
// drawn half under the tip's edge is exactly its colour where the two overlap.
export function tipFill(isDark: boolean): string {
  return washOver(isDark ? NEU_BG_DARK : NEU_BG, ACCT, isDark ? 0.14 : 0.12);
}

// ─── Switch ───────────────────────────────────────────────────────────────────
// Off-state track for the iOS Switches in LIGHT mode (Settings, the Workout
// tab's Focus Mode). APP_LIGHT.div (#D8DCE0) is too pale against a white card
// to read as a control; this is a clearly darker grey. Dark mode uses t.div
// (already visible). Pass it as `trackColor.false` and nothing else, so the
// switch keeps iOS's own look.
export const SWITCH_TRACK_LIGHT = "#C4CAD3";

// ─── Slate button ─────────────────────────────────────────────────────────────
// Dark slate-black for primary non-accent buttons (light mode bg).
// Off-white counterpart used in dark mode.
export const BTN_SLATE      = "#53545f";  // light mode: deep slate black
export const BTN_SLATE_DARK = APP_DARK.tp; // dark mode: app's existing off-white
// Words and icons on a filled button (ACCT, DANGER_BRIGHT, the light mode
// slate), in both themes. On the dark mode slate they're APP_DARK.bg instead.
export const ON_FILL = "#ffffff";

// ─── Legacy colours (pre-design-token era) ────────────────────────────────────
export const Colors = {
  // Main backgrounds
  background: '#000000',        // Main screen background — update me
  backgroundSecondary: '#111111', // Cards, panels behind glass — update me
  surface: '#1A1A1A',           // Elevated surfaces — update me

  // Brand colours
  primary: '#FFFFFF',           // Primary action colour — update me
  primaryMuted: '#CCCCCC',      // Softer version of primary — update me
  accent: '#FFFFFF',            // Accent / highlight colour — update me

  // Text
  textPrimary: '#FFFFFF',       // Main text — update me
  textSecondary: '#999999',     // Subtext, labels — update me
  textMuted: '#555555',         // Placeholder, disabled — update me

  // Feedback
  success: '#34C759',           // iOS green — fine to keep
  error: '#FF3B30',             // iOS red — fine to keep
  warning: '#FF9500',           // iOS orange — fine to keep

  // Glass fallback (used on Android / iOS < 26)
  glassFallback: 'rgba(255,255,255,0.12)',
  glassFallbackDark: 'rgba(0,0,0,0.4)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BorderRadius = {
  sm: 8,
  md: 16,
  lg: 20,      // Cards
  xl: 24,      // Modals
  full: 9999,  // Pills / buttons
};

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

export const FontFamily = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
};
