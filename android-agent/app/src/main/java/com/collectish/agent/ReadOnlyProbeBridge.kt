package com.collectish.agent

import android.app.Activity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

class ReadOnlyProbeBridge(
    private val activity: Activity,
    private val seller: WebView,
    private val sessionState: () -> String
) {
    @Volatile private var state: String = "idle"
    @Volatile private var result: String = "{}"

    @JavascriptInterface
    fun getReadOnlyProbeState(): String = state

    @JavascriptInterface
    fun getReadOnlyProbeResult(): String = result

    @JavascriptInterface
    fun startReadOnlyProbe(configJson: String) {
        activity.runOnUiThread {
            try {
                if (sessionState() != "authenticated") {
                    fail("Seller Portal session is not authenticated")
                    return@runOnUiThread
                }

                val config = JSONObject(configJson)
                val mode = config.optString("mode", "fetch_json")
                val url = config.optString("url", "")
                val method = config.optString("method", "GET").uppercase()
                val waitMs = ReadOnlyProbePolicy.boundedWaitMs(config.optLong("waitMs", 1500L))
                val body = if (config.has("body") && !config.isNull("body")) {
                    val raw = when (val value = config.get("body")) {
                        is JSONObject -> value.toString()
                        else -> value.toString()
                    }
                    ReadOnlyProbePolicy.boundedBody(raw)
                } else ""

                if (mode !in ReadOnlyProbePolicy.allowedModes) {
                    fail("Probe mode is not allowlisted")
                    return@runOnUiThread
                }
                if (!ReadOnlyProbePolicy.isAllowedRequest(url, method)) {
                    fail("Request is not allowlisted")
                    return@runOnUiThread
                }
                if (method == "POST" && body.isBlank()) {
                    fail("Allowlisted POST requires a JSON body")
                    return@runOnUiThread
                }

                state = "running"
                result = "{}"
                when (mode) {
                    "navigate_capture" -> runNavigationCapture(url, waitMs)
                    "fetch_json", "fetch_text" -> runFetch(url, method, body, mode)
                    else -> fail("Unsupported probe mode")
                }
            } catch (e: Exception) {
                fail(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    private fun runFetch(url: String, method: String, body: String, mode: String) {
        val qUrl = JSONObject.quote(url)
        val qMethod = JSONObject.quote(method)
        val qBody = JSONObject.quote(body)
        val qMode = JSONObject.quote(mode)
        val script = """
            (async function(){
              try {
                const url=$qUrl, method=$qMethod, rawBody=$qBody, mode=$qMode;
                const opts={method,credentials:'include',headers:{'Accept':'application/json, text/plain, */*'}};
                if(method==='POST'){
                  opts.headers['Content-Type']='application/json';
                  opts.body=rawBody;
                }
                const started=Date.now();
                const response=await fetch(url,opts);
                const text=(await response.text()).slice(0,${ReadOnlyProbePolicy.maxResponseChars});
                let parsed=null;
                if(mode==='fetch_json'){
                  try{parsed=JSON.parse(text)}catch(e){}
                }
                return JSON.stringify({
                  ok:response.ok,
                  status:response.status,
                  statusText:response.statusText,
                  url:response.url||url,
                  method,
                  contentType:response.headers.get('content-type')||'',
                  elapsedMs:Date.now()-started,
                  body:parsed===null?text:parsed,
                  checkedAt:new Date().toISOString()
                });
              } catch(e) {
                return JSON.stringify({error:String(e),checkedAt:new Date().toISOString()});
              }
            })();
        """.trimIndent()
        seller.evaluateJavascript(script) { raw ->
            finishFromJavascript(raw)
        }
    }

    private fun runNavigationCapture(url: String, waitMs: Long) {
        seller.loadUrl(url)
        seller.postDelayed({
            val script = """
                (function(){
                  try {
                    const clean=s=>(s||'').replace(/\s+/g,' ').trim();
                    const tables=[...document.querySelectorAll('table')].slice(0,8).map((table,ti)=>({
                      index:ti,
                      headers:[...table.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean),
                      rows:[...table.querySelectorAll('tbody tr,tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('th,td')].map(td=>clean(td.innerText||td.textContent).slice(0,500))).filter(r=>r.length)
                    }));
                    const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/tcgplayer/i.test(u)).slice(-${ReadOnlyProbePolicy.maxNetworkRequests});
                    const links=[...document.querySelectorAll('a[href]')].slice(0,160).map(a=>({text:clean(a.innerText||a.textContent).slice(0,160),href:a.href}));
                    return JSON.stringify({
                      title:document.title||'',
                      url:location.href,
                      path:location.pathname||'/',
                      tables,
                      links,
                      resources,
                      bodyText:clean(document.body?.innerText||'').slice(0,${ReadOnlyProbePolicy.maxBodyChars}),
                      checkedAt:new Date().toISOString()
                    });
                  } catch(e) {
                    return JSON.stringify({error:String(e),checkedAt:new Date().toISOString()});
                  }
                })();
            """.trimIndent()
            seller.evaluateJavascript(script) { raw -> finishFromJavascript(raw) }
        }, waitMs)
    }

    private fun finishFromJavascript(raw: String?) {
        val decoded = decodeJsString(raw.orEmpty()).ifBlank { "{}" }
        result = decoded
        state = if (decoded.contains("\"error\":")) "error" else "ready"
    }

    private fun fail(message: String) {
        state = "error"
        result = JSONObject().put("error", message).toString()
    }

    private fun decodeJsString(raw: String): String = raw
        .replace("\\\"", "\"")
        .replace("\\n", "\n")
        .replace("\\\\", "\\")
        .trim('"')
}
