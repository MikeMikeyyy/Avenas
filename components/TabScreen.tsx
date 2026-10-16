// components/TabScreen.tsx
//
// Every tab page's default export goes through tabScreen() (app/(tabs)/*.tsx).
//
// On iOS 26 and later the tabs are Apple's own bar (app/(tabs)/_layout.tsx),
// and Expo Router gives each of its pages a safe area of its own, measured by
// iOS, which takes the bar in. The pages were laid out for the app's own bar,
// which floats over a safe area that stops at the home indicator: their ends
// pad for the bar themselves, and so does every sheet opened from them. Under
// Apple's bar they'd all have counted it twice, each page ending in a gap and
// every sheet's buttons sitting the bar's height too high. tabScreen gives a
// page back the window's safe area, which the layout reads outside the tabs
// (WindowInsetsContext), and reports where Apple's bar is (hooks/useTabBar.ts)
// for what stands on it.
//
// Below iOS 26 and on Android it hands back the page as it is.

import { createContext, useContext, useEffect, type ComponentType, type ReactNode } from "react";
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

import { NATIVE_TAB_BAR, reportNativeTabBar } from "../hooks/useTabBar";

/** The window's safe area, as the tabs layout reads it outside Apple's tabs. */
export const WindowInsetsContext = createContext<EdgeInsets | null>(null);

function WindowSafeArea({ children }: { children: ReactNode }) {
  const tabInsets = useSafeAreaInsets();
  const windowInsets = useContext(WindowInsetsContext) ?? tabInsets;
  useEffect(() => {
    reportNativeTabBar(tabInsets.bottom, windowInsets.bottom);
  }, [tabInsets.bottom, windowInsets.bottom]);
  return <SafeAreaInsetsContext.Provider value={windowInsets}>{children}</SafeAreaInsetsContext.Provider>;
}

export function tabScreen<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  if (!NATIVE_TAB_BAR) return Screen;
  function NativeTabScreen(props: P) {
    return (
      <WindowSafeArea>
        <Screen {...props} />
      </WindowSafeArea>
    );
  }
  return NativeTabScreen;
}
