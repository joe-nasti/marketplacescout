from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Native hosted-shell diagnostics. Applied after the historical patch chain so it does
# not disturb older patch anchors.
for imp in [
    'import android.webkit.ConsoleMessage\n',
    'import android.webkit.WebResourceError\n',
    'import android.webkit.WebResourceRequest\n',
    'import android.webkit.WebResourceResponse\n'
]:
    if imp not in s:
        s=s.replace('import android.webkit.WebChromeClient\n','import android.webkit.WebChromeClient\n'+imp,1)

field='''    private val hostedBootDiagnostics = mutableListOf<String>()\n'''
anchor='''    private lateinit var seller: WebView\n'''
if field not in s:
    if anchor not in s: raise SystemExit('v032 seller field anchor missing')
    s=s.replace(anchor,anchor+field,1)

# Give the visible hosted WebView a console-aware chrome client.
needle='''        agentWeb.webViewClient = collectishClient()\n        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")'''
replacement='''        agentWeb.webViewClient = collectishClient()\n        agentWeb.webChromeClient = object : WebChromeClient() {\n            override fun onConsoleMessage(message: ConsoleMessage): Boolean {\n                val line = "console ${message.messageLevel()}: ${message.message()} @ ${message.sourceId()}:${message.lineNumber()}"\n                hostedBootDiagnostics.add(line.take(500))\n                return super.onConsoleMessage(message)\n            }\n        }\n        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")'''
if 'hostedBootDiagnostics.add(line.take(500))' not in s:
    if needle not in s: raise SystemExit('v032 agentWeb client anchor missing')
    s=s.replace(needle,replacement,1)

# Extend the hosted client with resource errors and a native-delayed boot inspection.
needle='''        override fun onPageFinished(view: WebView, url: String) {\n            super.onPageFinished(view, url)\n            val js = """'''
replacement='''        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {\n            hostedBootDiagnostics.add(("resource error ${error.errorCode}: ${error.description} · ${request.url}").take(500))\n            super.onReceivedError(view, request, error)\n        }\n\n        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {\n            hostedBootDiagnostics.add(("HTTP ${errorResponse.statusCode} ${errorResponse.reasonPhrase} · ${request.url}").take(500))\n            super.onReceivedHttpError(view, request, errorResponse)\n        }\n\n        override fun onPageFinished(view: WebView, url: String) {\n            super.onPageFinished(view, url)\n            mainHandler.postDelayed({ runHostedBootDiagnostic(view) }, 8_000L)\n            val js = """'''
if 'runHostedBootDiagnostic(view)' not in s:
    if needle not in s: raise SystemExit('v032 onPageFinished anchor missing')
    s=s.replace(needle,replacement,1)

# Native inspection: if Collectish has not replaced the static fallback after 8s,
# replace only the fallback copy with a diagnostic summary. evaluateJavascript itself
# still runs even when the app module graph has failed.
marker='''    private fun sellerClient() = object : WebViewClient() {'''
method=r'''    private fun runHostedBootDiagnostic(view: WebView) {
        if (!::agentWeb.isInitialized || view !== agentWeb) return
        val probe = """
            (function(){
              try{
                const fallback=document.getElementById('collectishBootFallback');
                if(!fallback)return JSON.stringify({booted:true,href:location.href,readyState:document.readyState});
                const scripts=[...document.scripts].map(s=>({src:s.src||'',type:s.type||'',inline:!s.src}));
                return JSON.stringify({booted:false,href:location.href,readyState:document.readyState,fallbackText:fallback.innerText||'',errors:window.__collectishBootErrors||[],scripts,userAgent:navigator.userAgent});
              }catch(e){return JSON.stringify({booted:false,probeError:String(e),href:location.href});}
            })();
        """.trimIndent()
        view.evaluateJavascript(probe) { raw ->
            if (raw.isNullOrBlank() || raw == "null") {
                showHostedBootDiagnostic("WebView JavaScript did not answer the native boot probe.")
                return@evaluateJavascript
            }
            val decoded = decodeJsString(raw)
            if (decoded.contains("\"booted\":true")) return@evaluateJavascript
            val nativeErrors = hostedBootDiagnostics.takeLast(8).joinToString(" | ")
            showHostedBootDiagnostic("Hosted shell did not boot. $decoded" + if(nativeErrors.isNotBlank()) " | native: $nativeErrors" else "")
        }
    }

    private fun showHostedBootDiagnostic(message: String) {
        runOnUiThread {
            if (!::agentWeb.isInitialized || agentWeb.visibility != View.VISIBLE) return@runOnUiThread
            val escaped = JSONObject.quote(message.take(3500))
            val js = """
                (function(){
                  var host=document.getElementById('collectishBootFallback'); if(!host)return;
                  var card=host.querySelector('div'); if(!card)return;
                  var span=card.querySelector('span'); if(span)span.textContent='Collectish startup failed';
                  var old=document.getElementById('collectishNativeBootDiagnostic'); if(old)old.remove();
                  var d=document.createElement('small'); d.id='collectishNativeBootDiagnostic';
                  d.style.cssText='display:block;margin-top:12px;text-align:left;white-space:pre-wrap;font-size:11px;line-height:1.35;word-break:break-word;color:#9b1c1c';
                  d.textContent=$escaped; card.appendChild(d);
                })();
            """.trimIndent()
            agentWeb.evaluateJavascript(js, null)
        }
    }

'''
if 'private fun runHostedBootDiagnostic(view: WebView)' not in s:
    if marker not in s: raise SystemExit('v032 diagnostic insertion marker missing')
    s=s.replace(marker,method+marker,1)

# JSONObject is needed for safe JS string quoting.
if 'import org.json.JSONObject\n' not in s:
    s=s.replace('import org.json.JSONArray\n','import org.json.JSONArray\nimport org.json.JSONObject\n',1)

p.write_text(s)
print('Android hosted-shell native diagnostics enabled')
