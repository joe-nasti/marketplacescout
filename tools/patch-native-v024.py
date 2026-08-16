from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Version identity.
for old in ['private val version = "0.2.0"','private val version = "0.2.1"','private val version = "0.2.2"','private val version = "0.2.3"']:
    s=s.replace(old,'private val version = "0.2.4"')
for old in ['Collectish 0.2.0','Collectish 0.2.1','Collectish 0.2.2','Collectish 0.2.3']:
    s=s.replace(old,'Collectish 0.2.4')

# The hosted Collectish WebView becomes the visible product UI. Native views remain as a
# fallback implementation in source but are no longer mounted as the normal app surface.
s=s.replace('agentWeb = makeWebView().apply { alpha = 0.01f }','agentWeb = makeWebView().apply { alpha = 1f }')
s=s.replace('rootHost.addView(agentWeb, FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.START))',
            'rootHost.addView(agentWeb, FrameLayout.LayoutParams(-1, -1))')
s=s.replace('if (accessToken.isNullOrBlank()) showLogin() else showPage("scout")',
            'nativeShell.visibility = View.GONE\n        agentWeb.visibility = View.VISIBLE')

# Seller Portal remains a native WebView destination, returning to the unified hosted UI.
s=s.replace('private fun showSeller(){ nativeShell.visibility=View.GONE;seller.visibility=View.VISIBLE }',
            'private fun showSeller(){ nativeShell.visibility=View.GONE;agentWeb.visibility=View.GONE;seller.visibility=View.VISIBLE }')
s=s.replace('@JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}',
            '@JavascriptInterface fun showCollectish(){runOnUiThread{seller.visibility=View.GONE;nativeShell.visibility=View.GONE;agentWeb.visibility=View.VISIBLE}}')
s=s.replace('seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;nativeShell.visibility=View.VISIBLE}',
            'seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;nativeShell.visibility=View.GONE;agentWeb.visibility=View.VISIBLE}')

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
import re
t=re.sub(r'versionCode = \d+','versionCode = 24',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.4"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.4 unified hosted UI patch')