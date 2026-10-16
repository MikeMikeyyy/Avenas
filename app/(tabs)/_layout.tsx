import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PlatformColor,
  useWindowDimensions,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import DrawnIcon from "../../components/DrawnIcon";
import { WindowInsetsContext } from "../../components/TabScreen";
import { APP_DARK, APP_LIGHT, FontFamily } from "../../constants/theme";
import { BAR_INSET_X, NAV_BAR_BOTTOM, NAV_BAR_H } from "../../constants/floatingBars";
import { TAB_ICONS, TAB_ICON_SIZE } from "../../constants/tabIcons";
import { useTheme } from "../../contexts/ThemeContext";
import { NATIVE_TAB_BAR } from "../../hooks/useTabBar";
import { useTrainerHubPrefetch } from "../../hooks/useTrainerHubPrefetch";

// Two tab bars, one per launch (NATIVE_TAB_BAR): on iOS 26 and later Apple's
// own, Liquid Glass, which a finger can press, hold and slide across between
// tabs (user request, 2026-10-16); below that and on Android, the app's own.
// Both show the same four icons (constants/tabIcons.ts) and labels.

const TAB_LABELS: Record<string, string> = {
  home:          "Home",
  workout:       "Workout",
  progress:      "Progress",
  "trainer-hub": "Trainer",
};

// ─── Tab Item ─────────────────────────────────────────────────────────────────

const PILL_INSET = 4;

