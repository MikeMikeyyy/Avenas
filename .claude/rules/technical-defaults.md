---
description: Technical stack defaults and coding standards for the Avenas React Native app
---

## Stack

- **Language:** TypeScript — always, no plain JS files
- **Framework:** React Native + Expo managed workflow
- **Navigation:** Expo Router (file-based routing) with NativeTabs for tab bars
- **Styling:** React Native StyleSheet — no Tailwind, no styled-components
- **Package installs:** Always `npx expo install` not `npm install`

## TypeScript Standards

- Always type component props with an interface or type alias
- No `any` types — if you don't know the type, figure it out
- Use optional chaining `?.` and nullish coalescing `??` where appropriate
- Export types alongside components when they'll be reused

## Component Standards

- One component per file
- File name matches the component name (e.g. `GlassCard.tsx` exports `GlassCard`)
- All reusable components live in `components/`
- Screen-specific components can live alongside the screen file
- Always destructure props at the top of the component

## Liquid Glass Standard (enforced)

Every component that renders a surface must:
1. Import `isGlassEffectAPIAvailable` from `expo-glass-effect`
2. Check availability before rendering `GlassView`
3. Provide an `rgba` fallback View for unsupported platforms
4. Never set opacity directly on a GlassView

## Safe Areas

- Always import `useSafeAreaInsets` from `react-native-safe-area-context`
- Apply top inset to headers and nav bars
- Apply bottom inset to tab bars and floating buttons
- Never hardcode values like `paddingTop: 44` — these vary by device

## Error Handling

- Wrap async operations in try/catch
- Show user-friendly error states — never let the screen go blank on failure
- Log errors clearly for debugging

## Performance

- Use `React.memo` for components that receive stable props
- Avoid inline functions in render where possible for list items
- Use `FlatList` not `ScrollView` + `.map()` for lists of dynamic data
