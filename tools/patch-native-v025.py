from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

s=s.replace('import android.app.Activity\n', 'import android.app.Activity\nimport android.content.Intent\nimport android.net.Uri\n')

s=s.replace('private val version = "0.2.4"','private val version = "0.2.5"')

old='''        agentWeb = makeWebView().apply { alpha = 1f }\n        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")'''
new='''        agentWeb = makeWebView().apply { alpha = 1f }\n        agentWeb.webViewClient = collectishClient()\n        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")'''
s=s.replace(old,new)

insert='''\n    private fun openExternalUrl(url: String) {\n        if (url.isBlank()) return\n        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }\n    }\n\n    private fun collectishClient() = object : WebViewClient() {\n        override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {\n            val url = request.url?.toString().orEmpty()\n            val internal = request.url?.host.equals("joe-nasti.github.io", ignoreCase = true) &&\n                request.url?.path.orEmpty().startsWith("/marketplacescout")\n            if (!internal && (url.startsWith("https://") || url.startsWith("http://"))) {\n                openExternalUrl(url)\n                return true\n            }\n            return false\n        }\n\n        override fun onPageFinished(view: WebView, url: String) {\n            super.onPageFinished(view, url)\n            val js = """\n                (function(){\n                  if(window.__collectishExternalLinksInstalled)return;\n                  window.__collectishExternalLinksInstalled=true;\n                  document.addEventListener('click',function(e){\n                    const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;\n                    if(!a)return;\n                    try{\n                      const u=new URL(a.href,location.href);\n                      const internal=u.hostname==='joe-nasti.github.io' && u.pathname.startsWith('/marketplacescout');\n                      if(!internal && /^https?:$/.test(u.protocol)){\n                        e.preventDefault();e.stopPropagation();\n                        if(window.CollectishAndroid && CollectishAndroid.openExternal) CollectishAndroid.openExternal(u.href);\n                      }\n                    }catch(_){}\n                  },true);\n                })();\n            """.trimIndent()\n            view.evaluateJavascript(js, null)\n        }\n    }\n'''
marker='''    private fun sellerClient() = object : WebViewClient() {'''
s=s.replace(marker, insert+'\n'+marker)

bridge='''        @JavascriptInterface fun getVersion()=version'''
s=s.replace(bridge, '''        @JavascriptInterface fun getVersion()=version\n        @JavascriptInterface fun openExternal(url:String){runOnUiThread{openExternalUrl(url)}}''')

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
import re
t=re.sub(r'versionCode = \d+','versionCode = 25',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.5"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.5 external browser handoff patch')
