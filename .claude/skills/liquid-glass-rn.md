---
name: liquid-glass-rn
description: >
  Apply Apple's iOS 26 Liquid Glass effect to React Native / Expo apps.
  Use this skill whenever building or modifying ANY UI component in the Avenas
  app — nav bars, tab bars, cards, panels, buttons, modals, headers, floating
  elements. This is mandatory for all UI work on this project. Read this before
  writing any component code.
---

# Liquid Glass — React Native & Expo

## What It Is

Liquid Glass is Apple's native design material for iOS 26+. It refracts and
lenses the content behind it using GPU-accelerated shaders — it is NOT a blur
or rgba trick. It only works on real iOS 26 builds, not in Expo Go. This is
expected. Write the code correctly here and it works in the App Store build.

---

## Install

```bash
npx expo install expo-glass-effect
```

---

## The Golden Rule

Always guard GlassView with `isGlassEffectAPIAvailable()` and always provide
an rgba fallback. Never skip either step.

```tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
```

---

## Component Patterns

### GlassCard — Cards & Panels

```tsx
// components/GlassCard.tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';

interface GlassCardProps {
  children: React.ReactNode;
  style?: object;
}

export default function GlassCard({ children, style }: GlassCardProps) {
  if (!isGlassEffectAPIAvailable()) {
    return <View style={[styles.fallback, style]}>{children}</View>;
  }
  return (
    <GlassView glassEffectStyle="regular" style={[styles.card, style]}>
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
  },
  fallback: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
```

---

### GlassNavBar — Header / Nav Bar

```tsx
// components/GlassNavBar.tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GlassNavBarProps {
  title: string;
}

export default function GlassNavBar({ title }: GlassNavBarProps) {
  const insets = useSafeAreaInsets();
  const isGlass = isGlassEffectAPIAvailable();
  const Container = isGlass ? GlassView : View;
  const extraProps = isGlass
    ? { glassEffectStyle: 'regular' as const }
    : { style: { backgroundColor: 'rgba(255,255,255,0.12)' } };

  return (
    <Container
      {...extraProps}
      style={[styles.navbar, { paddingTop: insets.top + 8 }]}
    >
      <Text style={styles.title}>{title}</Text>
    </Container>
  );
}

const styles = StyleSheet.create({
  navbar: {
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
```

---

### NativeTabs — Tab Bar (automatic liquid glass)

```tsx
// app/(tabs)/_layout.tsx
import { NativeTabs, NativeTab } from 'expo-router/native-tabs';

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTab
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: { sfSymbol: 'house.fill' },
        }}
      />
      <NativeTab
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: { sfSymbol: 'magnifyingglass' },
        }}
      />
    </NativeTabs>
  );
}
```

> iOS 26: automatic liquid glass tab bar
> iOS 18 and below: classic iOS tab bar
> Android: Material 3 automatically

---

### GlassButton — Buttons

```tsx
// components/GlassButton.tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Pressable, Text, StyleSheet, View } from 'react-native';

interface GlassButtonProps {
  label: string;
  onPress: () => void;
}

export default function GlassButton({ label, onPress }: GlassButtonProps) {
  const isGlass = isGlassEffectAPIAvailable();
  return (
    <Pressable onPress={onPress}>
      {isGlass ? (
        <GlassView glassEffectStyle="regular" style={styles.button}>
          <Text style={styles.label}>{label}</Text>
        </GlassView>
      ) : (
        <View style={[styles.button, styles.fallback]}>
          <Text style={styles.label}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  label: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
```

---

### GlassModal — Modals & Bottom Sheets

```tsx
// components/GlassModal.tsx
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Modal, View, StyleSheet } from 'react-native';

interface GlassModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function GlassModal({ visible, onClose, children }: GlassModalProps) {
  const isGlass = isGlassEffectAPIAvailable();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {isGlass ? (
          <GlassView glassEffectStyle="regular" style={styles.panel}>
            {children}
          </GlassView>
        ) : (
          <View style={[styles.panel, styles.fallback]}>
            {children}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    width: '85%',
    borderRadius: 24,
    padding: 24,
    overflow: 'hidden',
  },
  fallback: {
    backgroundColor: 'rgba(30,30,30,0.85)',
  },
});
```

---

## Rules

| Rule | Detail |
|------|--------|
| Always guard | `isGlassEffectAPIAvailable()` before every GlassView |
| Always fallback | rgba View for Android and iOS < 26 |
| Never opacity | Don't set opacity on GlassView or parents — use `animate` + `animationDuration` props |
| Always overflow hidden | Add `overflow: 'hidden'` to GlassView containers |
| Use NativeTabs | Never use plain `Tabs` for tab bars — NativeTabs is automatic |
| Rich backgrounds | Glass needs colourful/image content behind it — plain white makes it invisible |
| Use sparingly | Only on functional surfaces: nav, tabs, cards, buttons, modals |

## glassEffectStyle Values

| Value | Use |
|-------|-----|
| `"regular"` | Standard frosted glass — default for all components |
| `"clear"` | More transparent — subtle overlays only |
| `"none"` | No effect — transparent view |
