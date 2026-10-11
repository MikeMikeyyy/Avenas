import ExpoModulesCore
import UIKit

/// Opens the app in its own Dark Mode rather than the phone's.
///
/// iOS draws the launch screen before any app code runs, from Info.plist,
/// which app.plugin.js sets to Light: white for everyone, the app's own
/// default. The app's first frame is light too, so the hand-over from the
/// launch screen can't be seen; then a saved Dark Mode fades the window to
/// dark, the splash still covering it, and ThemeContext takes the window's
/// appearance over once the JavaScript has loaded.
public class AvenasAppearanceAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private var launched = false

  public func applicationDidBecomeActive(_ application: UIApplication) {
    // The launch only: from then on the window follows the app (ThemeContext).
    guard !launched else { return }
    launched = true
    guard SavedTheme.isDark else { return }

    // A turn of the run loop later, so the light first frame is up to fade from.
    DispatchQueue.main.async {
      guard let window = UIApplication.shared.delegate?.window ?? nil,
            // The JavaScript has already set it: it read the setting itself.
            window.overrideUserInterfaceStyle == .unspecified else { return }
      UIView.transition(with: window, duration: 0.3, options: [.transitionCrossDissolve, .allowUserInteraction]) {
        window.overrideUserInterfaceStyle = .dark
      }
    }
  }
}
