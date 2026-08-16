from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

s=s.replace('private val version = "0.2.5"','private val version = "0.2.6"')

anchor='''    @Volatile private var sellerOrdersSnapshot = "{}"\n    private val version = "0.2.6"'''
replacement='''    @Volatile private var sellerOrdersSnapshot = "{}"\n    private var lastHostedRefreshAt = 0L\n    private val hostedAgentKick = object : Runnable {\n        override fun run() {\n            if (::agentWeb.isInitialized) {\n                agentWeb.evaluateJavascript(\"window.dispatchEvent(new Event('pageshow'));\", null)\n            }\n            if (::seller.isInitialized) verifySellerSession()\n            mainHandler.postDelayed(this, 15_000L)\n        }\n    }\n    private val version = "0.2.6"'''
if anchor not in s:
    raise SystemExit('v026 field anchor not found')
s=s.replace(anchor,replacement)

old='''        agentWeb.loadUrl("https://joe-nasti.github.io/marketplacescout/")\n        seller.loadUrl("https://sellerportal.tcgplayer.com/")'''
new='''        agentWeb.loadUrl("https://joe-nasti.github.io/marketplacescout/")\n        lastHostedRefreshAt = System.currentTimeMillis()\n        seller.loadUrl("https://sellerportal.tcgplayer.com/")\n        mainHandler.postDelayed(hostedAgentKick, 5_000L)'''
if old not in s:
    raise SystemExit('v026 load anchor not found')
s=s.replace(old,new)

resume_kick='''        mainHandler.postDelayed({\n            if (::agentWeb.isInitialized) {\n                val now = System.currentTimeMillis()\n                if (now - lastHostedRefreshAt >= 5L * 60L * 1000L) {\n                    lastHostedRefreshAt = now\n                    agentWeb.reload()\n                } else {\n                    agentWeb.evaluateJavascript(\"window.dispatchEvent(new Event('pageshow'));\", null)\n                }\n            }\n            if (::seller.isInitialized) verifySellerSession()\n        }, 350L)'''

# Earlier native code already has onResume(). Extend it rather than introducing a duplicate override.
resume_anchor='''    override fun onResume() {\n        super.onResume()'''
if resume_anchor not in s:
    raise SystemExit('v026 existing onResume anchor not found')
s=s.replace(resume_anchor,resume_anchor+'\n'+resume_kick,1)

# Add teardown only if one is not already present.
if 'override fun onDestroy() {' in s:
    destroy_anchor='''    override fun onDestroy() {\n        super.onDestroy()'''
    if destroy_anchor in s:
        s=s.replace(destroy_anchor,'''    override fun onDestroy() {\n        mainHandler.removeCallbacks(hostedAgentKick)\n        super.onDestroy()''',1)
else:
    marker='''    private fun bg() = Color.rgb(245, 248, 252)'''
    if marker not in s:
        raise SystemExit('v026 onDestroy marker not found')
    destroy='''    override fun onDestroy() {\n        mainHandler.removeCallbacks(hostedAgentKick)\n        super.onDestroy()\n    }\n\n'''
    s=s.replace(marker,destroy+marker,1)

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 26',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.6"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.6 Seller sync lifecycle patch')
