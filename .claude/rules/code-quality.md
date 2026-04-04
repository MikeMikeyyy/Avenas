# Code Quality Standards — Avenas

These rules apply to every file touched in this project. No exceptions.
Read this before writing or modifying any code.

---

## Non-Negotiables

### 1. Error Handling — Every Async Operation

Every AsyncStorage read/write must be in a try/catch. Never leave a silent failure.

```tsx
// ❌ WRONG — silent failure if storage fails
const value = await AsyncStorage.getItem(KEY);

// ✅ CORRECT
try {
  const value = await AsyncStorage.getItem(KEY);
} catch (e) {
  console.error("[Storage] Failed to read KEY:", e);
  // Set safe defaults, show error state
}
```

Never use `.then()` without a `.catch()`.

```tsx
// ❌ WRONG
AsyncStorage.getItem(KEY).then(v => setName(v));

// ✅ CORRECT
AsyncStorage.getItem(KEY).then(v => setName(v)).catch(() => {/* safe default */});
```

### 2. JSON.parse — Always Guard

Wrap JSON.parse in try/catch AND check the shape of the parsed value.

```tsx
// ❌ WRONG — crashes on corrupt storage
const data: MyType = JSON.parse(raw);

// ✅ CORRECT
let data: MyType | null = null;
try {
  const parsed = JSON.parse(raw);
  // Validate the critical fields exist and are the right type
  if (parsed && typeof parsed.count === "number") {
    data = parsed as MyType;
  }
} catch {
  // Corrupt data — proceed with defaults
}
```

### 3. TypeScript — No `any`

No `any` types anywhere. Ever. If a third-party type is complex, create a minimal interface.
If you genuinely don't know the type, use `unknown` and narrow it.

```tsx
// ❌ WRONG
function renderIcon(color: any) { ... }
const route: any = state.routes[i];

// ✅ CORRECT
function renderIcon(color: string): React.ReactNode { ... }
const route: { name: string; key: string } = state.routes[i];
```

All functions need explicit return types:
```tsx
// ❌ async function without return type
const selectFlame = async (name: string) => { ... }

// ✅ explicit
const selectFlame = async (name: string): Promise<void> => { ... }
```

### 4. Loading States — No Invisible Waits

Any component that reads from AsyncStorage, context, or an API must handle the
loading state. The `isLoaded` flag on StreakContext exists for this reason.

```tsx
const { streakDays, isLoaded } = useStreak();
if (!isLoaded) return <LoadingPlaceholder />;
```

---

## Architecture Standards

### Centralised Colors — Import from theme.ts Only

All app colors live in `constants/theme.ts`. Never redefine the light/dark palette
inside a screen file. Import `APP_LIGHT` and `APP_DARK` and derive `t` from them.

```tsx
// ❌ WRONG — copy-pasted into every screen
const LIGHT = { bg: "#e8ecf3", tp: "#2D3748", ts: "#8896A7" };
const DARK  = { bg: "#272930", tp: "#E8ECF3", ts: "#8896A7" };

// ✅ CORRECT
import { APP_LIGHT, APP_DARK } from "../../constants/theme";
const t = isDark ? APP_DARK : APP_LIGHT;
```

### Screen Size Limit — 200 Lines

If a screen file exceeds 200 lines, extract sub-components before adding more.
Look for natural boundaries: named card sections, repeated render patterns, 
standalone UI widgets. Extract to `components/` or co-locate next to the screen.

### No Business Logic in JSX

Complex expressions belong in named variables above the `return`:

```tsx
// ❌ WRONG — unreadable and untestable
<Text>{isMax ? 1 : (days - tier.min) / ((tier.next as number) - tier.min)}</Text>

// ✅ CORRECT
const progress = isMax ? 1 : (days - tier.min) / ((tier.next as number) - tier.min);
<Text>{progress}</Text>
```

### Storage Access — Always Abstracted

Never write raw AsyncStorage calls in screen components. Use context (like
StreakContext) or a dedicated hook. If a new storage key is needed, add it to
the relevant context or create a small `useStoredValue(key, default)` hook.

---

## Performance Standards

### React.memo on Pure Components

Every component in `components/` that only renders based on props must be wrapped:

```tsx
export default React.memo(NeuCard);
export default React.memo(BounceButton);
```

Skip React.memo only if the component manages its own internal state heavily
or is always re-rendered by design.

### useCallback for Handlers Passed as Props

```tsx
// ❌ WRONG — new function object every render
<BounceButton onPress={() => router.push("/streak")} />

// ✅ CORRECT
const handleStreakPress = useCallback(() => router.push("/streak"), [router]);
<BounceButton onPress={handleStreakPress} />
```

### useMemo for Derived Values That Are Expensive or Objects

```tsx
// ❌ — new object reference on every render, breaks memo downstream
const t = isDark ? DARK : LIGHT;

// ✅
const t = useMemo(() => isDark ? APP_DARK : APP_LIGHT, [isDark]);
```

### FlatList for Dynamic Lists

Use `FlatList` instead of `ScrollView + .map()` for any list fetched from
state, API, or that could grow. Static lists of ≤10 hardcoded items are fine
as `.map()`.

---

## Accessibility Standards

Every interactive element needs `accessibilityLabel` and `accessibilityRole`:

```tsx
// ❌ WRONG — screen reader says nothing useful
<BounceButton onPress={handlePress}>

// ✅ CORRECT
<BounceButton
  onPress={handlePress}
  accessibilityLabel="View your streak details"
  accessibilityRole="button"
>
```

For flame options, destructive actions, and navigation buttons — always label them.
`BounceButton` must forward these props to the underlying `TouchableOpacity`.

---

## Pre-Ship Checklist (Run Before Marking Any Task Done)

```
ERROR HANDLING
[ ] All async operations have try/catch with a safe fallback
[ ] JSON.parse is guarded with try/catch and shape validation
[ ] No .then() without .catch()
[ ] Loading states exist for all async-loaded data

TYPESCRIPT
[ ] Zero `any` types in changed files
[ ] All functions have explicit return types
[ ] Props are typed with interface or type alias (no inline object types on component params)

ARCHITECTURE
[ ] No colors or palette objects hardcoded in screen files — imported from theme.ts
[ ] No logic duplicated that exists elsewhere in the codebase
[ ] Screen file under 200 lines, or sub-components extracted

PERFORMANCE
[ ] Pure presentational components in components/ wrapped in React.memo
[ ] Event handlers passed as props use useCallback
[ ] Object-valued derived state uses useMemo

ACCESSIBILITY
[ ] All touchable elements have accessibilityLabel
[ ] accessibilityRole is set (button, link, image, etc.)
```
