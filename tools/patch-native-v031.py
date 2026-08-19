from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# The hosted shell uses content-hashed Vite assets. A cached index.html can point at
# assets that no longer exist after a deploy, leaving Android on the static loading
# fallback forever. Apply this only at the end of the native patch chain so the
# historical base remains stable.
if 'settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE' not in s:
    anchor='''        settings.loadWithOverviewMode = true\n        webChromeClient = WebChromeClient()'''
    replacement='''        settings.loadWithOverviewMode = true\n        settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE\n        webChromeClient = WebChromeClient()'''
    if anchor not in s:
        raise SystemExit('final WebView settings anchor not found')
    s=s.replace(anchor,replacement,1)

plain='''        agentWeb.loadUrl("https://joe-nasti.github.io/marketplacescout/")'''
cache_busted='''        val shellBootUrl = "https://joe-nasti.github.io/marketplacescout/?androidBoot=${System.currentTimeMillis()}"\n        agentWeb.loadUrl(shellBootUrl)'''
if 'androidBoot=${System.currentTimeMillis()}' not in s:
    if plain not in s:
        raise SystemExit('hosted shell loadUrl anchor not found')
    s=s.replace(plain,cache_busted,1)

p.write_text(s)
print('Android hosted shell cache-busting enabled')
