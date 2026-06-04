// Copy for the first-launch onboarding deck (app/onboarding.tsx).
// Slide visuals live in components/onboarding/mockups/*; this file only holds
// the words so headlines can be tweaked without touching layout code.

export type FeatureSlideId = "workout" | "program" | "progress" | "streak";

export interface FeatureSlideCopy {
  id: FeatureSlideId;
  title: string;
  subtitle: string;
}

export const WELCOME = {
  title: "Welcome to Avenas",
  subtitle: "Your workouts, programs and progress, all in one beautifully simple place.",
} as const;

// Terms of Service acceptance, recorded on the accept-terms step. Bump
// TERMS_VERSION to require re-acceptance after a material terms change.
export const TERMS_ACCEPTED_KEY = "@avenas/terms_accepted";
export const TERMS_VERSION = 1;

export const FEATURE_SLIDES: FeatureSlideCopy[] = [
  {
    id: "workout",
    title: "Log every set",
    subtitle: "Capture reps, weight and notes the moment you lift. Your whole session in one tap-friendly view.",
  },
  {
    id: "program",
    title: "Build your program",
    subtitle: "Design periodized cycles like Push, Pull, Legs and Rest, and Avenas lines up today's workout for you.",
  },
  {
    id: "progress",
    title: "Watch your strength climb",
    subtitle: "Per-exercise charts and weight trends turn every session into proof you're getting stronger.",
  },
  {
    id: "streak",
    title: "Keep the streak alive",
    subtitle: "Show up day after day, build your streak, and unlock new flames as the days stack up.",
  },
];
