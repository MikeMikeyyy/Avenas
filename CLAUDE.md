# Avenas

iOS-first React Native + Expo (SDK 54, New Architecture) + TypeScript strict. Expo Router + NativeTabs. EAS Build. Shipped to App Store.

## Principles

- **Simple, minimal, native-first.** No Tailwind, no styled-components — StyleSheet only. Root-cause fixes, no patches.
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

## Design Language (reuse — don't invent)

When building a new page, match the existing visual language. Don't introduce new card styles, button shapes, or spacing scales.

- **Cards:** `NeuCard` (`components/NeuCard.tsx`) for all cards. Radius 10–20. `shadowSize` "sm" for inner rows, default for top-level.
- **Buttons:** `BounceButton` (`components/BounceButton.tsx`) wraps tappable things. Primary accent buttons use `ACCT` bg + `ACCT` shadow glow.
- **Liquid Glass:** only for functional surfaces (nav, tabs, modal chrome). Always guard with `isGlassEffectAPIAvailable()` and provide rgba fallback. Never set opacity on `GlassView` or its parents. `overflow: 'hidden'` on glass containers.
- **Tabs:** `NativeTabs` from `expo-router/native-tabs` — iOS 26 gets auto glass. For in-screen segmented controls, reuse the sliding-pill pattern from the workout timer modal (Reanimated shared value + `interpolateColor` on labels).
- **Bottom sheets:** drag handle is `width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(128,128,128,0.4)"`. Always.
- **Icons:** dumbbell → 3-path SVG `WorkoutIcon` (see `app/(tabs)/_layout.tsx`), not Ionicons `barbell-outline`. Trash → `components/TrashIcon.tsx`, not Ionicons `trash-outline`. Other icons from Ionicons are fine.
- **Animations:** Reanimated for anything on the UI thread. `withSpring` for tab pills, `withTiming` for expand/collapse. Haptics on every primary tap (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`).
- **Spacing:** gaps and padding in multiples of 4. Card padding usually 14–16.

If a new page needs a pattern that doesn't exist yet, ask before designing it.

## Workflow

- For 3+ step or architectural work: write a short plan, confirm with user before building.
- On correction: fix the pattern, don't repeat the mistake.
- Verify before presenting: types, glass guard+fallback, safe-area insets, no hardcoded colors.
- Summarise briefly — no wall of explanation.
