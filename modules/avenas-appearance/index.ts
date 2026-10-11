// avenas-appearance — the app's own Dark Mode, kept where the next launch's
// splash can use it before any JavaScript has run.
//
// The app follows its Dark Mode switch, never the phone's (ThemeContext), but
// the splash is drawn natively, and left alone it followed the phone: a phone
// in dark mode opened a light app on a dark splash.
//
//  - iOS: saved in UserDefaults. The launch screen iOS draws before the app
//    runs is light for everyone (app.plugin.js), and once the app's first
//    frame is up a saved Dark Mode fades the window, splash and all, to dark
//    (ios/AvenasAppearanceAppDelegateSubscriber.swift).
//  - Android 12+: becomes this app's own night mode, which Android keeps and
//    draws the splash in. Before 12 the splash can only follow the phone.
//
// Safe to import everywhere: in Expo Go the module isn't linked and the call
// does nothing.

import { requireOptionalNativeModule } from "expo";

type NativeModule = {
  saveTheme(dark: boolean): Promise<void>;
};

const native = requireOptionalNativeModule<NativeModule>("AvenasAppearance");

/** Saves the app's Dark Mode for the next launch's splash. */
export function saveLaunchTheme(dark: boolean): void {
  native?.saveTheme(dark).catch((e: unknown) => {
    if (__DEV__) console.warn("[avenas] appearance", "saveTheme", e);
  });
}
