import { Tabs } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect, Path } from "react-native-svg";
import { useRef, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import { FontFamily } from "../../constants/theme";

// ─── Icons ───────────────────────────────────────────────────────────────────

const HomeIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
    <Path d="M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z" fill={color} />
  </Svg>
);

const WorkoutIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M15.5 9L15.5 15C15.5 15.465 15.5 15.6975 15.5511 15.8882C15.6898 16.4059 16.0941 16.8102 16.6118 16.9489C16.8025 17 17.035 17 17.5 17C17.965 17 18.1975 17 18.3882 16.9489C18.9059 16.8102 19.3102 16.4059 19.4489 15.8882C19.5 15.6975 19.5 15.465 19.5 15V9C19.5 8.53501 19.5 8.30252 19.4489 8.11177C19.3102 7.59413 18.9059 7.18981 18.3882 7.05111C18.1975 7 17.965 7 17.5 7C17.035 7 16.8025 7 16.6118 7.05111C16.0941 7.18981 15.6898 7.59413 15.5511 8.11177C15.5 8.30252 15.5 8.53501 15.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M4.5 9L4.5 15C4.5 15.465 4.5 15.6975 4.55111 15.8882C4.68981 16.4059 5.09413 16.8102 5.61177 16.9489C5.80252 17 6.03501 17 6.5 17C6.96499 17 7.19748 17 7.38823 16.9489C7.90587 16.8102 8.31019 16.4059 8.44889 15.8882C8.5 15.6975 8.5 15.465 8.5 15V9C8.5 8.53501 8.5 8.30252 8.44889 8.11177C8.31019 7.59413 7.90587 7.18981 7.38823 7.05111C7.19748 7 6.96499 7 6.5 7C6.03501 7 5.80252 7 5.61177 7.05111C5.09413 7.18981 4.68981 7.59413 4.55111 8.11177C4.5 8.30252 4.5 8.53501 4.5 9Z" stroke={color} strokeWidth="1.5" />
    <Path d="M5 10H4C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14H5M9 12H15M19 14H20C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10H19" stroke={color} strokeWidth="1.5" />
  </Svg>
);

const ProgressIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 3v16a2 2 0 0 0 2 2h16" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="m19 9-5 5-4-4-3 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CommunityIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M9.15957 11.62C9.12957 11.62 9.10957 11.62 9.07957 11.62C9.02957 11.61 8.95957 11.61 8.89957 11.62C5.99957 11.53 3.80957 9.25 3.80957 6.44C3.80957 3.58 6.13957 1.25 8.99957 1.25C11.8596 1.25 14.1896 3.58 14.1896 6.44C14.1796 9.25 11.9796 11.53 9.18957 11.62C9.17957 11.62 9.16957 11.62 9.15957 11.62ZM8.99957 2.75C6.96957 2.75 5.30957 4.41 5.30957 6.44C5.30957 8.44 6.86957 10.05 8.85957 10.12C8.91957 10.11 9.04957 10.11 9.17957 10.12C11.1396 10.03 12.6796 8.42 12.6896 6.44C12.6896 4.41 11.0296 2.75 8.99957 2.75Z" fill={color} />
    <Path d="M16.5396 11.75C16.5096 11.75 16.4796 11.75 16.4496 11.74C16.0396 11.78 15.6196 11.49 15.5796 11.08C15.5396 10.67 15.7896 10.3 16.1996 10.25C16.3196 10.24 16.4496 10.24 16.5596 10.24C18.0196 10.16 19.1596 8.96 19.1596 7.49C19.1596 5.97 17.9296 4.74 16.4096 4.74C15.9996 4.75 15.6596 4.41 15.6596 4C15.6596 3.59 15.9996 3.25 16.4096 3.25C18.7496 3.25 20.6596 5.16 20.6596 7.5C20.6596 9.8 18.8596 11.66 16.5696 11.75C16.5596 11.75 16.5496 11.75 16.5396 11.75Z" fill={color} />
    <Path d="M9.16961 22.55C7.20961 22.55 5.23961 22.05 3.74961 21.05C2.35961 20.13 1.59961 18.87 1.59961 17.5C1.59961 16.13 2.35961 14.86 3.74961 13.93C6.74961 11.94 11.6096 11.94 14.5896 13.93C15.9696 14.85 16.7396 16.11 16.7396 17.48C16.7396 18.85 15.9796 20.12 14.5896 21.05C13.0896 22.05 11.1296 22.55 9.16961 22.55ZM4.57961 15.19C3.61961 15.83 3.09961 16.65 3.09961 17.51C3.09961 18.36 3.62961 19.18 4.57961 19.81C7.06961 21.48 11.2696 21.48 13.7596 19.81C14.7196 19.17 15.2396 18.35 15.2396 17.49C15.2396 16.64 14.7096 15.82 13.7596 15.19C11.2696 13.53 7.06961 13.53 4.57961 15.19Z" fill={color} />
    <Path d="M18.3397 20.75C17.9897 20.75 17.6797 20.51 17.6097 20.15C17.5297 19.74 17.7897 19.35 18.1897 19.26C18.8197 19.13 19.3997 18.88 19.8497 18.53C20.4197 18.1 20.7297 17.56 20.7297 16.99C20.7297 16.42 20.4197 15.88 19.8597 15.46C19.4197 15.12 18.8697 14.88 18.2197 14.73C17.8197 14.64 17.5597 14.24 17.6497 13.83C17.7397 13.43 18.1397 13.17 18.5497 13.26C19.4097 13.45 20.1597 13.79 20.7697 14.26C21.6997 14.96 22.2297 15.95 22.2297 16.99C22.2297 18.03 21.6897 19.02 20.7597 19.73C20.1397 20.21 19.3597 20.56 18.4997 20.73C18.4397 20.75 18.3897 20.75 18.3397 20.75Z" fill={color} />
  </Svg>
);

