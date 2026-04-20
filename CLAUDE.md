# Avenas

iOS-first React Native + Expo (SDK 54, New Architecture) + TypeScript strict. Expo Router + NativeTabs. EAS Build. Already shipped to App Store.

## Principles

- **Simple, minimal, native-first.** No Tailwind, no styled-components — StyleSheet only. Root-cause fixes, no patches.
- **Liquid Glass on functional surfaces** (nav, tabs, cards, buttons, modals) — not everything. Guard every `GlassView` with `isGlassEffectAPIAvailable()` and provide an rgba fallback. Never set opacity on glass.
- **Safe areas via `useSafeAreaInsets`** — never hardcode `paddingTop: 44`.
- **Colors from `constants/theme.ts`** — no hex literals in screens. `ACCT`, `APP_LIGHT`, `APP_DARK`, `NEU_BG` live there.
- **TypeScript strict** — no `any`, type component props, narrow `unknown` in catch blocks.
- **Packages:** `npx expo install` (never `npm install`).

## Conventions

- Screens in `app/` (Expo Router). Reusable components in `components/`. One component per file; file name matches component.
- Lists: `FlashList`, not `FlatList` or `ScrollView + .map`.
- Images: `expo-image`, not core `Image`.
- Tokens/secrets: `expo-secure-store`, not AsyncStorage.
- `React.memo` + `useCallback` on components that receive stable props from re-rendering parents. `useMemo` for objects passed to memoized children.
- Every async op in try/catch with a user-visible error state.

## Workflow

- For 3+ step or architectural work: write a short plan, confirm with user before building.
- On correction: fix the pattern, don't repeat the mistake.
- Verify before presenting: types, glass guard+fallback, safe-area insets, no hardcoded colors.
- Summarise briefly — no wall of explanation.

## Skills (load on demand)

- `liquid-glass-rn` — patterns for `GlassCard`, `GlassNavBar`, `GlassButton`, `GlassModal`, merging pills.
- Other Expo skills (deployment, api-routes, upgrading, etc.) are available when relevant.
