package com.collectish.agent

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
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
    @Volatile private var buyerSessionState: String = "unknown"
    @Volatile private var buyerRenderedToken: String = ""
    @Volatile private var buyerRenderedRequestedUrl: String = ""
    @Volatile private var buyerRenderedWaitMs: Long = 1500L
    @Volatile private var buyerRenderedStartedToken: String = ""

    private val storeOrigin = "https://store.tcgplayer.com/"
    private val storeOriginPrimeUrl = "https://store.tcgplayer.com/admin/direct/GetLastUpdated?categoryId=1"
    private val buyerHistoryPrimeUrl = "https://store.tcgplayer.com/myaccount/orderhistory"
    private val buyerLoginUrl = "https://www.tcgplayer.com/login?returnUrl=/myaccount/orderhistory"
    private val buyerProfileSupported = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    private var buyer: WebView? = null
    private var buyerHost: FrameLayout? = null
    private val callback = ProbeCallback()

    inner class ProbeCallback {
        @JavascriptInterface
        fun complete(token: String, payload: String) {
            if (token != activeToken || token.isBlank()) return
            val bounded = payload.take(ReadOnlyProbePolicy.maxResponseChars + 20_000)
            result = bounded.ifBlank { "{}" }
            state = if (result.contains("\"error\":")) "error" else "ready"
            if (token == buyerRenderedToken) clearBuyerRenderedCapture()
        }
    }

    init { seller.addJavascriptInterface(callback, "CollectishReadOnlyNative") }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    private fun installSafeInsets(view: View) {
        view.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        view.requestApplyInsets()
    }

    private fun persistBuyerSession() {
        runCatching { CookieManager.getInstance().flush() }
    }

    private fun hideBuyerSession() {
        persistBuyerSession()
        buyerHost?.visibility = View.GONE
    }

    private fun clearBuyerRenderedCapture() {
        buyerRenderedToken = ""
        buyerRenderedRequestedUrl = ""
        buyerRenderedWaitMs = 1500L
        buyerRenderedStartedToken = ""
    }

    private fun ensureBuyerWebView(): WebView? {
        if (!buyerProfileSupported) return null
        buyer?.let { return it }
        val host = FrameLayout(activity).apply { setBackgroundColor(Color.WHITE); visibility = View.GONE }
        installSafeInsets(host)
        val view = WebView(activity)
        WebViewCompat.setProfile(view, "collectish-buyer")
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.databaseEnabled = true
        // Keep the isolated profile's normal persistent browser storage. Hosted Collectish
        // refreshes must not be coupled to TCGplayer buyer authentication state.
        view.settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        view.webChromeClient = WebChromeClient()
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String) {
                val lower = url.lowercase()
                buyerSessionState = if (lower.contains("/login") || lower.contains("signin")) "signed_out"
                    else if (lower.contains("tcgplayer.com") && lower.contains("/myaccount")) "authenticated"
                    else "unknown"
                persistBuyerSession()
                handleBuyerRenderedPageFinished(v, url)
            }
        }
        view.addJavascriptInterface(callback, "CollectishReadOnlyNative")
        view.setBackgroundColor(Color.WHITE)

        val toolbar = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(Color.rgb(245, 248, 252)) }
        val browserBack = Button(activity).apply {
            text = "← Back"; isAllCaps = false; textSize = 14f
            setOnClickListener { if (view.canGoBack()) view.goBack() else hideBuyerSession() }
        }
        val spacer = View(activity)
        val returnButton = Button(activity).apply {
            text = "Return to Collectish"; isAllCaps = false; textSize = 14f
            setOnClickListener { hideBuyerSession() }
        }
        toolbar.addView(browserBack, LinearLayout.LayoutParams(-2, -1))
        toolbar.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))
        toolbar.addView(returnButton, LinearLayout.LayoutParams(-2, -1))
        host.addView(view, FrameLayout.LayoutParams(-1, -1).apply { topMargin = dp(56) })
        host.addView(toolbar, FrameLayout.LayoutParams(-1, dp(56), Gravity.TOP))
        activity.addContentView(host, FrameLayout.LayoutParams(-1, -1))
        buyerHost = host
        buyer = view
        return view
    }

    @JavascriptInterface fun getReadOnlyProbeState(): String = state
    @JavascriptInterface fun getReadOnlyProbeResult(): String = result
    @JavascriptInterface fun getBuyerSessionState(): String = if (!buyerProfileSupported) "unsupported" else buyerSessionState
    @JavascriptInterface fun isBuyerProfileIsolated(): Boolean = buyerProfileSupported
    @JavascriptInterface fun persistBuyerSessionNow() { persistBuyerSession() }

    @JavascriptInterface
    fun showBuyerSession() {
        activity.runOnUiThread {
            val view = ensureBuyerWebView()
            if (view == null) { fail("This Android WebView does not support isolated buyer profiles"); return@runOnUiThread }
            buyerHost?.visibility = View.VISIBLE
            when {
                buyerSessionState == "signed_out" -> view.loadUrl(buyerLoginUrl)
                view.url.isNullOrBlank() -> view.loadUrl(buyerHistoryPrimeUrl)
            }
        }
    }

    @JavascriptInterface
    fun startReadOnlyProbe(configJson: String) {
        activity.runOnUiThread {
            try {
                val config = JSONObject(configJson)
                val mode = config.optString("mode", "fetch_json")
                val url = config.optString("url", "")
                val method = config.optString("method", "GET").uppercase()
                val waitMs = ReadOnlyProbePolicy.boundedWaitMs(config.optLong("waitMs", 1500L))
                val contentType = config.optString("contentType", "application/json").take(120)
                val body = if (config.has("body") && !config.isNull("body")) {
                    val value=config.get("body"); ReadOnlyProbePolicy.boundedBody(if(value is JSONObject)value.toString() else value.toString())
                } else ""
                if (mode !in ReadOnlyProbePolicy.allowedModes) { fail("Probe mode is not allowlisted"); return@runOnUiThread }
                if (!ReadOnlyProbePolicy.isAllowedRequest(url, method)) { fail("Request is not allowlisted"); return@runOnUiThread }
                if (ReadOnlyProbePolicy.isBuyerAccountRequest(url) && ensureBuyerWebView() == null) { fail("Isolated buyer WebView profile is not supported on this device"); return@runOnUiThread }
                if (method == "POST" && body.isBlank()) { fail("Allowlisted POST requires a body"); return@runOnUiThread }
                if (ReadOnlyProbePolicy.isBuyerHistoryRequest(url) && method == "POST" && !contentType.startsWith("application/x-www-form-urlencoded")) {
                    fail("Buyer Order History POST must be form-encoded"); return@runOnUiThread
                }
                activeToken = UUID.randomUUID().toString(); state = "running"; result = "{}"
                when {
                    ReadOnlyProbePolicy.isBuyerAccountRequest(url) && mode == "fetch_html" && method == "GET" -> runBuyerRenderedHtml(url, waitMs, activeToken)
                    mode == "navigate_capture" -> runNavigationCapture(url, waitMs)
                    mode in setOf("fetch_json", "fetch_text", "fetch_html") -> runFetchWithOriginGuard(url, method, body, mode, activeToken, contentType)
                    else -> fail("Unsupported probe mode")
                }
            } catch (e: Exception) { fail(e.message ?: e.javaClass.simpleName) }
        }
    }

    private fun targetFor(url: String): WebView? = if (ReadOnlyProbePolicy.isBuyerAccountRequest(url)) ensureBuyerWebView() else seller

    private fun runBuyerRenderedHtml(url: String, waitMs: Long, token: String) {
        val target = ensureBuyerWebView() ?: run { fail("Buyer WebView is unavailable"); return }
        buyerRenderedToken = token; buyerRenderedRequestedUrl = url; buyerRenderedWaitMs = waitMs; buyerRenderedStartedToken = ""
        target.loadUrl(url)
    }

    private fun handleBuyerRenderedPageFinished(target: WebView, finalUrl: String) {
        val token = buyerRenderedToken
        if (token.isBlank() || token != activeToken || state != "running") return
        val lower = finalUrl.lowercase()
        if (lower.contains("/login") || lower.contains("signin")) { clearBuyerRenderedCapture(); fail("TCGplayer buyer session is not authenticated"); return }
        if (!ReadOnlyProbePolicy.isBuyerAccountRequest(finalUrl) || buyerRenderedStartedToken == token) return
        buyerRenderedStartedToken = token
        val qToken = JSONObject.quote(token)
        val qRequested = JSONObject.quote(buyerRenderedRequestedUrl)
        val settleMs = buyerRenderedWaitMs.coerceAtLeast(5000L).coerceAtMost(10_000L)
        val script = """
            (function(){
              const token=$qToken,requestedUrl=$qRequested,maxWait=${settleMs};
              const started=Date.now(); let lastSig='',stable=0;
              const send=o=>{try{CollectishReadOnlyNative.complete(token,JSON.stringify(o));}catch(e){}};
              const tick=()=>{try{
                const href=location.href||'';
                if(/login|signin|account\/login/i.test(href)){send({error:'TCGplayer login appears to be required',url:href,requestedUrl,checkedAt:new Date().toISOString()});return;}
                const html=document.documentElement?.outerHTML||'',bodyText=document.body?.innerText||'';
                const sig=[document.readyState,html.length,bodyText.length,document.querySelectorAll('.orderWrap').length,document.querySelectorAll('table').length].join(':');
                if(sig===lastSig)stable++;else stable=0;lastSig=sig;
                const meaningful=html.length>1000||bodyText.length>250;
                if((document.readyState==='complete'&&meaningful&&stable>=3)||Date.now()-started>=maxWait){
                  if(!meaningful){send({error:'TCGplayer buyer page rendered without usable content',url:href,requestedUrl,checkedAt:new Date().toISOString()});return;}
                  let u={host:'',path:''};try{const x=new URL(href);u={host:x.host,path:x.pathname}}catch(e){}
                  send({ok:true,status:200,statusText:'Rendered',url:href,requestedUrl,finalHost:u.host,finalPath:u.path,method:'GET',contentType:'text/html; rendered=javascript',elapsedMs:Date.now()-started,attempt:1,rendered:true,javascriptEnabled:true,body:html.slice(0,${ReadOnlyProbePolicy.maxResponseChars}),checkedAt:new Date().toISOString()});return;
                }
                setTimeout(tick,350);
              }catch(e){send({error:String(e),url:location.href||'',requestedUrl,checkedAt:new Date().toISOString()});}};
              setTimeout(tick,250); return 'started';
            })();
        """.trimIndent()
        target.evaluateJavascript(script, null)
    }

    private fun runFetchWithOriginGuard(url: String, method: String, body: String, mode: String, token: String, contentType: String) {
        val target = targetFor(url) ?: run { fail("Buyer WebView is unavailable"); return }
        val buyerRequest = ReadOnlyProbePolicy.isBuyerAccountRequest(url)
        val needsStoreOrigin = url.startsWith(storeOrigin) && !target.url.orEmpty().startsWith(storeOrigin)
        if (!needsStoreOrigin) { runFetch(target, url, method, body, mode, token, contentType); return }
        val primeUrl = if (buyerRequest) buyerHistoryPrimeUrl else storeOriginPrimeUrl
        target.loadUrl(primeUrl)
        target.postDelayed({
            if (token != activeToken || state != "running") return@postDelayed
            if (!target.url.orEmpty().startsWith(storeOrigin)) {
                fail(if (buyerRequest) "TCGplayer buyer session is not authenticated" else "TCGplayer Store session is not authenticated (Store origin redirected away before request)")
                return@postDelayed
            }
            runFetch(target, url, method, body, mode, token, contentType)
        }, 1800L)
    }

    private fun runFetch(target: WebView, url: String, method: String, body: String, mode: String, token: String, contentType: String) {
        val qUrl=JSONObject.quote(url); val qMethod=JSONObject.quote(method); val qBody=JSONObject.quote(body); val qMode=JSONObject.quote(mode); val qToken=JSONObject.quote(token); val qContentType=JSONObject.quote(contentType)
        val script="""
            (function(){
              const sleep=ms=>new Promise(r=>setTimeout(r,ms));
              const url=$qUrl,method=$qMethod,rawBody=$qBody,mode=$qMode,token=$qToken,contentType=$qContentType;
              const send=o=>{try{CollectishReadOnlyNative.complete(token,JSON.stringify(o));}catch(e){}};
              (async function(){
                const maxAttempts=4;
                for(let attempt=1;attempt<=maxAttempts;attempt++){
                  try{
                    const acceptsHtml=mode==='fetch_html';
                    const opts={method,credentials:'include',cache:'no-store',headers:{'Accept':acceptsHtml?'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8':'application/json, text/plain, */*'}};
                    if(method==='POST'){opts.headers['Content-Type']=contentType||'application/json';opts.body=rawBody;}
                    const started=Date.now(),response=await fetch(url,opts),text=(await response.text()).slice(0,${ReadOnlyProbePolicy.maxResponseChars});
                    const html=/<!doctype html|<html/i.test(text.slice(0,700)),finalUrl=response.url||url;let finalHost='',finalPath='';try{const u=new URL(finalUrl);finalHost=u.host;finalPath=u.pathname}catch(e){}
                    const loginByUrl=/login|signin|account\/login/i.test(finalUrl),loginByBody=html&&/sign[ -]?in|log[ -]?in|forgot password|account\/login/i.test(text.slice(0,12000));
                    if(response.ok&&!loginByUrl&&!loginByBody){let parsed=null;if(mode==='fetch_json'){try{parsed=JSON.parse(text)}catch(e){}}send({ok:true,status:response.status,statusText:response.statusText,url:finalUrl,requestedUrl:url,finalHost,finalPath,method,contentType:response.headers.get('content-type')||'',elapsedMs:Date.now()-started,attempt,body:parsed===null?text:parsed,checkedAt:new Date().toISOString()});return;}
                    if(loginByUrl||loginByBody){send({error:'TCGplayer login appears to be required',status:response.status,url:finalUrl,requestedUrl:url,loginByUrl,loginByBody,checkedAt:new Date().toISOString()});return;}
                    const transient=response.status===408||response.status===425||response.status===429||response.status>=500;
                    if(!transient||attempt>=maxAttempts){send({error:'TCGplayer returned HTTP '+response.status+': '+text.slice(0,250),status:response.status,url:finalUrl,method,checkedAt:new Date().toISOString()});return;}
                    const retryRaw=response.headers.get('retry-after'),retrySeconds=retryRaw&&Number(retryRaw),backoff=Number.isFinite(retrySeconds)?Math.max(0,retrySeconds*1000):Math.min(8000,750*(2**(attempt-1)));await sleep(backoff+Math.floor(Math.random()*250));
                  }catch(e){if(attempt>=maxAttempts){send({error:String(e),url,method,checkedAt:new Date().toISOString()});return;}await sleep(Math.min(8000,750*(2**(attempt-1)))+Math.floor(Math.random()*250));}
                }
              })(); return 'started';
            })();
        """.trimIndent()
        target.evaluateJavascript(script,null)
    }

    private fun runNavigationCapture(url:String,waitMs:Long){
        val target = targetFor(url) ?: run { fail("Buyer WebView is unavailable"); return }
        target.loadUrl(url); target.postDelayed({
            val script="""(function(){try{const clean=s=>(s||'').replace(/\s+/g,' ').trim();const tables=[...document.querySelectorAll('table')].slice(0,8).map((table,ti)=>({index:ti,headers:[...table.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean),rows:[...table.querySelectorAll('tbody tr,tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('th,td')].map(td=>clean(td.innerText||td.textContent).slice(0,500))).filter(r=>r.length)}));const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/tcgplayer/i.test(u)).slice(-${ReadOnlyProbePolicy.maxNetworkRequests});const links=[...document.querySelectorAll('a[href]')].slice(0,160).map(a=>({text:clean(a.innerText||a.textContent).slice(0,160),href:a.href}));return JSON.stringify({title:document.title||'',url:location.href,path:location.pathname||'/',tables,links,resources,bodyText:clean(document.body?.innerText||'').slice(0,${ReadOnlyProbePolicy.maxBodyChars}),checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e),checkedAt:new Date().toISOString()})}})();""".trimIndent()
            target.evaluateJavascript(script){raw->finishFromJavascript(raw)}
        },waitMs)
    }

    private fun finishFromJavascript(raw:String?){val decoded=decodeJsString(raw.orEmpty()).ifBlank{"{}"};result=decoded;state=if(decoded.contains("\"error\":"))"error" else"ready"}
    private fun fail(message:String){clearBuyerRenderedCapture();state="error";result=JSONObject().put("error",message).toString()}
    private fun decodeJsString(raw:String):String{if(raw.isBlank()||raw=="null")return "";return try{JSONArray("[$raw]").getString(0)}catch(_:Exception){raw.replace("\\\"","\"").replace("\\n","\n").replace("\\\\","\\").trim('"')}}
}