const renderIcon = (name: string, size: number, color: string) => {
  switch (name) {
    case "home":         return <HomeIcon size={size} color={color} />;
    case "workout":      return <WorkoutIcon size={size} color={color} />;
    case "progress":     return <ProgressIcon size={size} color={color} />;
    case "trainer-hub":  return <CommunityIcon size={size} color={color} />;
    default:             return null;
  }
};

// ─── SVG perimeter border ─────────────────────────────────────────────────────

function PillBorder({ width, height }: { width: number; height: number }) {
  if (width === 0) return null;
  const r = height / 2;
  const sw = 1;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Defs>
        <SvgGradient id="perim" x1="0" y1="0" x2={width} y2={height} gradientUnits="userSpaceOnUse">
          <Stop offset="0"    stopColor="#fff" stopOpacity="0.95" />
          <Stop offset="0.18" stopColor="#fff" stopOpacity="0.28" />
          <Stop offset="0.38" stopColor="#fff" stopOpacity="0.85" />
          <Stop offset="0.55" stopColor="#fff" stopOpacity="0.22" />
          <Stop offset="0.72" stopColor="#fff" stopOpacity="0.7"  />
          <Stop offset="0.88" stopColor="#fff" stopOpacity="0.2"  />
          <Stop offset="1"    stopColor="#fff" stopOpacity="0.9"  />
        </SvgGradient>
      </Defs>
      <Rect x={sw / 2} y={sw / 2} width={width - sw} height={height - sw}
        rx={r - sw / 2} ry={r - sw / 2}
        fill="none" stroke="url(#perim)" strokeWidth={sw} />
    </Svg>
  );
}

// ─── Tab Item ─────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<string, string> = {
  home:          "Home",
  workout:       "Workout",
  progress:      "Progress",
  "trainer-hub": "Trainer Hub",
};

const BAR_HEIGHT = 72;
const PILL_INSET = 4;

function TabItem({ route, focused, onPress }: { route: any; focused: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const label = TAB_LABELS[route.name] || route.name;
  const color = focused ? "#FFFFFF" : "rgba(255,255,255,0.45)";

  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }).start();

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={styles.tabItem}
    >
      <Animated.View style={[styles.iconContent, { transform: [{ scale }] }]}>
        {renderIcon(route.name, 24, color)}
        <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Animated Tab Bar ─────────────────────────────────────────────────────────

function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const pillScale  = useRef(new Animated.Value(1)).current;
  const [tabWidth, setTabWidth] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const barWidth = screenWidth - 40;
  const computedTabWidth = barWidth / state.routes.length;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (computedTabWidth > 0) setTabWidth(computedTabWidth);
  }, [computedTabWidth]);

  useEffect(() => {
    if (tabWidth === 0) return;
    const toValue = state.index * tabWidth + PILL_INSET;

    if (isFirstRender.current) {
      translateX.setValue(toValue);
      isFirstRender.current = false;
      return;
    }

    Animated.sequence([
      Animated.timing(pillScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.spring(pillScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }),
    ]).start();

    Animated.spring(translateX, { toValue, useNativeDriver: true, tension: 68, friction: 12 }).start();
  }, [state.index, tabWidth]);

  const pillWidth  = tabWidth - PILL_INSET * 2;
  const pillHeight = BAR_HEIGHT - PILL_INSET * 2;

  return (
    <View style={styles.tabBarWrapper}>
      {/* Bar */}
      <View style={[styles.bar, { width: barWidth, height: BAR_HEIGHT }]}>
        <PillBorder width={barWidth} height={BAR_HEIGHT} />

        {/* Sliding pill */}
        <Animated.View
          style={[
            styles.pill,
            { width: pillWidth, height: pillHeight, transform: [{ translateX }, { scale: pillScale }] },
          ]}
        />

        {/* Tab items */}
        {state.routes.map((route: any, index: number) => (
          <TabItem
            key={route.key}
            route={route}
            focused={state.index === index}
            onPress={() => navigation.navigate(route.name)}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Root Layout ──────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: "fade" }}
      tabBar={(props) => (
        <AnimatedTabBar state={props.state} navigation={props.navigation} />
      )}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="workout" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="trainer-hub" />
    </Tabs>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: "absolute",
    bottom: 28,
    left: 20,
    right: 20,
  },
  bar: {
    backgroundColor: "#1e1e1e",
    borderRadius: BAR_HEIGHT / 2,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  pill: {
    position: "absolute",
    top: PILL_INSET,
    left: 0,
    borderRadius: (BAR_HEIGHT - PILL_INSET * 2) / 2,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: BAR_HEIGHT,
    zIndex: 2,
  },
  iconContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontFamily: FontFamily.regular,
    lineHeight: 12,
  },
  labelActive: {
    fontFamily: FontFamily.semibold,
  },
});
