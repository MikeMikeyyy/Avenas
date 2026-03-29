---
description: How to plan, build, verify, and iterate when working on the Avenas app
---

## Default Workflow for Any Task

1. **Read context first** — before writing any code, read `avenas-app.md` and `liquid-glass-rn.md`
2. **Plan** — for any task with 3+ steps, write a short plan with checkable items before touching code
3. **Confirm** — check in with the user before starting implementation on anything architectural
4. **Build** — write the code, apply liquid glass to every UI surface
5. **Verify** — review your own output before presenting it:
   - Is the TypeScript typed correctly?
   - Does every GlassView have a fallback and an `isGlassEffectAPIAvailable()` guard?
   - Are safe area insets applied where needed?
   - Does it follow the file structure in `avenas-app.md`?
6. **Summarise** — give a brief plain-English explanation of what was built and why

## When Creating a New Screen

1. Create the file in `app/` following Expo Router conventions
2. Import and apply `useSafeAreaInsets` for any header or nav bar
3. Use `GlassView` for all cards, panels, and surfaces
4. Add the screen to the tab navigator in `app/(tabs)/_layout.tsx` if it's a tab

## When Creating a New Component

1. Create the file in `components/` named after the component
2. Define a TypeScript interface for props
3. Apply liquid glass using the patterns in `.claude/skills/liquid-glass-rn.md`
4. Export the component as default and the props type as a named export

## When a Bug is Reported

1. Read the error message fully before doing anything
2. Trace it to the root cause — don't patch the symptom
3. Fix it properly
4. Confirm the fix resolves the original error without introducing new ones
5. Briefly explain what caused it and what was changed

## When Something Goes Wrong Mid-Task

- STOP immediately
- Re-read the plan
- Identify where it went wrong
- Propose a corrected approach before continuing
- Don't push broken code and hope it works out

## Verification Checklist (run before every output)

- [ ] TypeScript types in place
- [ ] GlassView guarded with `isGlassEffectAPIAvailable()`
- [ ] Fallback View with rgba background provided
- [ ] Safe area insets used where relevant
- [ ] Package installed with `npx expo install` if new dependency added
- [ ] No hardcoded colours (use constants/)
- [ ] No `any` types
- [ ] File in the correct directory per project structure
