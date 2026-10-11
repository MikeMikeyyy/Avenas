import ExpoModulesCore

public class AvenasAppearanceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AvenasAppearance")

    // The app's Dark Mode, for the next launch's splash
    // (AvenasAppearanceAppDelegateSubscriber). What's on screen now changes
    // through React Native's Appearance.setColorScheme, called beside this.
    AsyncFunction("saveTheme") { (dark: Bool) in
      SavedTheme.save(dark: dark)
    }
  }
}

/// The app's own Dark Mode, where code running at launch can read it, before
/// any JavaScript has loaded.
enum SavedTheme {
  private static let key = "avenas.theme"

  static var isDark: Bool {
    UserDefaults.standard.string(forKey: key) == "dark"
  }

  static func save(dark: Bool) {
    UserDefaults.standard.set(dark ? "dark" : "light", forKey: key)
  }
}
