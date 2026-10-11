package expo.modules.avenasappearance

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AvenasAppearanceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AvenasAppearance")

    // The app's Dark Mode as this app's own night mode (Android 12+). Android
    // keeps it and draws the next launch's splash in it, where it otherwise
    // follows the phone. Before 12 there's no such setting, and the splash
    // follows the phone.
    AsyncFunction("saveTheme") { dark: Boolean ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction
      val context = appContext.reactContext ?: return@AsyncFunction
      val uiModeManager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        ?: return@AsyncFunction
      uiModeManager.setApplicationNightMode(
        if (dark) UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO
      )
    }.runOnQueue(Queues.MAIN)
  }
}
