# Code Quality Standards — Avenas
# Based on: React Native docs, Expo docs, Callstack, Shopify Engineering, mrousavy
# Stack: Expo SDK 54 · React Native 0.76 (New Architecture) · TypeScript strict · Expo Router

Read this before writing or modifying any code.

---

## 1. Security

### Auth Tokens and Sensitive Data — Use expo-secure-store

AsyncStorage is **unencrypted plain text on disk**. Never store tokens, passwords,
or sensitive user data in it. Use `expo-secure-store` (iOS Keychain / Android Keystore).

```tsx
// ❌ WRONG — token written to plain text
await AsyncStorage.setItem("token", jwt);

// ✅ CORRECT — hardware-backed encryption
import * as SecureStore from "expo-secure-store";
await SecureStore.setItemAsync("token", jwt);
```

**SecureStore gotchas to know:**
- 2048-byte per-value limit on some iOS versions — store tokens, not serialised objects
- Data persists across app reinstalls (don't rely on this behaviour, but be aware)
- Keys become inaccessible if user re-enrols biometrics when `requireAuthentication: true`
- Use async variants (`setItemAsync`, `getItemAsync`) — sync variants block the JS thread

**AsyncStorage is fine for:** theme preference, UI state, non-sensitive cache.

### No Secrets in the Bundle

`EXPO_PUBLIC_*` vars are embedded in the JS bundle at build time — any user can
read them. API keys that must exist client-side must go through a server proxy.
Secret-tier EAS variables are for build-time use only (CI tokens, signing certs).

### Deep Links — Never Put Tokens in URLs

URLs appear in logs, can be intercepted by other apps (custom `myapp://` schemes
have no OS ownership verification). Use Universal Links (`https://` backed by
`.well-known/apple-app-site-association`). Never include tokens, session IDs,
or sensitive params in URLs — use short-lived opaque codes exchanged server-side.

For OAuth: use PKCE via `expo-auth-session`. It is handled automatically.

---

## 2. Error Handling

### Every Async Operation Has try/catch

```tsx
// ❌ WRONG — silent failure
const value = await AsyncStorage.getItem(KEY);
AsyncStorage.getItem(KEY).then(v => setState(v));

// ✅ CORRECT
try {
  const value = await AsyncStorage.getItem(KEY);
  setState(value);
} catch (e) {
  console.error("[Storage] Read failed:", e);
  // Set safe default
}
```

### JSON.parse — Guard and Validate Shape

```tsx
// ❌ WRONG — crashes on corrupt storage
const data: StreakData = JSON.parse(raw);

// ✅ CORRECT
let data: StreakData | null = null;
try {
  const parsed: unknown = JSON.parse(raw);
  if (isValidStreakData(parsed)) {  // type guard checks required fields
    data = parsed;
  }
} catch {
  // corrupt — use defaults
}
```

### Three-Tier Error Boundary Pattern

React error boundaries catch render errors only. Async errors need a bridge.
Use `react-error-boundary` package.

```
Root boundary     → catastrophic failures, shows "restart" screen
Screen boundary   → per-screen, has router context for "go back"  
Feature boundary  → isolates complex widgets, rest of screen stays alive
```

```tsx
// Screen-level boundary with navigation recovery
import { ErrorBoundary } from "react-error-boundary";

function ScreenErrorBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ErrorScreen
          error={error}
          onRetry={resetErrorBoundary}
          onGoBack={() => { resetErrorBoundary(); router.back(); }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
```

**Surfacing async errors into a boundary:**
```tsx
function useErrorHandler() {
  const [, setState] = useState<void>();
  return useCallback((error: Error) => {
    setState(() => { throw error; }); // forces boundary to catch it
  }, []);
}
```

### Async State — Use a Discriminated Union

```tsx
type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };
```

Never show a blank screen while loading — always render a loading placeholder.
Every component that reads async data must handle all four states.

---

## 3. TypeScript

### `strict: true` is Already On — Honour It

The tsconfig has `strict: true`. This enables `strictNullChecks` (the most
impactful flag — forces handling of null/undefined at compile time),
`noImplicitAny`, and `useUnknownInCatchVariables` (caught errors are `unknown`,
not `any`).

```tsx
// ❌ WRONG — error is any, silently unsafe
} catch (e) {
  console.log(e.message);
}

// ✅ CORRECT — narrow before using
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(msg);
}
```

### No `any` — Use `unknown` or a Proper Interface

```tsx
// ❌ WRONG
function renderIcon(color: any) { ... }
const route: any = state.routes[i];

// ✅ CORRECT
function renderIcon(color: string): React.ReactNode { ... }
type Route = { name: string; key: string };
const route: Route = state.routes[i];
```

All functions need explicit return types. Async functions: `Promise<void>` not void.

### Expo Router Typed Routes

Typed routes are configured in `app.json` under `experiments.typedRoutes`.
Types auto-generate into `.expo/types/` on `npx expo start`.

```tsx
// ✅ Compile error if route doesn't exist
router.push("/streak");
<Link href={{ pathname: "/user/[id]", params: { id: userId } }} />

// ✅ Typed params with Zod validation at the boundary
const raw = useLocalSearchParams<"/product/[id]">();
const params = ProductParamsSchema.parse(raw); // all params arrive as strings
```

Use `useLocalSearchParams` not `useGlobalSearchParams` — the global variant
re-renders on any navigation change, not just when the current route is focused.

---

## 4. Performance

### New Architecture Context (SDK 54+)

SDK 54 runs on New Architecture (Fabric + JSI) by default. SDK 55 removes
Legacy Architecture entirely. This changes a few things:

- `setNativeProps` is effectively deprecated — remove any usage
- `InteractionManager.runAfterInteractions` is less necessary; use `startTransition`
  for non-urgent state updates instead
- `useLayoutEffect` now runs synchronously before paint (matching web semantics)
- Automatic batching applies everywhere — multiple `setState` in one tick = one render

### React.memo — When It Helps vs Creates Overhead

Rules from Shopify/mrousavy production benchmarks:

**Always memoize with React.memo:**
- Components in `components/` that receive stable props from frequently-re-rendering parents
- Components with non-trivial render cost (multiple children, complex layout)

**Skip React.memo:**
- Leaf components rendering 1-2 primitives — comparison overhead > render cost
- Components that almost always receive changed props — memo comparison is wasted

**Always pair React.memo with useCallback on handlers passed as props:**
```tsx
// Without useCallback, new function reference defeats React.memo on the child
const handlePress = useCallback(() => router.push("/streak"), [router]);
<StreakBadge onPress={handlePress} />
```

**useMemo — use for:**
- Objects/arrays passed as props to memoized children (new reference every render)
- Derived values from large datasets (filtering, sorting)
- NOT for: formatting a date, simple string concatenation, simple booleans

### FlashList Over FlatList for Lists

`@shopify/flash-list` v2 is a complete rewrite for New Architecture. It is 50%
less blank area during scroll and significantly faster than FlatList. Use it for
any list with dynamic data. Migration from FlatList is mostly removing props.

### expo-image Over core Image

`expo-image` wraps SDWebImage (iOS) and Glide (Android) — disk caching,
progressive loading, blurhash placeholders. The core `Image` has no disk cache.

---

## 5. Architecture

### Centralised Colors — Import from theme.ts Only

All app colors live in `constants/theme.ts` (`APP_LIGHT`, `APP_DARK`, `NEU_BG`).
Never define a LIGHT/DARK palette object inside a screen file.

```tsx
// ❌ WRONG — duplicated in every screen, drifts out of sync
const LIGHT = { bg: "#e8ecf3", tp: "#2D3748" };

// ✅ CORRECT
import { APP_LIGHT, APP_DARK } from "../../constants/theme";
const t = isDark ? APP_DARK : APP_LIGHT;
```

### Context Only for Rarely-Changing State

React Context re-renders every consumer on every update. Keep Context for:
`isDark`, `user`, `locale` — things that change at most a few times per session.

**Never put in Context:** cart items, product lists, any frequently-updated data.
Use Zustand with fine-grained selectors for medium-complexity client state.
Use TanStack Query for all server state (caching, deduplication, background refetch).

Performance benchmarks (1000 components):
- Single large Context: 350ms average render
- Zustand with fine-grained selectors: 18ms average render

### Storage Access — Always Through Context or a Hook

Never write raw AsyncStorage calls in screen components. The streak data goes
through `StreakContext`. Flame preference reads go through `useFocusEffect` in
the screen that owns it, not scattered across components. If you add a new piece
of persisted data, add it to the relevant context or create a `useStoredValue` hook.

### Screen File Size

Screens over 200 lines need sub-components extracted. Look for: named card
sections, repeated render patterns, standalone widgets. Extract to `components/`.

### No Business Logic Inline in JSX

```tsx
// ❌ WRONG
<Text>{isMax ? 1 : (days - tier.min) / ((tier.next as number) - tier.min)}</Text>

// ✅ CORRECT
const progress = isMax ? 1 : (days - tier.min) / ((tier.next as number) - tier.min);
<Text>{progress}</Text>
```

---

## 6. Accessibility

### The Full Prop Triad on Every Interactive Element

Apple checks VoiceOver functionality during App Store review. Minimum 44×44pt
touch targets are HIG guidance. WCAG 2.1 AA applies to native mobile apps.

```tsx
// ❌ WRONG — screen reader says "button"
<BounceButton onPress={handlePress}>

// ✅ CORRECT — role + label + hint + state
<BounceButton
  onPress={handlePress}
  accessibilityRole="button"
  accessibilityLabel="View your streak"
  accessibilityHint="Opens the streak summary page"
  accessibilityState={{ disabled: isLoading }}
>
```

**Never set `allowFontScaling={false}`** on Text. Users with visual impairments
set system font scale; overriding it can cause App Store rejection.

**Hiding decorative elements:**
```tsx
<Image aria-hidden={true} />  // cross-platform (RN 0.73+)
```

**Grouping to prevent redundant VoiceOver traversal:**
```tsx
<View accessible={true} accessibilityLabel="Rating: 4.5 out of 5 stars">
  {/* Stars render visually; VoiceOver reads the group label only */}
</View>
```

**Dynamic announcements** (toasts, errors, success states):
```tsx
import { AccessibilityInfo } from "react-native";
AccessibilityInfo.announceForAccessibility("Streak saved successfully");
```

**Modals** — prevent VoiceOver from reading behind the modal:
```tsx
<View accessibilityViewIsModal={true}>
  {/* Modal content */}
</View>
```

---

## 7. Expo SDK 54 Specifics

### Things That Have Changed or Are Changing

- SDK 55 **removes Legacy Architecture** — everything must work on New Architecture now
- `expo-av` is deprecated in SDK 54 and removed in SDK 55 → use `expo-audio` + `expo-video`
- Android 16 enforces edge-to-edge; `react-native-edge-to-edge` is no longer needed
- Unhandled promise rejections now surface as visible errors (previously silent)
- `expo-file-system` new API is the default; old API moved to `expo-file-system/legacy`

### Run expo-doctor Before Every EAS Build

```bash
npx expo-doctor@latest
```

This catches dependency incompatibilities that cause native build failures.

### Package Recommendations

| Instead of | Use |
|---|---|
| `FlatList` (large lists) | `@shopify/flash-list` |
| Core `Image` | `expo-image` |
| `AsyncStorage` for tokens | `expo-secure-store` |
| `expo-av` | `expo-audio` + `expo-video` |
| `react-native-maps` v1.20 | v1.21+ or `expo-maps` |

---

## Pre-Ship Checklist

Run this mentally before marking any task complete.

```
SECURITY
[ ] Auth tokens use expo-secure-store, not AsyncStorage
[ ] No secrets or API keys embedded in the JS bundle
[ ] Deep links use Universal Links, not custom URI schemes
[ ] URLs never contain tokens or session data

ERROR HANDLING
[ ] All async operations have try/catch with safe fallback
[ ] JSON.parse guarded with try/catch + shape validation
[ ] No .then() without .catch()
[ ] Loading, error, and empty states all render something (no blank screen)
[ ] Error boundary wraps any complex feature section

TYPESCRIPT
[ ] Zero `any` types — use `unknown` and narrow, or define an interface
[ ] Caught errors narrowed before use (e instanceof Error check)
[ ] Async functions typed as Promise<void> not void
[ ] Expo Router typed routes used for navigation

PERFORMANCE
[ ] Components in components/ wrapped in React.memo if pure
[ ] Handlers passed as props use useCallback
[ ] Object-valued derived state uses useMemo
[ ] Large dynamic lists use FlashList, not ScrollView + .map()

ARCHITECTURE
[ ] No color palette defined in screen files — imported from theme.ts
[ ] No business logic inline in JSX
[ ] Screen file under 200 lines or sub-components extracted
[ ] Context only used for rarely-changing state

ACCESSIBILITY
[ ] All touchable elements: accessibilityRole + accessibilityLabel
[ ] No allowFontScaling={false} on any Text
[ ] Touch targets at least 44×44pt
[ ] Decorative images hidden from accessibility tree

EXPO
[ ] npx expo-doctor passes
[ ] No expo-av usage (deprecated)
[ ] No setNativeProps usage (deprecated in New Architecture)
```
