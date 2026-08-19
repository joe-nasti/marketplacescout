from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Resume should never reload or synthesize browser lifecycle events. The visible hosted
# WebView is a stateful app; backgrounding, screen-off, and ordinary onResume must leave
# its DOM/history/JS state untouched.
kick='''            if (::agentWeb.isInitialized) {\n                agentWeb.evaluateJavascript("window.dispatchEvent(new Event('pageshow'));", null)\n            }\n            if (::seller.isInitialized) verifySellerSession()'''
if kick in s:
    s=s.replace(kick,'''            if (::seller.isInitialized) verifySellerSession()''',1)

resume_pattern=re.compile(r'''    override\s+fun\s+onResume\s*\(\s*\)\s*\{.*?\n    override\s+fun\s+onBackPressed\s*\(''',re.S)
m=resume_pattern.search(s)
if not m:
    raise SystemExit('v033 onResume/onBackPressed block not found')
resume='''    override fun onResume(){\n        super.onResume()\n        if(::seller.isInitialized) verifySellerSession()\n    }\n    override fun onBackPressed('''
s=s[:m.start()]+resume+s[m.end():]

# Preserve the visible WebView across Activity recreation. This handles configuration/
# process recreation paths where Android supplies savedInstanceState instead of treating
# every recreation as a cold app launch.
load_pattern=re.compile(r'''        val shellBootUrl = "https://joe-nasti\.github\.io/marketplacescout/\?androidBoot=\$\{System\.currentTimeMillis\(\)\}"\n        agentWeb\.loadUrl\(shellBootUrl\)''')
m=load_pattern.search(s)
if not m:
    raise SystemExit('v033 cache-safe hosted load anchor not found')
load='''        val restoredHostedState = savedInstanceState != null && agentWeb.restoreState(savedInstanceState) != null\n        if (!restoredHostedState) {\n            val shellBootUrl = "https://joe-nasti.github.io/marketplacescout/?androidBoot=${System.currentTimeMillis()}"\n            agentWeb.loadUrl(shellBootUrl)\n        }'''
s=s[:m.start()]+load+s[m.end():]

if 'override fun onSaveInstanceState(outState: Bundle)' not in s:
    marker='''    override fun onDestroy() {'''
    if marker not in s:
        raise SystemExit('v033 onDestroy marker missing')
    method='''    override fun onSaveInstanceState(outState: Bundle) {\n        if (::agentWeb.isInitialized) agentWeb.saveState(outState)\n        super.onSaveInstanceState(outState)\n    }\n\n'''
    s=s.replace(marker,method+marker,1)

# Durable assertions: no synthetic pageshow and no resume reload remain after this patch.
if "dispatchEvent(new Event('pageshow'))" in s:
    raise SystemExit('v033 synthetic pageshow remains')
resume_body=re.search(r'override\s+fun\s+onResume\s*\([^)]*\)\s*\{(.*?)\n\s*\}',s,re.S)
if resume_body and '.reload()' in resume_body.group(1):
    raise SystemExit('v033 reload remains in onResume')
if 'agentWeb.saveState(outState)' not in s or 'agentWeb.restoreState(savedInstanceState)' not in s:
    raise SystemExit('v033 WebView state preservation missing')

p.write_text(s)
print('Android hosted WebView resume/state preservation enabled')
