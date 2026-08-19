package com.collectish.agent

import android.app.Activity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class ReadOnlyProbeBridge(
    private val activity: Activity,
    private val seller: WebView,
    private val sessionState: () -> String
) {
    @Volatile private var state: String = "idle"
    @Volatile private var result: String = "{}"
    @Volatile private var activeToken: String = ""

    private val storeOrigin = "https://store.tcgplayer.com/"
    private val storeOriginPrimeUrl = "https://store.tcgplayer.com/admin/direct/GetLastUpdated?categoryId=1"

    inner class SellerCallback {
        @JavascriptInterface
        fun complete(token: String, payload: String) {
            if (token != activeToken || token.isBlank()) return
            val bounded = payload.take(ReadOnlyProbePolicy.maxResponseChars + 20_000)
            result = bounded.ifBlank { "{}" }
            state = if (result.contains("\"error\":")) "error" else "ready"
        }
    }

    init {
        seller.addJavascriptInterface(SellerCallback(), "CollectishReadOnlyNative")
    }

    @JavascriptInterface fun getReadOnlyProbeState(): String = state
    @JavascriptInterface fun getReadOnlyProbeResult(): String = result

    @JavascriptInterface
    fun startReadOnlyProbe(configJson: String) {
        activity.runOnUiThread {
            try {
                if (sessionState() != "authenticated") { fail("Seller Portal session is not authenticated"); return@runOnUiThread }
                val config = JSONObject(configJson)
                val mode = config.optString("mode", "fetch_json")
                val url = config.optString("url", "")
                val method = config.optString("method", "GET").uppercase()
                val waitMs = ReadOnlyProbePolicy.boundedWaitMs(config.optLong("waitMs", 1500L))
                val body = if (config.has("body") && !config.isNull("body")) {
                    val value=config.get("body"); ReadOnlyProbePolicy.boundedBody(if(value is JSONObject)value.toString() else value.toString())
                } else ""
                if (mode !in ReadOnlyProbePolicy.allowedModes) { fail("Probe mode is not allowlisted"); return@runOnUiThread }
                if (!ReadOnlyProbePolicy.isAllowedRequest(url, method)) { fail("Request is not allowlisted"); return@runOnUiThread }
                if (method == "POST" && body.isBlank()) { fail("Allowlisted POST requires a JSON body"); return@runOnUiThread }
                activeToken = UUID.randomUUID().toString(); state = "running"; result = "{}"
                when (mode) {
                    "navigate_capture" -> runNavigationCapture(url, waitMs)
                    "fetch_json", "fetch_text", "fetch_html" -> runFetchWithOriginGuard(url, method, body, mode, activeToken)
                    else -> fail("Unsupported probe mode")
                }
            } catch (e: Exception) { fail(e.message ?: e.javaClass.simpleName) }
        }
    }

    /** Store endpoints recovered from the authenticated Store UI are same-origin
     * requests. Prime the authenticated WebView onto Store before executing any
     * allowlisted Store fetch so cookies/origin behavior matches the captured UI.
     */
    private fun runFetchWithOriginGuard(url: String, method: String, body: String, mode: String, token: String) {
        val needsStoreOrigin = url.startsWith(storeOrigin) && !seller.url.orEmpty().startsWith(storeOrigin)
        if (!needsStoreOrigin) {
            runFetch(url, method, body, mode, token)
            return
        }
        seller.loadUrl(storeOriginPrimeUrl)
        seller.postDelayed({
            if (token != activeToken || state != "running") return@postDelayed
            if (!seller.url.orEmpty().startsWith(storeOrigin)) {
                fail("Authenticated Store origin was not ready for the allowlisted request")
                return@postDelayed
            }
            runFetch(url, method, body, mode, token)
        }, 1800L)
    }

    private fun runFetch(url: String, method: String, body: String, mode: String, token: String) {
        val qUrl=JSONObject.quote(url); val qMethod=JSONObject.quote(method); val qBody=JSONObject.quote(body); val qMode=JSONObject.quote(mode); val qToken=JSONObject.quote(token)
        val script="""
            (function(){
              const sleep=ms=>new Promise(r=>setTimeout(r,ms));
              const url=$qUrl,method=$qMethod,rawBody=$qBody,mode=$qMode,token=$qToken;
              const send=o=>{try{CollectishReadOnlyNative.complete(token,JSON.stringify(o));}catch(e){}};
              (async function(){
                const maxAttempts=4;
                for(let attempt=1;attempt<=maxAttempts;attempt++){
                  try{
                    const acceptsHtml=mode==='fetch_html';
                    const opts={method,credentials:'include',cache:'no-store',headers:{'Accept':acceptsHtml?'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8':'application/json, text/plain, */*'}};
                    if(method==='POST'){opts.headers['Content-Type']='application/json';opts.body=rawBody;}
                    const started=Date.now(); const response=await fetch(url,opts); const text=(await response.text()).slice(0,${ReadOnlyProbePolicy.maxResponseChars});
                    const html=/<!doctype html|<html/i.test(text.slice(0,700));
                    const loginHtml=html&&(/sign[ -]?in|login|account\/login/i.test(text.slice(0,12000))||/login/i.test(response.url||''));
                    if(response.ok&&!loginHtml){let parsed=null;if(mode==='fetch_json'){try{parsed=JSON.parse(text)}catch(e){}}send({ok:true,status:response.status,statusText:response.statusText,url:response.url||url,method,contentType:response.headers.get('content-type')||'',elapsedMs:Date.now()-started,attempt,body:parsed===null?text:parsed,checkedAt:new Date().toISOString()});return;}
                    if(loginHtml){send({error:'TCGplayer login appears to be required',status:response.status,url:response.url||url,method,checkedAt:new Date().toISOString()});return;}
                    const transient=response.status===408||response.status===425||response.status===429||response.status>=500;
                    if(!transient||attempt>=maxAttempts){send({error:'TCGplayer returned HTTP '+response.status+': '+text.slice(0,250),status:response.status,url:response.url||url,method,checkedAt:new Date().toISOString()});return;}
                    const retryRaw=response.headers.get('retry-after'),retrySeconds=retryRaw&&Number(retryRaw);const backoff=Number.isFinite(retrySeconds)?Math.max(0,retrySeconds*1000):Math.min(8000,750*(2**(attempt-1)));await sleep(backoff+Math.floor(Math.random()*250));
                  }catch(e){if(attempt>=maxAttempts){send({error:String(e),url,method,checkedAt:new Date().toISOString()});return;}const backoff=Math.min(8000,750*(2**(attempt-1)));await sleep(backoff+Math.floor(Math.random()*250));}
                }
                send({error:'TCGplayer request failed',url,method,checkedAt:new Date().toISOString()});
              })(); return 'started';
            })();
        """.trimIndent()
        seller.evaluateJavascript(script,null)
    }

    private fun runNavigationCapture(url:String,waitMs:Long){
        seller.loadUrl(url); seller.postDelayed({
            val script="""(function(){try{const clean=s=>(s||'').replace(/\s+/g,' ').trim();const tables=[...document.querySelectorAll('table')].slice(0,8).map((table,ti)=>({index:ti,headers:[...table.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean),rows:[...table.querySelectorAll('tbody tr,tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('th,td')].map(td=>clean(td.innerText||td.textContent).slice(0,500))).filter(r=>r.length)}));const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/tcgplayer/i.test(u)).slice(-${ReadOnlyProbePolicy.maxNetworkRequests});const links=[...document.querySelectorAll('a[href]')].slice(0,160).map(a=>({text:clean(a.innerText||a.textContent).slice(0,160),href:a.href}));return JSON.stringify({title:document.title||'',url:location.href,path:location.pathname||'/',tables,links,resources,bodyText:clean(document.body?.innerText||'').slice(0,${ReadOnlyProbePolicy.maxBodyChars}),checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e),checkedAt:new Date().toISOString()})}})();""".trimIndent()
            seller.evaluateJavascript(script){raw->finishFromJavascript(raw)}
        },waitMs)
    }

    private fun finishFromJavascript(raw:String?){val decoded=decodeJsString(raw.orEmpty()).ifBlank{"{}"};result=decoded;state=if(decoded.contains("\"error\":"))"error" else "ready"}
    private fun fail(message:String){state="error";result=JSONObject().put("error",message).toString()}
    private fun decodeJsString(raw:String):String{if(raw.isBlank()||raw=="null")return "";return try{JSONArray("[$raw]").getString(0)}catch(_:Exception){raw.replace("\\\"","\"").replace("\\n","\n").replace("\\\\","\\").trim('"')}}
}
