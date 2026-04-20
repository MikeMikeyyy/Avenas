---
name: liquid-glass-rn
description: Apple iOS 26 Liquid Glass patterns for React Native / Expo. Use when building or modifying any UI surface (nav, tabs, cards, buttons, modals).
---

# Liquid Glass — Avenas

Only works on real iOS 26 builds, not Expo Go. Write it right here; ships correctly in App Store build.

```bash
npx expo install expo-glass-effect
```

## Golden Rule

Always guard with `isGlassEffectAPIAvailable()`, always provide rgba fallback, never set opacity on `GlassView`.

```tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
```

## Canonical Card

```tsx
export default function GlassCard({ children, style }: { children: React.ReactNode; style?: object }) {
  if (!isGlassEffectAPIAvailable()) {
    return <View style={[styles.fallback, style]}>{children}</View>;
  }
  return (
    <GlassView glassEffectStyle="regular" style={[styles.card, style]}>{children}</GlassView>
  );
}
const styles = StyleSheet.create({
  card:     { borderRadius: 20, padding: 16, overflow: 'hidden' },
  fallback: { borderRadius: 20, padding: 16, backgroundColor: 'rgba(255,255,255,0.15)' },
});
```

Same pattern for nav bar (add `paddingTop: insets.top + 8`), button (`borderRadius: 50`), modal (`borderRadius: 24`).

## Tab Bar — use NativeTabs, never `Tabs`

```tsx
import { NativeTabs, NativeTab } from 'expo-router/native-tabs';
// iOS 26: automatic liquid glass. iOS 18-: classic. Android: Material 3.
```

## Rules

| Rule | Detail |
|---|---|
| Guard | `isGlassEffectAPIAvailable()` before every `GlassView` |
| Fallback | rgba View for Android / iOS < 26 |
| No opacity | Use `animate` + `animationDuration` props, never CSS opacity on glass or its parents |
| Overflow | `overflow: 'hidden'` on glass containers |
| Use sparingly | Functional surfaces only — overuse kills the effect |
| Rich bg behind | Glass needs colourful content behind it to refract |

## `glassEffectStyle`

- `"regular"` — default frosted glass
- `"clear"` — subtle overlays only
- `"none"` — transparent

## Merging Pills — `@callstack/liquid-glass`

Use when multiple glass shapes must **merge** as they move (sliding pill nav, morphing buttons). Requires RN 0.80+, iOS 26.

```tsx
import { LiquidGlassView, LiquidGlassContainerView, isLiquidGlassSupported } from '@callstack/liquid-glass';

<LiquidGlassContainerView spacing={12}>
  <LiquidGlassView effect="regular" style={bar} />
  <Animated.View style={{ transform: [{ translateX }] }}>
    <LiquidGlassView effect="clear" interactive style={pill} />
  </Animated.View>
</LiquidGlassContainerView>
```

- `spacing` 8–16 works for nav bars
- Tab items/labels go in a separate absolute-positioned View on top, not inside glass layers
- `isLiquidGlassSupported` is a boolean constant (not a function)
- Always provide a fallback — on unsupported iOS it renders a plain transparent View
