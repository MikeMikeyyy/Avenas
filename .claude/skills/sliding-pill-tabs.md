---
description: Animated sliding pill tab switcher — used in the workout timer modal, reusable anywhere a segmented control is needed
---

# Sliding Pill Tab Switcher

A smooth spring-animated pill that slides between tab options. The active label turns white; inactive labels fade to the muted secondary text colour. Uses `react-native-reanimated` for UI-thread animation (no JS thread jank).

First used in: workout timer modal (`app/(tabs)/workout.tsx`)

---

## Required Imports

```tsx
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
```

---

## State (2-tab example)

```ts
// tabOffset: 0 = left tab active, 1 = right tab active
const tabOffset    = useSharedValue(0);
const tabTrackWidth = useSharedValue(0);  // measured at runtime via onLayout
```

---

## Animated Styles

```ts
// Pill position and width — always half the track
const pillAnimStyle = useAnimatedStyle(() => ({
  width: tabTrackWidth.value / 2,
  transform: [{ translateX: tabOffset.value * (tabTrackWidth.value / 2) }],
}));

// Label colours — white when active, muted when inactive
const leftLabelColor = useAnimatedStyle(() => ({
  color: interpolateColor(tabOffset.value, [0, 1], ["#ffffff", isDark ? "#8896A7" : "#8896A7"]),
}));
const rightLabelColor = useAnimatedStyle(() => ({
  color: interpolateColor(tabOffset.value, [0, 1], [isDark ? "#8896A7" : "#8896A7", "#ffffff"]),
}));
```

---

## JSX

```tsx
<View
  style={[styles.tabs, { backgroundColor: t.div }]}
  onLayout={e => { tabTrackWidth.value = e.nativeEvent.layout.width - 6; }}
>
  {/* Sliding pill — rendered first so labels sit on top */}
  <Reanimated.View style={[styles.pill, pillAnimStyle]} />

  {/* Left tab */}
  <TouchableOpacity
    style={styles.tab}
    activeOpacity={0.8}
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveTab("left");
      tabOffset.value = withSpring(0, { damping: 22, stiffness: 300, mass: 0.9 });
    }}
  >
    <Reanimated.Text style={[styles.tabText, leftLabelColor]}>Left</Reanimated.Text>
  </TouchableOpacity>

  {/* Right tab */}
  <TouchableOpacity
    style={styles.tab}
    activeOpacity={0.8}
    onPress={() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveTab("right");
      tabOffset.value = withSpring(1, { damping: 22, stiffness: 300, mass: 0.9 });
    }}
  >
    <Reanimated.Text style={[styles.tabText, rightLabelColor]}>Right</Reanimated.Text>
  </TouchableOpacity>
</View>
```

---

## Styles

There are two variants depending on whether the control should fill its parent or stay compact.

### Full-width variant (e.g. timer modal tabs)

```ts
tabs: {
  flexDirection: "row",
  borderRadius: 12,
  padding: 3,
  alignSelf: "stretch",   // fills the parent container
},
pill: {
  position: "absolute",
  top: 3, left: 3, bottom: 3,
  borderRadius: 10,
  backgroundColor: ACCT,
  shadowColor: ACCT,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.5,
  shadowRadius: 6,
},
tab: {
  flex: 1,                // each tab shares the full width equally
  borderRadius: 10,
  paddingVertical: 8,
  alignItems: "center",
},
tabText: {
  fontFamily: FontFamily.semibold,
  fontSize: 14,
},
```

### Compact inline variant (e.g. kg/lbs unit toggle in a settings row)

Do **not** use `flex: 1` on the tab buttons — the container sizes to its content and the pill width is still measured via `onLayout`.

```ts
tabs: {
  flexDirection: "row",
  borderRadius: 20,       // rounder pill shape for small controls
  padding: 3,
  // no alignSelf: "stretch" — stays as wide as its buttons
},
pill: {
  position: "absolute",
  top: 3, left: 3, bottom: 3,
  borderRadius: 17,       // container radius (20) minus padding (3)
  backgroundColor: ACCT,
  shadowColor: ACCT,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.5,
  shadowRadius: 6,
},
tab: {
  // NO flex: 1 — fixed padding drives the size
  paddingHorizontal: 12,
  paddingVertical: 5,
  alignItems: "center",
},
tabText: {
  fontFamily: FontFamily.semibold,
  fontSize: 13,
},
```

---

## How It Works

| Piece | Purpose |
|---|---|
| `tabTrackWidth` | Measured via `onLayout` — the pill width is always exactly half, so it fits perfectly regardless of container size |
| `tabOffset` | Drives both the pill translation and the label colour simultaneously on the UI thread |
| `withSpring` damping/stiffness | `{ damping: 22, stiffness: 300, mass: 0.9 }` — snappy without bouncing |
| `interpolateColor` | Smoothly fades label colour between active white and muted grey as the pill moves |
| `padding: 3` on track + `top/left/bottom: 3` on pill | The 3px inset on all sides gives the pill a clean floating-inside-the-track look |

## Scaling to 3+ Tabs

For N tabs, change:
- `tabOffset` range becomes `[0, 1, 2, ..., N-1]`
- `pillAnimStyle` width becomes `tabTrackWidth.value / N`
- Each label's `interpolateColor` input range must cover `[0, 1, ..., N-1]` with white only at its own index

## Notes

- The pill `View` must be rendered **before** the tab `TouchableOpacity` elements so labels appear above it in the z-order
- `onLayout` fires after the first render — `tabTrackWidth` starts at `0` which is fine because the pill is invisible at zero width
- Haptic feedback on every press is part of the pattern — keep it
- The track `backgroundColor` should use `t.div` (theme divider colour) so it looks right in both light and dark mode
