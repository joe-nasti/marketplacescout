from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Version identity.
for old in ['private val version = "0.2.4"','private val version = "0.2.5"','private val version = "0.2.6"','private val version = "0.2.7"']:
    s=s.replace(old,'private val version = "0.2.8"')

# Native theme helpers used by the hosted WebView theme bridge.
# v0.2.1 inserted installSafeInsets() immediately after configureWindowSafely(),
# so do not anchor this replacement to @SuppressLint/makeWebView.
replacement='''    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }
        applySystemTheme(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(false)
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
    start=s.find('    private fun configureWindowSafely() {')
    if start < 0:
        raise SystemExit('v028 configureWindowSafely function not found')
    # Locate the next top-level private function, which is installSafeInsets after v0.2.1.
    end=s.find('\n    private fun installSafeInsets(', start)
    if end < 0:
        end=s.find('\n    @SuppressLint', start)
    if end < 0:
        raise SystemExit('v028 configureWindowSafely end anchor not found')
    s=s[:start]+replacement.rstrip()+s[end:]

# The hosted UI bridge shape changed in v0.2.4. Support either form.
anchors=[
'''        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}
''',
'''        @JavascriptInterface fun showCollectish(){runOnUiThread{seller.visibility=View.GONE;nativeShell.visibility=View.GONE;agentWeb.visibility=View.VISIBLE}}
'''
]
if 'fun setTheme(theme:String)' not in s:
    matched=None
    for anchor in anchors:
        if anchor in s:
            matched=anchor
            break
    if matched is None:
        raise SystemExit('v028 Bridge anchor not found')
    s=s.replace(matched,matched+'        @JavascriptInterface fun setTheme(theme:String){runOnUiThread{applySystemTheme(theme.equals("dark",true))}}\n',1)

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 28',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.8"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.8 branded system-bar theme bridge patch')
