import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import Animated, { useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { useTheme } from "../contexts/ThemeContext";
import { APP_DARK, APP_LIGHT, ACCT, BTN_SLATE, BTN_SLATE_DARK, FontFamily } from "../constants/theme";
import { WELCOME, FEATURE_SLIDES, type FeatureSlideId } from "../constants/onboarding";
import BounceButton from "../components/BounceButton";
import FeatureSlide from "../components/onboarding/FeatureSlide";
import PagerDots from "../components/onboarding/PagerDots";
import WelcomeMockup from "../components/onboarding/mockups/WelcomeMockup";
import WorkoutMockup from "../components/onboarding/mockups/WorkoutMockup";
import ProgramMockup from "../components/onboarding/mockups/ProgramMockup";
import ProgressMockup from "../components/onboarding/mockups/ProgressMockup";
import StreakMockup from "../components/onboarding/mockups/StreakMockup";

function renderMockup(id: FeatureSlideId, dark: boolean, active: boolean) {
  switch (id) {
    case "workout":  return <WorkoutMockup dark={dark} active={active} />;
    case "program":  return <ProgramMockup dark={dark} active={active} />;
    case "progress": return <ProgressMockup dark={dark} active={active} />;
    case "streak":   return <StreakMockup dark={dark} active={active} />;
  }
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark } = useTheme();
  const t = isDark ? APP_DARK : APP_LIGHT;

  // Grey slate CTA, matching the home "Start Workout" button.
  const btnBg = isDark ? BTN_SLATE_DARK : BTN_SLATE;
  const btnContent = isDark ? APP_DARK.bg : "#fff";
  const btnShadow = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.45)";

  const { width } = useWindowDimensions();
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const [page, setPage] = useState(0);

  const totalPages = 1 + FEATURE_SLIDES.length;
  const isLast = page === totalPages - 1;

  // The CTA label only swaps after the page fully settles (page is committed in
  // onMomentumScrollEnd), so fade the new label in to keep that change smooth.
  const labelOpacity = useSharedValue(1);
  useEffect(() => {
    labelOpacity.value = 0;
    labelOpacity.value = withTiming(1, { duration: 240 });
  }, [isLast]);
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollX.value = e.contentOffset.x; },
  });

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) {
      setPage(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const onPrimary = () => {
    if (!isLast) {
      const next = page + 1;
      setPage(next);
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    } else {
      router.push("/signup");
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        style={styles.scroll}
      >
        <FeatureSlide
          width={width}
          index={0}
          scrollX={scrollX}
          title={WELCOME.title}
          subtitle={WELCOME.subtitle}
          dark={isDark}
        >
          <WelcomeMockup dark={isDark} active={page === 0} />
        </FeatureSlide>

        {FEATURE_SLIDES.map((s, i) => (
          <FeatureSlide
            key={s.id}
            width={width}
            index={i + 1}
            scrollX={scrollX}
            title={s.title}
            subtitle={s.subtitle}
            dark={isDark}
          >
            {renderMockup(s.id, isDark, page === i + 1)}
          </FeatureSlide>
        ))}
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <PagerDots count={totalPages} width={width} scrollX={scrollX} dark={isDark} />

        <BounceButton
          onPress={onPrimary}
          accessibilityRole="button"
          accessibilityLabel={isLast ? "Get started" : "Next"}
        >
          <View style={[styles.ctaWrap, { backgroundColor: btnBg, shadowColor: btnShadow }]}>
            <View style={[styles.cta, { backgroundColor: btnBg }]}>
              <Animated.Text style={[styles.ctaText, { color: btnContent }, labelStyle]}>{isLast ? "Get Started" : "Next"}</Animated.Text>
            </View>
          </View>
        </BounceButton>

        <TouchableOpacity onPress={() => router.push("/login")} accessibilityRole="button" accessibilityLabel="Log in">
          <Text style={[styles.loginText, { color: t.ts }]}>
            Already have an account? <Text style={{ color: ACCT, fontFamily: FontFamily.bold }}>Log in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1 },
  scroll:   { flex: 1 },
  footer:   { paddingHorizontal: 28, paddingTop: 8, gap: 24 },
  ctaWrap:  { borderRadius: 28, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8 },
  cta:      { borderRadius: 28, paddingVertical: 17, alignItems: "center", justifyContent: "center" },
  ctaText:  { fontFamily: FontFamily.bold, fontSize: 17, letterSpacing: 0.3 },
  loginText:{ fontFamily: FontFamily.semibold, fontSize: 14, textAlign: "center" },
});
