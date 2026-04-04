---
name: review
description: >
  Code review skill for the Avenas app. Run this after writing or modifying any
  file to audit it against the project's quality standards before marking the task done.
  Invoke with /review [file] or just /review to audit recently changed files.
user-invocable: true
---

# /review — Code Review

When this skill is invoked:

1. Identify which files to review:
   - If the user specified a file path, review that file
   - Otherwise, identify all files modified in this conversation and review each

2. For each file, read it in full

3. Run through every category below and report findings:

---

## Review Categories

### 🔴 Critical (Must Fix Before Shipping)

**Error Handling**
- [ ] Every `AsyncStorage.getItem/setItem/removeItem` is inside a `try/catch`
- [ ] Every `JSON.parse` is inside a `try/catch` with shape validation
- [ ] No `.then()` calls without a `.catch()`
- [ ] Async functions that can fail have fallback state set on error

**TypeScript**
- [ ] Zero `any` types — flag every single one with its line number
- [ ] No type assertions (`as SomeType`) on unvalidated external data

**Crashes**
- [ ] No optional chaining missing on values that could be null/undefined at runtime
- [ ] No array access like `arr[0]` without checking arr.length first

### 🟡 Important (Fix Before This Feature Is Done)

**Architecture**
- [ ] No color/palette values hardcoded in screen files — must import APP_LIGHT/APP_DARK from theme.ts
- [ ] No business logic inline in JSX — complex expressions extracted to named variables
- [ ] No logic duplicated that already exists in a context, hook, or utility

**Loading States**
- [ ] Screens reading from context or storage show a loading state while data is absent
- [ ] The `isLoaded` flag from StreakContext is checked before rendering streak data

**React Patterns**
- [ ] State that can be derived is derived, not stored in useState
- [ ] Components in `components/` are wrapped in React.memo if they're pure

### 🔵 Polish (Fix in This Session if Easy)

**Performance**
- [ ] Event handlers passed as props to child components use useCallback
- [ ] Object-valued or expensive derived values use useMemo
- [ ] Dynamic lists use FlatList, not ScrollView + .map()

**Accessibility**
- [ ] All TouchableOpacity / BounceButton elements have accessibilityLabel
- [ ] accessibilityRole is set on interactive elements

---

## Output Format

Report results in this structure:

```
## Review: [filename]

🔴 CRITICAL
- Line 57: JSON.parse without try/catch — if storage is corrupt, app crashes on launch
- Line 125: AsyncStorage.getItem without .catch() — silent failure if storage unavailable

🟡 IMPORTANT  
- Lines 20-21: LIGHT/DARK palette defined here — should import APP_LIGHT/APP_DARK from theme.ts
- Line 37: useState initialised from tier.name before AsyncStorage loads — stale default

🔵 POLISH
- Line 116: isMax not memoized with useMemo — recalculated on every render
- Line 148: BounceButton missing accessibilityLabel

✅ PASSED
- Error handling in StreakContext
- All async ops wrapped in try/catch
- TypeScript types look clean
```

If a file is clean in a category, write `✅ [Category]: all good`.

After reviewing all files, give a one-paragraph summary of the overall code health
and the single most important thing to fix first.
