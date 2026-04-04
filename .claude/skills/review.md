---
name: review
description: >
  Code review skill for the Avenas app. Run this after writing or modifying any
  file to audit it against the project's quality standards before marking the task done.
  Invoke with /review [file] or just /review to audit all files changed in this conversation.
user-invocable: true
---

# /review — Code Review

## Step 1: Identify Files to Review

- If the user specified a file path, review that file
- Otherwise, identify all files created or modified in this conversation and review each one

## Step 2: Read Each File in Full

Use the Read tool to read the complete file before reviewing it.

## Step 3: Run the Review

For each file, work through every category below. Be specific — name the line number and the exact issue. Do not write generic observations.

---

## Security Checks

**S1 — Auth token storage**
- Search for `AsyncStorage.setItem` / `AsyncStorage.getItem` — flag any that store a token, password, or user credential. These must use `expo-secure-store` instead.

**S2 — No secrets in the bundle**
- Check for any hardcoded API keys, secrets, or credentials in the file. Flag any `EXPO_PUBLIC_*` variable that looks sensitive (tokens, private keys). Report: "Line X: [key name] looks sensitive — should be proxied server-side."

**S3 — Deep link / URL safety**
- If the file handles navigation or URLs, check that no tokens or session IDs are passed as URL parameters.

**S4 — JSON.parse safety**
- Find every `JSON.parse` call. Flag any that are not inside a try/catch with shape validation. Report exactly which line and what the risk is if the data is corrupt.

---

## Error Handling Checks

**E1 — Async operations**
- Find every `await` statement and every `.then()` call. Flag:
  - `await` outside a `try/catch` block
  - `.then()` without a corresponding `.catch()`
  - Report the line number, the operation, and what silently breaks on failure.

**E2 — Error boundaries**
- If the file is a screen component, check: does it wrap any complex or data-dependent sections in an ErrorBoundary? If not, flag it.

**E3 — Loading and error states**
- If the file reads from context, AsyncStorage, or an API: does it check `isLoaded` or equivalent? Does it render a placeholder while loading? Does it render something on error? Flag any case where the screen could be blank.

**E4 — Caught errors narrowed properly**
- Search for `catch (e)` or `catch (error)`. Flag any that use `e.message` without first checking `e instanceof Error`. Report: "Line X: error used without narrowing — crashes if e is not an Error object."

---

## TypeScript Checks

**T1 — No `any`**
- Grep the file for `: any`, `as any`, `<any>`. Report every occurrence with its line number. No exceptions.

**T2 — Function return types**
- Check functions and arrow functions for missing return types. Flag:
  - Async functions without `Promise<void>` or `Promise<T>`
  - Event handlers without `: void`
  - Any function that returns JSX without `: React.ReactNode` or `React.ReactElement`

**T3 — Typed routes**
- If the file uses `router.push`, `router.replace`, or `<Link href>`, check that string literals match actual route files. Prefer typed route objects `{ pathname: "/foo/[id]", params: { id } }`.

**T4 — Prop interfaces**
- Every component must have its props typed with an `interface` or `type`. Flag any component receiving inline object-typed props like `({ value, label }: { value: string; label: string })` for extracted props that are more than 2-3 fields.

---

## Performance Checks

**P1 — React.memo**
- If the file is in `components/` and exports a presentational component: is it wrapped in `React.memo`? If not, flag it unless the component clearly manages its own complex state.

**P2 — useCallback on passed handlers**
- Find every function defined inside the component body that is passed as a prop to a child component. Flag any that are not wrapped in `useCallback`. Report: "Line X: [handler name] is a new function reference on every render — child memo is defeated."

**P3 — useMemo for objects passed as props**
- Find derived values that are objects or arrays, passed as props to children. Flag any that create new references on every render without `useMemo`.

**P4 — FlatList vs ScrollView**
- Flag any `ScrollView` or `Animated.ScrollView` that contains a `.map()` over a list of more than ~10 dynamic items. Recommend FlashList.

