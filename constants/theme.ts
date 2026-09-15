// constants/theme.ts
// Update these values once design direction is confirmed
// Share Pinterest/reference images with Claude in Antigravity and say
// "update the theme file based on these"

// ─── Neumorphic base backgrounds ──────────────────────────────────────────────
// These drive NeuCard shadows — every screen bg must match these exactly.
export const NEU_BG      = "#f2f4f8";
export const NEU_BG_DARK = "#252840";  // dark navy card — lighter than page bg

// ─── App-wide light / dark palette ────────────────────────────────────────────
// Import these in every screen instead of redefining LIGHT/DARK locally.
export const APP_LIGHT = {
  bg:   "#e8ecf3",
  tp:   "#2D3748",  // text primary
  ts:   "#8896A7",  // text secondary
  icon: "#3a3f47",
  div:  "#D8DCE0",  // divider
  ctrl: "#ffffff",  // floating control surface — see the note on APP_DARK.ctrl
  nav:  "#ffffff",  // floating tab bar — see the note on APP_DARK.nav
  navEdge: "rgba(0,0,0,0.06)",
} as const;

export const APP_DARK = {
  bg:   "#1B1E2C",
  tp:   "#E4E6F0",  // slightly blue-tinted white
  ts:   "#6B7396",  // muted blue-gray
  icon: "#8B93AE",  // navy-tinted icon
  div:  "#252840",  // dark navy divider
  // Background for floating chrome (back / plus / chat / jump buttons, timer
  // pills) — anything round that sits ON the page rather than in a card.
  //
  // NOT div: in dark mode div is #252840, which is both the card colour
  // (NEU_BG_DARK) and a hair off the page bg, so a button painted with it
  // disappears. A translucent white lifts off whatever is behind it instead,
  // which is what makes these read on every surface in both themes.
  ctrl: "rgba(255,255,255,0.12)",
  // The floating tab bar. A rung ABOVE the cards rather than level with them:
  // it used NEU_BG_DARK (#252840), which is the card colour and only ~6% off
  // the page bg, so the bar melted into the background. Solid rather than
  // translucent like ctrl, because content scrolls underneath it and there's no
  // blur behind the fallback bar to hide it.
  nav:  "#30354F",
  // Hairline that defines the bar's edge. Does most of the work in dark mode,
  // where a drop shadow is close to invisible.
  navEdge: "rgba(255,255,255,0.10)",
} as const;

export type AppTheme = typeof APP_LIGHT;

// ─── Brand accent ─────────────────────────────────────────────────────────────
// The single source for the app's green accent — import this, never hardcode.
export const ACCT = "#1deca0";

// Deeper green for small text/lines that sit over aurora-tinted LIGHT
// backgrounds — ACCT itself washes out over the mint glow. Dark mode keeps ACCT.
export const ACCT_DEEP = "#0c9f6e";

// ─── Danger ───────────────────────────────────────────────────────────────────
// Destructive actions (block, delete). Import this, never hardcode a red literal.
export const DANGER = "#E5484D";

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

// ─── Group roles ──────────────────────────────────────────────────────────────
// Badges beside a member's name on a group page. The OWNER keeps the brand
// green (they created the group); trainers and members get their own hues so
// the three are tellable apart at a glance, in both themes.
export const ROLE_OWNER   = ACCT;
export const ROLE_TRAINER = "#A78BFA";  // soft violet
export const ROLE_MEMBER  = "#60A5FA";  // soft blue

// ─── Paused ───────────────────────────────────────────────────────────────────
// A program on hold: the "Paused" badge and the Pause action. Deliberately a
// deeper orange than the bright yellow-orange WARMUP_ORANGE (#ffbf0f) that
// "Make Inactive" uses, so the two read as different actions at a glance.
export const PAUSED_ORANGE = "#FF9500";

// ─── Aurora (soft pastel gradient system) ─────────────────────────────────────
// Bubbly pastel accents built around the brand green, with an aqua and a blush
// counterpoint. Base colors are full-strength; surfaces fade them via gradient
// stop opacity so the same hex works in light and dark mode.
export const AURORA = {
  mint:  ACCT,
  aqua:  "#45c4f5",
  blush: "#ff9ec2",
} as const;

// Gradient orb buttons (Home quick actions). `glow` doubles as the shadow color.
// Green is deliberately softer than raw ACCT — at full saturation it shouts
// over its aqua/blush siblings, so it's pulled toward their pastel weight.
export const ORB_GRADS = {
  green: { colors: ["#a5f0d3", "#43dda6"] as const, glow: "#43dda6" },
  aqua:  { colors: ["#9ce0ff", "#3eb8f2"] as const, glow: "#3eb8f2" },
  blush: { colors: ["#ffc7db", "#f77fae"] as const, glow: "#f77fae" },
} as const;


// ─── Bubble pill ──────────────────────────────────────────────────────────────
// Small floating pill controls that sit on cards (SegmentedControl thumb,
// DropdownPicker triggers): white with a soft drop shadow in light mode, a
// lifted navy one step above NEU_BG_DARK in dark mode.
export const BUBBLE_LIGHT = "#FFFFFF";
export const BUBBLE_DARK  = "#363C5E";

// ─── Slate button ─────────────────────────────────────────────────────────────
// Dark slate-black for primary non-accent buttons (light mode bg).
// Off-white counterpart used in dark mode.
export const BTN_SLATE      = "#53545f";  // light mode: deep slate black
export const BTN_SLATE_DARK = APP_DARK.tp; // dark mode: app's existing off-white

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
