# Avenas

iOS-first React Native + Expo (SDK 54, New Architecture), TypeScript strict. Expo Router + NativeTabs. Shipped to App Store.

## Non-obvious rules

- **StyleSheet only** — no Tailwind, no styled-components.
- **Packages: `npx expo install`**, never `npm install`.
- **Lists:** `FlashList`. **Images:** `expo-image`. **Secrets/tokens:** `expo-secure-store` (not AsyncStorage).
- **Colors:** `constants/theme.ts` (`ACCT`, `APP_LIGHT`, `APP_DARK`, `NEU_BG`) — no hex literals in screens.
- **Safe areas:** `useSafeAreaInsets()` — never hardcode inset values.

## Components to reuse

- **Cards:** `NeuCard`. **Buttons:** `BounceButton` (primary = `ACCT` bg + `ACCT` shadow glow).
- **Liquid Glass:** only on functional surfaces (nav/tabs/modal chrome). Always guard with `isGlassEffectAPIAvailable()` + rgba fallback. Never set `opacity` on `GlassView` or its parents. `overflow: 'hidden'` on glass containers.
- **Animations:** Reanimated on UI thread. Haptics (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`) on every primary tap.

## Workflow

- 3+ step or architectural work: short plan, confirm before building.
- Root-cause fixes, no patches. No hardcoded colors/insets.