**P5 — Deprecated patterns**
- Flag any `setNativeProps` usage — deprecated in New Architecture.
- Flag any `InteractionManager.runAfterInteractions` — consider `startTransition` instead.
- Flag any `expo-av` import — deprecated in SDK 54.

---

## Architecture Checks

**A1 — Colors from theme.ts only**
- Search for hex color literals (e.g. `"#2D3748"`, `"rgba(..."`) directly in the file. Flag every one. Exception: `NEU_BG` re-exported from NeuCard is acceptable. The fix is always to import from `constants/theme.ts`.

**A2 — No local LIGHT/DARK palette**
- Search for `const LIGHT =` or `const DARK =` defining a colour palette object. Flag it and report the fix: import `APP_LIGHT`/`APP_DARK` from `constants/theme`.

**A3 — Screen size**
- Count the lines. If the screen is over 200 lines, identify the most natural extraction point (largest self-contained UI block) and suggest a component name and file path.

**A4 — Business logic in JSX**
- Flag any JSX that contains conditional expressions longer than a simple ternary, arithmetic, or method calls. These belong in named variables above the return.

**A5 — Raw AsyncStorage in a screen**
- Flag any direct `AsyncStorage.getItem`/`setItem` in a screen component that isn't in a `useEffect`/`useFocusEffect` reading a preference. Data should flow through context or a dedicated hook.

---

## Accessibility Checks

**Ac1 — Interactive element triad**
- Find every `TouchableOpacity`, `Pressable`, and `BounceButton`. For each one, check:
  - Has `accessibilityRole` → flag if missing
  - Has `accessibilityLabel` with a meaningful description (not just "button") → flag if missing
  - Has `accessibilityHint` if the action isn't obvious → flag if missing
  - Has `accessibilityState={{ disabled: true }}` when visually disabled → flag if missing

**Ac2 — Font scaling**
- Search for `allowFontScaling={false}`. Flag every occurrence — this can cause App Store rejection.

**Ac3 — Touch target size**
- Flag any interactive element with a fixed size below 44×44 points. Check the StyleSheet for widths/heights on touchable containers.

**Ac4 — Decorative images**
- Flag any `Image` or `LottieView` that is purely decorative and not hidden from the accessibility tree with `aria-hidden={true}` or `accessibilityElementsHidden={true}`.

---

## Output Format

Report results for each file using this structure. Be specific — include line numbers and the actual code.

```
## Review: path/to/file.tsx

### 🔴 Critical — Fix Before Shipping
- [S4] Line 57: JSON.parse(raw) — not in try/catch. If storage is corrupt, app crashes on launch.
- [E1] Line 125: await AsyncStorage.getItem() is not in a try/catch. Silent failure leaves state undefined.

### 🟡 Important — Fix in This Session
- [A2] Lines 20–21: LIGHT/DARK palette defined locally. Import APP_LIGHT/APP_DARK from constants/theme.ts.
- [T1] Line 34: route: any — define a Route interface or use Expo Router typed routes.
- [P2] Line 118: handlePress defined inside component without useCallback — defeats React.memo on BounceButton.

### 🔵 Polish — Fix When Convenient
- [Ac1] Line 148: BounceButton missing accessibilityLabel and accessibilityRole.
- [P1] NeuCard not wrapped in React.memo — re-renders unnecessarily when parent re-renders.

### ✅ Clean
- Error handling in StreakContext: all AsyncStorage ops in try/catch with shape validation.
- TypeScript: no `any` types found.
- Colors: correctly imported from theme.ts.
```

If a category is entirely clean, write one `✅ [Category]: no issues` line — do not list each check individually.

---

## Final Summary

After reviewing all files, write:

1. **Overall health** — one sentence: "X critical issues, Y important issues, Z polish items across N files."
2. **Fix first** — the single most important issue to address right now and why.
3. **Pattern to watch** — one recurring pattern across multiple files worth establishing as a habit.
