from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()
needle='''        settings.databaseEnabled = true\n        webChromeClient = WebChromeClient()'''
replacement='''        settings.databaseEnabled = true\n        settings.setSupportZoom(true)\n        settings.builtInZoomControls = true\n        settings.displayZoomControls = false\n        settings.useWideViewPort = true\n        settings.loadWithOverviewMode = true\n        webChromeClient = WebChromeClient()'''
if 'settings.builtInZoomControls = true' not in s:
    if needle not in s:
        raise SystemExit('WebView settings anchor not found')
    s=s.replace(needle,replacement,1)
p.write_text(s)
print('Android WebView pinch zoom enabled')