function TabItem({ route, focused, onPress, color }: { route: any; focused: boolean; onPress: () => void; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const label = TAB_LABELS[route.name] || route.name;
  const icon = TAB_ICONS[route.name];

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
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
    >
      <Animated.View style={[styles.iconContent, { transform: [{ scale }] }]}>
        {icon && <DrawnIcon drawing={icon} size={TAB_ICON_SIZE} color={color} />}
        <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Animated Tab Bar ─────────────────────────────────────────────────────────

/** The app's own bar, below iOS 26 and on Android. */
function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const pillScale  = useRef(new Animated.Value(1)).current;
  const [tabWidth, setTabWidth] = useState(0);
  const { width: screenWidth } = useWindowDimensions();
  const { isDark } = useTheme();
  const barWidth = screenWidth - BAR_INSET_X * 2;
  const computedTabWidth = barWidth / state.routes.length;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (computedTabWidth > 0) setTabWidth(computedTabWidth);
  }, [computedTabWidth]);

  const prevIndexRef = useRef(state.index);
  useEffect(() => {
    if (tabWidth === 0) return;
    const toValue = state.index * tabWidth + PILL_INSET;
    const indexChanged = prevIndexRef.current !== state.index;
    prevIndexRef.current = state.index;
    // Only animate when the selected tab actually changed. When tabWidth changes
    // on its own (e.g. a transient window-metric re-measure while a modal presents
    // /dismisses), snap instead of springing so the pill never stutters.
    if (isFirstRender.current || !indexChanged) {
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
  const pillHeight = NAV_BAR_H - PILL_INSET * 2;

  const tabColor = () => isDark ? "#FFFFFF" : "#000000";

  const tabItems = state.routes.map((route: any, index: number) => (
    <TabItem
      key={route.key}
      route={route}
      focused={state.index === index}
      color={tabColor()}
      onPress={() => navigation.navigate(route.name)}
    />
  ));

  // The bar has to read as a surface floating ABOVE the page: t.nav is a rung
  // lighter than the cards, the hairline defines its edge (carrying dark mode,
  // where a shadow barely registers), and the shadow lifts it in light mode.
  const t       = isDark ? APP_DARK : APP_LIGHT;
  const pillBg  = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)";
  return (
    <View style={styles.tabBarWrapper}>
      {/* Two views on purpose: the shadow can't live on the same node as
          overflow:"hidden" (iOS clips it), and the bar needs that overflow to
          clip the sliding pill to its rounded ends. Outer casts, inner clips. */}
      <View style={[styles.barShadow, { width: barWidth, height: NAV_BAR_H, backgroundColor: t.nav }]}>
        <View
          style={[
            styles.bar,
            { width: barWidth, height: NAV_BAR_H, backgroundColor: t.nav, borderColor: t.navEdge },
          ]}
        >
          <Animated.View style={[styles.pill, { width: pillWidth, height: pillHeight, backgroundColor: pillBg, transform: [{ translateX }, { scale: pillScale }] }]} />
          {tabItems}
        </View>
      </View>
    </View>
  );
}

// ─── Apple's Tab Bar ──────────────────────────────────────────────────────────

/** The tabs in order, with the images Apple's bar shows: it can't draw an
 *  SVG, so scripts/build-tab-icons.ts renders the app's own drawings into them. */
const NATIVE_TABS: { name: string; image: ImageSourcePropType }[] = [
  { name: "home",        image: require("../../assets/images/tab-icons/home.png") },
  { name: "workout",     image: require("../../assets/images/tab-icons/workout.png") },
  { name: "progress",    image: require("../../assets/images/tab-icons/progress.png") },
  { name: "trainer-hub", image: require("../../assets/images/tab-icons/trainer-hub.png") },
];

// Icons and labels in the label colour, black or white as on the app's bar,
// the selected tab marked by Apple's highlight and a heavier label rather than
// iOS blue. The glass turns light or dark over what's behind it, and a system
// colour turns with it, where a fixed one wouldn't.
const NATIVE_INK = PlatformColor("label");
const NATIVE_LABEL = { fontFamily: FontFamily.regular, fontSize: 10, color: NATIVE_INK };
const NATIVE_LABEL_SELECTED = { ...NATIVE_LABEL, fontFamily: FontFamily.semibold };

/** Apple's own bar, iOS 26 and later. Each page inside it keeps the window's
 *  safe area (tabScreen, components/TabScreen.tsx), read here, outside the
 *  tabs, before they give each page one that takes the bar in. */
function NativeTabLayout({ bg }: { bg: string }) {
  const windowInsets = useSafeAreaInsets();
  return (
    <WindowInsetsContext.Provider value={windowInsets}>
      <NativeTabs
        // The workout bar and the rest timer stand on it (hooks/useTabBar.ts),
        // so it never shrinks away on a scroll.
        minimizeBehavior="never"
        tintColor={NATIVE_INK}
        iconColor={NATIVE_INK}
        labelStyle={{ default: NATIVE_LABEL, selected: NATIVE_LABEL_SELECTED }}
        screenListeners={{
          tabPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          },
        }}
      >
        {NATIVE_TABS.map(({ name, image }) => (
          <NativeTabs.Trigger
            key={name}
            name={name}
            // The pages leave room for the bar themselves, so iOS mustn't
            // add its own on top.
            disableAutomaticContentInsets
            // A second tap on Workout would scroll the session away from the
            // set it's up to.
            disableScrollToTop={name === "workout"}
            contentStyle={{ backgroundColor: bg }}
          >
            <NativeTabs.Trigger.Icon src={image} renderingMode="template" />
            <NativeTabs.Trigger.Label>{TAB_LABELS[name]}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    </WindowInsetsContext.Provider>
  );
}

// ─── Root Layout ──────────────────────────────────────────────────────────────

function AppTabLayout({ bg }: { bg: string }) {
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: "none", lazy: false, sceneStyle: { backgroundColor: bg } }}
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

export default function TabLayout() {
  const { isDark } = useTheme();
  // The Trainer tab's data, loaded in the background a couple of seconds after
  // the tabs appear, so it's current when opened. Never delays Home.
  useTrainerHubPrefetch();
  // The tab scenes sit on this. Without a colour here the tab area is
  // transparent, so a scene being re-created (or fading in) shows the window
  // behind it rather than the app's own background.
  const bg = isDark ? APP_DARK.bg : APP_LIGHT.bg;

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {NATIVE_TAB_BAR ? <NativeTabLayout bg={bg} /> : <AppTabLayout bg={bg} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: "absolute",
    bottom: NAV_BAR_BOTTOM,
    left: BAR_INSET_X,
    right: BAR_INSET_X,
  },
  bar: {
    borderRadius: NAV_BAR_H / 2,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  barShadow: {
    borderRadius: NAV_BAR_H / 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  pill: {
    position: "absolute",
    top: PILL_INSET,
    left: 0,
    borderRadius: (NAV_BAR_H - PILL_INSET * 2) / 2,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: NAV_BAR_H,
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
