---
description: UI consistency, visual standards, and liquid glass design rules for Avenas
---

## Visual Language

- Every screen must feel premium and native iOS — no generic cross-platform look
- Liquid glass is the core design material — use it on every UI surface (see skill file)
- Backgrounds should be rich and colourful — liquid glass needs interesting content behind it to refract properly, it looks nearly invisible on plain white/black
- Use SF Symbols for all icons on iOS via NativeTabs — they integrate with the native tab bar automatically
- Rounded corners everywhere — cards at 20px, buttons at 50px (pill shape), modals at 24px

## Spacing & Layout

- Always use `useSafeAreaInsets` for padding around headers and nav bars — never hardcode padding values for notches or home indicators
- Use consistent spacing tokens from `constants/` — don't scatter magic numbers through components
- Mobile-first — design for iPhone screen sizes, then consider iPad

## Typography

- Use the system font (San Francisco on iOS) — don't import custom fonts unless explicitly requested
- Headings: fontWeight '700', body: '400', labels: '600'
- Text on glass surfaces should be white or very light — glass backgrounds are semi-transparent

## Colour

- Define all colours in `constants/theme.ts` — never hardcode hex values in components
- Support both light and dark mode from the start using the `system` colour scheme
- Glass tint colour should use `glassEffectStyle="regular"` as default — only use `"clear"` for very subtle overlays

## Don't

- Don't use Tailwind — this is React Native, use StyleSheet
- Don't re-implement native iOS components in JS — use native ones via Expo
- Don't apply liquid glass to every single element — reserve it for functional surfaces (nav, tabs, cards, buttons, modals). Overuse kills the effect.
- Don't set opacity on GlassView or its parents — use the built-in `animate` and `animationDuration` props instead
