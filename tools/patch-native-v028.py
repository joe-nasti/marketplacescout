from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Version identity.
s=s.replace('private val version = "0.2.7"','private val version = "0.2.8"')

# Native theme helpers used by the hosted WebView theme bridge.
anchor='''    private fun configureWindowSafely() {\n        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)\n        window.statusBarColor = Color.WHITE\n        window.navigationBarColor = Color.WHITE\n        @Suppress("DEPRECATION")\n        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)\n    }\n'''
replacement='''    private fun configureWindowSafely() {\n        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)\n        applySystemTheme(false)\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)\n    }\n\n    private fun applySystemTheme(dark: Boolean) {\n        val bg = if (dark) Color.rgb(11, 18, 32) else Color.rgb(245, 248, 252)\n        window.statusBarColor = bg\n        window.navigationBarColor = bg\n        @Suppress("DEPRECATION")\n        window.decorView.systemUiVisibility = if (dark) 0 else (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {\n            window.insetsController?.setSystemBarsAppearance(\n                if (dark) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,\n                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS\n            )\n        }\n        if (::rootHost.isInitialized) rootHost.setBackgroundColor(bg)\n        if (::nativeShell.isInitialized) nativeShell.setBackgroundColor(bg)\n        if (::contentHost.isInitialized) contentHost.setBackgroundColor(bg)\n    }\n'''
if anchor not in s:
    raise SystemExit('v028 configureWindowSafely anchor not found')
s=s.replace(anchor,replacement,1)

bridge_anchor='''        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}\n'''
bridge_insert='''        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}\n        @JavascriptInterface fun setTheme(theme:String){runOnUiThread{applySystemTheme(theme.equals("dark",true))}}\n'''
if bridge_anchor not in s:
    raise SystemExit('v028 Bridge anchor not found')
s=s.replace(bridge_anchor,bridge_insert,1)

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 28',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.8"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.8 system-bar theme bridge patch')
