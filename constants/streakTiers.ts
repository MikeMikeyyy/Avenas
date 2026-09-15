const LOTTIE_ORANGE = require("../assets/lottie/streak-flame-orange.json");
const LOTTIE_GREEN  = require("../assets/lottie/streak-flame-green.json");
const LOTTIE_BLUE   = require("../assets/lottie/streak-flame-blue.json");
const LOTTIE_PURPLE = require("../assets/lottie/streak-flame-purple.json");
const LOTTIE_RED    = require("../assets/lottie/streak-flame-red.json");

export interface StreakTier {
  name: string;
  color: string;
  min: number;
  next: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lottie: any;
}

/**
 * `color` is the tier's UI accent — the progress bar, the day-cell background,
 * milestone text, the Home badge. It is the DEEP BASE of that tier's flame
 * gradient (the flames run pale tip → mid → base), so the artwork and the
 * chrome around it read as one colour. Change a flame and this must move with
 * it, or the two drift apart.
 */
export const STREAK_TIERS: StreakTier[] = [
  { name: "Orange", color: "#FF5300", min: 0,  next: 10,   lottie: LOTTIE_ORANGE },
  { name: "Green",  color: "#00FFDB", min: 10, next: 20,   lottie: LOTTIE_GREEN  },
  { name: "Blue",   color: "#0087FF", min: 20, next: 30,   lottie: LOTTIE_BLUE   },
  { name: "Purple", color: "#8400FF", min: 30, next: 40,   lottie: LOTTIE_PURPLE },
  { name: "Red",    color: "#E60037", min: 40, next: null, lottie: LOTTIE_RED    },
];

export const MAX_TIER_DAYS = 40;

export const FLAME_PREF_KEY = "avenas_flame_preference";

export function getTier(days: number): StreakTier {
  return (
    STREAK_TIERS.find(t =>
      t.next === null
        ? days >= t.min
        : days >= t.min && days < (t.next as number)
    ) ?? STREAK_TIERS[0]
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStreakLottie(days: number): any {
  return getTier(days).lottie;
}
