from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

s=s.replace('private val version = "0.2.5"','private val version = "0.2.6"')

anchor='''    @Volatile private var sellerOrdersSnapshot = "{}"
    private val version = "0.2.6"'''
replacement='''    @Volatile private var sellerOrdersSnapshot = "{}"
    private var lastHostedRefreshAt = 0L
    private val hostedAgentKick = object : Runnable {
        override fun run() {
            if (::agentWeb.isInitialized) {
                agentWeb.evaluateJavascript("window.dispatchEvent(new Event('pageshow'));", null)
            }
            if (::seller.isInitialized) verifySellerSession()
            mainHandler.postDelayed(this, 15_000L)
        }
    }
    private val version = "0.2.6"'''
if anchor not in s:
    raise SystemExit('v026 field anchor not found')
s=s.replace(anchor,replacement,1)

old='''        agentWeb.loadUrl("https://joe-nasti.github.io/marketplacescout/")
        seller.loadUrl("https://sellerportal.tcgplayer.com/")'''
new='''        agentWeb.settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        agentWeb.loadUrl("https://joe-nasti.github.io/marketplacescout/?androidBoot=${System.currentTimeMillis()}")
        lastHostedRefreshAt = System.currentTimeMillis()
        seller.loadUrl("https://sellerportal.tcgplayer.com/")
        mainHandler.postDelayed(hostedAgentKick, 5_000L)'''
if old not in s:
    raise SystemExit('v026 load anchor not found')
s=s.replace(old,new,1)

resume_kick='''
        mainHandler.postDelayed({
            if (::agentWeb.isInitialized) {
                val now = System.currentTimeMillis()
                if (now - lastHostedRefreshAt >= 5L * 60L * 1000L) {
                    lastHostedRefreshAt = now
                    agentWeb.reload()
                } else {
                    agentWeb.evaluateJavascript("window.dispatchEvent(new Event('pageshow'));", null)
                }
            }
            if (::seller.isInitialized) verifySellerSession()
        }, 350L)
        '''

# Native source already contains onResume, but historical patches changed its exact whitespace/body.
# Match the declaration structurally and inject immediately after its opening brace.
m=re.search(r'override\s+fun\s+onResume\s*\(\s*\)\s*\{',s)
if not m:
    raise SystemExit('v026 existing onResume declaration not found')
s=s[:m.end()]+resume_kick+s[m.end():]

# Add hosted-agent teardown to an existing onDestroy when present, otherwise create one.
destroy_match=re.search(r'override\s+fun\s+onDestroy\s*\(\s*\)\s*\{',s)
if destroy_match:
    s=s[:destroy_match.end()]+'\n        mainHandler.removeCallbacks(hostedAgentKick)\n        '+s[destroy_match.end():]
else:
    marker='''    private fun bg() = Color.rgb(245, 248, 252)'''
    if marker not in s:
        raise SystemExit('v026 onDestroy marker not found')
    destroy='''    override fun onDestroy() {
        mainHandler.removeCallbacks(hostedAgentKick)
        super.onDestroy()
    }

'''
    s=s.replace(marker,destroy+marker,1)

# Guard against accidentally creating duplicate lifecycle methods.
if len(re.findall(r'override\s+fun\s+onResume\s*\(',s)) != 1:
    raise SystemExit('v026 expected exactly one onResume after patch')
if len(re.findall(r'override\s+fun\s+onDestroy\s*\(',s)) != 1:
    raise SystemExit('v026 expected exactly one onDestroy after patch')

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 26',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.6"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.6 Seller sync lifecycle patch')
