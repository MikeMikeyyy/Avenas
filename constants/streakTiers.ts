const LOTTIE_ORANGE = require("../assets/lottie/Fire Streak Orange.json");
const LOTTIE_GREEN  = require("../assets/lottie/Streak Fire Green.json");
const LOTTIE_BLUE   = require("../assets/lottie/Streak Fire Blue.json");
const LOTTIE_PURPLE = require("../assets/lottie/Streak Fire Purple.json");
const LOTTIE_RED    = require("../assets/lottie/Fire Streak Red.json");

export interface StreakTier {
  name: string;
  color: string;
  min: number;
  next: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lottie: any;
}

export const STREAK_TIERS: StreakTier[] = [
  { name: "Orange", color: "#FF6B4A", min: 0,  next: 10,   lottie: LOTTIE_ORANGE },
  { name: "Green",  color: "#1deca0", min: 10, next: 20,   lottie: LOTTIE_GREEN  },
  { name: "Blue",   color: "#00B4FF", min: 20, next: 30,   lottie: LOTTIE_BLUE   },
  { name: "Purple", color: "#A855F7", min: 30, next: 40,   lottie: LOTTIE_PURPLE },
  { name: "Red",    color: "#FF2D55", min: 40, next: null, lottie: LOTTIE_RED    },
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
