import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { APP_DARK, APP_LIGHT, BUBBLE_DARK, BUBBLE_LIGHT, FontFamily } from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";

export type SegmentOption<K extends string> = { key: K; label: string };

interface Props<K extends string> {
  options: readonly SegmentOption<K>[];
  value: K;
  onChange: (k: K) => void;
  style?: StyleProp<ViewStyle>;
}

// iOS-native segmented-control track: a translucent gray wash (reads correctly
// over both NEU_BG and NEU_BG_DARK cards — solid hexes would need a
// per-surface variant). The sliding thumb uses the shared bubble-pill colors.
const TRACK_LIGHT = "rgba(118, 118, 128, 0.12)";
const TRACK_DARK = "rgba(255, 255, 255, 0.08)";

const TRACK_PAD = 3;
const TRACK_HEIGHT = 38;

/**
 * iOS-style segmented control: gray pill track, white (light) / lifted-navy
 * (dark) thumb that slides to the selected segment on the UI thread.
 * Used below the Progress charts to switch the plotted metric.
 */
export default function SegmentedControl<K extends string>({ options, value, onChange, style }: Props<K>) {
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;
  const [trackW, setTrackW] = useState(0);

  const segW = trackW > 0 ? (trackW - TRACK_PAD * 2) / options.length : 0;
  const idx = Math.max(0, options.findIndex(o => o.key === value));

  // Animate the thumb by segment index; translateX = idx × segment width.
  const animIdx = useSharedValue(idx);
  useEffect(() => {
    animIdx.value = withTiming(idx, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [idx, animIdx]);

  const thumbStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: animIdx.value * segW }] }),
    [segW],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - trackW) > 0.5) setTrackW(w);
  };

  return (
    <View
      onLayout={onTrackLayout}
      style={[styles.track, { backgroundColor: isDark ? TRACK_DARK : TRACK_LIGHT }, style]}
      accessibilityRole="tablist"
    >
      {segW > 0 && (
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segW,
              backgroundColor: isDark ? BUBBLE_DARK : BUBBLE_LIGHT,
              shadowOpacity: isDark ? 0.3 : 0.12,
            },
            thumbStyle,
          ]}
        />
      )}
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            style={styles.segment}
            onPress={() => {
              if (active) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(opt.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show ${opt.label}`}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                active
                  ? { color: t.tp, fontFamily: FontFamily.bold }
                  : { color: t.ts, fontFamily: FontFamily.semibold },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // No overflow:"hidden" — the thumb's travel is bounded by the track's
  // padding, and clipping would flatten its soft drop shadow.
  track: {
    flexDirection: "row",
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: TRACK_PAD,
  },
  thumb: {
    position: "absolute",
    top: TRACK_PAD,
    left: TRACK_PAD,
    height: TRACK_HEIGHT - TRACK_PAD * 2,
    borderRadius: (TRACK_HEIGHT - TRACK_PAD * 2) / 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 13,
  },
});
