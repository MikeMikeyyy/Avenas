// The launch screen iOS draws before the app runs is LIGHT for everyone, as
// the app itself is until someone turns its Dark Mode on.
//
// expo-splash-screen sets Info.plist's UIUserInterfaceStyle to Automatic
// whenever a dark splash is configured, so the launch screen followed the
// PHONE: a phone in dark mode opened a light app on a dark splash. The dark
// splash stays configured, because the splash colour's dark variant is what a
// saved Dark Mode turns the splash to once the app is on screen
// (ios/AvenasAppearanceAppDelegateSubscriber.swift), and what Android draws
// when the app's own night mode is dark.
//
// ORDER: list this BEFORE "expo-splash-screen" in app.json's plugins. Info.plist
// mods run last-registered first, so the plugin listed earlier runs later and
// has the last word. Listed after it, splash-screen's Automatic wins again.

const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withLightLaunchScreen(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIUserInterfaceStyle = "Light";
    return cfg;
  });
};
