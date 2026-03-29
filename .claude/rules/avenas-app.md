---
description: Project context, stack, and conventions for the Avenas React Native iOS app
---

## Project Overview

- **App name:** Avenas
- **Platform:** iOS App Store (primary), Android (secondary)
- **Stack:** React Native + Expo (managed workflow) + TypeScript
- **Navigation:** Expo Router with NativeTabs for tab bars
- **Build & submission:** EAS Build — compiles the app in the cloud without needing a Mac or Xcode locally

## Key Context

- App has already been submitted to the App Store — updates go through EAS Build then a new App Store submission
- Testing is on a physical iPhone via Expo Go or a dev build
- Expo Go will NOT show native effects like Liquid Glass — this is expected and fine
- Liquid Glass effects only appear on the final App Store build running iOS 26+
- Always read `.claude/skills/liquid-glass-rn.md` before writing any UI component

## File Structure

```
avenas/
├── app/                    # Expo Router screens and layouts
│   ├── (tabs)/             # Tab-based screens
│   │   ├── _layout.tsx     # NativeTabs config — always use NativeTabs not Tabs
│   │   └── index.tsx       # Home screen
│   └── _layout.tsx         # Root layout
├── components/             # Reusable components (GlassCard, GlassButton, GlassNavBar etc)
├── assets/                 # Images, fonts, icons
├── constants/              # Theme colours, spacing tokens
└── .claude/                # Claude config (rules, skills)
```

## Liquid Glass — Default But User Can Override

Every UI surface uses liquid glass by default. However, if the user explicitly
says they don't want glass on something, respect that immediately — no pushback,
no questions. The user's instruction always wins.

Examples of valid overrides:
- "make this a plain white card, no glass"
- "I don't want glass on this button"
- "skip the glass effect here"

When overridden, use a clean standard View with appropriate styling instead.

Default liquid glass targets:

| Component | Implementation |
|-----------|---------------|
| Tab bar | NativeTabs (automatic on iOS 26) |
| Nav bar / header | GlassView wrapper |
| Cards & panels | GlassView wrapper |
| Buttons | GlassView wrapper |
| Modals & sheets | GlassView wrapper |

Always include rgba fallbacks for Android and iOS < 26.
Always guard with `isGlassEffectAPIAvailable()` before rendering GlassView.

## Installing Packages

Always use `npx expo install` — never `npm install` — so Expo picks the compatible version automatically.
