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
} as const;

export const APP_DARK = {
  bg:   "#1B1E2C",
  tp:   "#E4E6F0",  // slightly blue-tinted white
  ts:   "#6B7396",  // muted blue-gray
  icon: "#8B93AE",  // navy-tinted icon
  div:  "#252840",  // dark navy divider
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
