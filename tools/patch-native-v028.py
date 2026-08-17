from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Version identity.
s=s.replace('private val version = "0.2.7"','private val version = "0.2.8"')

# Native theme helpers used by the hosted WebView theme bridge.
# Match the whole configureWindowSafely function regardless of which earlier patch
# last touched its internal status/navigation-bar implementation.
replacement='''    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        applySystemTheme(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)
    }

    private fun applySystemTheme(dark: Boolean) {
        val bg = if (dark) Color.rgb(11, 21, 56) else Color.rgb(245, 248, 255)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = if (dark) 0 else (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                if (dark) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }
        if (::rootHost.isInitialized) rootHost.setBackgroundColor(bg)
        if (::nativeShell.isInitialized) nativeShell.setBackgroundColor(bg)
        if (::contentHost.isInitialized) contentHost.setBackgroundColor(bg)
    }
'''

if 'private fun applySystemTheme(dark: Boolean)' not in s:
    pattern=r'    private fun configureWindowSafely\(\) \{.*?\n    \}\n(?=\n    @SuppressLint)'
    s,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
    if n != 1:
        raise SystemExit('v028 configureWindowSafely function not found')

bridge_anchor='''        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}
'''
bridge_insert='''        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}
        @JavascriptInterface fun setTheme(theme:String){runOnUiThread{applySystemTheme(theme.equals("dark",true))}}
'''
if 'fun setTheme(theme:String)' not in s:
    if bridge_anchor not in s:
        raise SystemExit('v028 Bridge anchor not found')
    s=s.replace(bridge_anchor,bridge_insert,1)

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 28',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.8"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.8 branded system-bar theme bridge patch')
