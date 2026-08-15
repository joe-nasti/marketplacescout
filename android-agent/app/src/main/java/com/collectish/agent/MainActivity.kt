package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var collectishHost: FrameLayout
    private lateinit var collectish: WebView
    private lateinit var collectishStatus: LinearLayout
    private lateinit var collectishStatusTitle: TextView
    private lateinit var collectishStatusDetail: TextView
    private lateinit var collectishRetry: Button
    private lateinit var seller: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var sellerSessionState = "unknown"
    @Volatile private var sellerPortalSnapshot = "{}"
    @Volatile private var sellerOrdersProbeState = "idle"
    @Volatile private var sellerOrdersSnapshot = "{}"
    @Volatile private var collectishReady = false
    private val version = "0.1.13"
    private val collectishUrl = "https://joe-nasti.github.io/marketplacescout/"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindowSafely()
        CookieManager.getInstance().setAcceptCookie(true)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            fitsSystemWindows = true
            setBackgroundColor(Color.rgb(245, 248, 252))
        }
        val content = FrameLayout(this).apply { setBackgroundColor(Color.rgb(245, 248, 252)) }

        collectishHost = FrameLayout(this).apply { setBackgroundColor(Color.rgb(245, 248, 252)) }
        collectish = makeWebView().apply {
            visibility = View.INVISIBLE
            setBackgroundColor(Color.rgb(245, 248, 252))
        }
        collectishStatus = buildCollectishStatus()
        collectishHost.addView(collectish, FrameLayout.LayoutParams(-1, -1))
        collectishHost.addView(collectishStatus, FrameLayout.LayoutParams(-1, -1))

        seller = makeWebView()
        content.addView(collectishHost, FrameLayout.LayoutParams(-1, -1))
        content.addView(seller, FrameLayout.LayoutParams(-1, -1))
        seller.visibility = View.GONE

        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
        }
        nav.addView(Button(this).apply {
            text = "Collectish"
            setOnClickListener { verifySellerSession { showCollectish() } }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        nav.addView(Button(this).apply {
            text = "TCGplayer"
            setOnClickListener { showSeller() }
        }, LinearLayout.LayoutParams(0, -2, 1f))

        root.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(nav, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        collectish.addJavascriptInterface(Bridge(), "CollectishAndroid")
        collectish.addJavascriptInterface(ReadOnlyProbeBridge(this, seller) { sellerSessionState }, "CollectishReadOnly")
        collectish.webViewClient = collectishClient()
        seller.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                verifySellerSession()
                if (sellerOrdersProbeState == "navigating") {
                    sellerOrdersProbeState = "collecting"
                    mainHandler.postDelayed({ captureSellerOrdersProbe() }, 1800)
                }
            }
        }

        loadCollectish()
        seller.loadUrl("https://sellerportal.tcgplayer.com/")
    }

    private fun buildCollectishStatus() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(40, 40, 40, 40)
        setBackgroundColor(Color.rgb(245, 248, 252))

        addView(TextView(this@MainActivity).apply {
            text = "collectish"
            textSize = 30f
            setTextColor(Color.rgb(16, 24, 40))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2))

        addView(TextView(this@MainActivity).apply {
            text = "Scout • Seller • SYP"
            textSize = 14f
            setTextColor(Color.rgb(102, 112, 133))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 28)
        }, LinearLayout.LayoutParams(-1, -2))

        addView(ProgressBar(this@MainActivity).apply { isIndeterminate = true }, LinearLayout.LayoutParams(-2, -2))

        collectishStatusTitle = TextView(this@MainActivity).apply {
            text = "Loading Collectish…"
            textSize = 18f
            setTextColor(Color.rgb(16, 24, 40))
            gravity = Gravity.CENTER
            setPadding(0, 22, 0, 6)
        }
        addView(collectishStatusTitle, LinearLayout.LayoutParams(-1, -2))

        collectishStatusDetail = TextView(this@MainActivity).apply {
            text = "Connecting to the Collectish dashboard."
            textSize = 13f
            setTextColor(Color.rgb(102, 112, 133))
            gravity = Gravity.CENTER
        }
        addView(collectishStatusDetail, LinearLayout.LayoutParams(-1, -2))

        collectishRetry = Button(this@MainActivity).apply {
            text = "Retry Collectish"
            visibility = View.GONE
            setOnClickListener { loadCollectish() }
        }
        addView(collectishRetry, LinearLayout.LayoutParams(-2, -2).apply { topMargin = 20 })
    }

    private fun collectishClient() = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            collectishReady = false
            showCollectishStatus("Loading Collectish…", "Preparing a fresh dashboard session.", false)
        }

        override fun onPageFinished(view: WebView, url: String) {
            mainHandler.postDelayed({ revealCollectishIfRendered() }, 150)
            mainHandler.postDelayed({
                if (!collectishReady) {
                    revealCollectishIfRendered(finalAttempt = true)
                }
            }, 3500)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                collectishReady = false
                showCollectishStatus(
                    "Collectish did not load",
                    "The dashboard connection failed before the page rendered. Tap Retry Collectish.",
                    true
                )
            }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                collectishReady = false
                showCollectishStatus(
                    "Collectish returned ${errorResponse.statusCode}",
                    "The app is running normally, but the dashboard endpoint did not return a usable page.",
                    true
                )
            }
        }
    }

    private fun revealCollectishIfRendered(finalAttempt: Boolean = false) {
        if (!::collectish.isInitialized) return
        val probe = """
            (function(){
              try {
                const body=document.body;
                if(!body) return 'blank';
                const text=(body.innerText||'').replace(/\s+/g,' ').trim();
                const visible=[...document.querySelectorAll('main,section,header,nav,input,button')].some(el=>{
                  const s=getComputedStyle(el); const r=el.getBoundingClientRect();
                  return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
                });
                return text.length>=8 && visible ? 'ready' : 'blank';
              } catch(e) { return 'blank'; }
            })();
        """.trimIndent()
        collectish.evaluateJavascript(probe) { raw ->
            if (raw.contains("ready")) {
                collectishReady = true
                collectish.visibility = View.VISIBLE
                collectishStatus.visibility = View.GONE
            } else if (finalAttempt) {
                collectishReady = false
                collectish.visibility = View.INVISIBLE
                showCollectishStatus(
                    "Collectish loaded a blank page",
                    "The old black-screen state was blocked. Retry to request a clean dashboard render.",
                    true
                )
            }
        }
    }

    private fun showCollectishStatus(title: String, detail: String, retry: Boolean) {
        if (!::collectishStatus.isInitialized) return
        collectishStatus.visibility = View.VISIBLE
        collectishStatusTitle.text = title
        collectishStatusDetail.text = detail
        collectishRetry.visibility = if (retry) View.VISIBLE else View.GONE
    }

    private fun loadCollectish() {
        collectishReady = false
        if (::collectish.isInitialized) {
            collectish.visibility = View.INVISIBLE
            showCollectishStatus("Loading Collectish…", "Connecting to the Collectish dashboard.", false)
            collectish.stopLoading()
            collectish.clearHistory()
            collectish.loadUrl(collectishUrl)
            mainHandler.postDelayed({
                if (!collectishReady) {
                    showCollectishStatus(
                        "Still connecting…",
                        "If the dashboard stays unavailable, Retry Collectish will start a clean request without leaving a black screen.",
                        true
                    )
                }
            }, 8000)
        }
    }

    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWebView() = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadsImagesAutomatically = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = false
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
        setBackgroundColor(Color.WHITE)
    }

    private fun showCollectish() {
        collectishHost.visibility = View.VISIBLE
        seller.visibility = View.GONE
        if (collectishReady) {
            collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))", null)
        } else if (collectish.url.isNullOrBlank()) {
            loadCollectish()
        }
    }

    private fun showSeller() {
        seller.visibility = View.VISIBLE
        collectishHost.visibility = View.GONE
    }

    private fun decodeJsString(raw: String): String = raw.replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\").trim('"')

    private fun verifySellerSession(after: (() -> Unit)? = null) {
        if (!::seller.isInitialized) { after?.invoke(); return }
        val url = seller.url.orEmpty().lowercase()
        val cookies = CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        val probe = """(function(){try{const text=(document.body?.innerText||'');const b=text.toLowerCase();const visible=['orders','inventory','payments','shipping','messages','settings'].filter(x=>b.includes(x));const links=[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||a.textContent||'').trim().replace(/\s+/g,' ').slice(0,120),href:a.href})).filter(x=>x.text||/order|inventory|payment|shipping/i.test(x.href)).slice(0,80);return JSON.stringify({passwordField:!!document.querySelector('input[type=password]'),loginText:/sign in|log in|forgot password/.test(b),logoutText:/sign out|log out|logout/.test(b),sellerNav:/orders|inventory|payments|seller portal|shipping/.test(b),title:document.title||'',path:location.pathname||'/',visibleSections:visible,links,checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e)})}})();"""
        seller.evaluateJavascript(probe) { raw ->
            val t = decodeJsString(raw.orEmpty())
            sellerPortalSnapshot = t.ifBlank { "{}" }
            val login = url.contains("login") || url.contains("signin") || url.contains("registration") || t.contains("\"passwordField\":true")
            val auth = t.contains("\"logoutText\":true") || (t.contains("\"sellerNav\":true") && !t.contains("\"loginText\":true"))
            sellerSessionState = when {
                login -> "signed_out"
                auth && url.contains("tcgplayer.com") -> "authenticated"
                cookies.isNotBlank() && url.contains("tcgplayer.com") -> "authenticated"
                else -> "unknown"
            }
            after?.invoke()
            if (::collectish.isInitialized && collectishHost.visibility == View.VISIBLE && collectishReady) {
                collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))", null)
            }
        }
    }

    private fun startSellerOrdersProbeNative() {
        if (!::seller.isInitialized) {
            sellerOrdersProbeState = "error"
            sellerOrdersSnapshot = "{\"error\":\"Seller WebView unavailable\"}"
            return
        }
        sellerOrdersProbeState = "locating"
        sellerOrdersSnapshot = "{}"
        verifySellerSession {
            if (sellerSessionState != "authenticated") {
                sellerOrdersProbeState = "error"
                sellerOrdersSnapshot = "{\"error\":\"Seller Portal session is not authenticated\"}"
                return@verifySellerSession
            }
            sellerOrdersProbeState = "navigating"
            seller.loadUrl("https://store.tcgplayer.com/admin/orders/orderlist")
            mainHandler.postDelayed({
                if (sellerOrdersProbeState == "navigating") {
                    sellerOrdersProbeState = "collecting"
                    captureSellerOrdersProbe()
                }
            }, 5000)
        }
    }

    private fun captureSellerOrdersProbe() {
        if (!::seller.isInitialized) return
        val probe = """(function(){try{const clean=s=>(s||'').replace(/\s+/g,' ').trim();const tables=[...document.querySelectorAll('table')].slice(0,8).map((table,ti)=>({index:ti,headers:[...table.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean),rows:[...table.querySelectorAll('tbody tr,tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('th,td')].map(td=>clean(td.innerText||td.textContent).slice(0,500))).filter(r=>r.length)}));const grids=[...document.querySelectorAll('[role=row]')].slice(0,160).map(r=>[...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map(c=>clean(c.innerText||c.textContent).slice(0,500))).filter(r=>r.length);const links=[...document.querySelectorAll('a[href]')].map(a=>({text:clean(a.innerText||a.textContent).slice(0,160),href:a.href})).filter(x=>/order|refund|payment|transaction|shipping|seller/i.test(x.text+' '+x.href)).slice(0,120);const buttons=[...document.querySelectorAll('button,[role=button]')].map(b=>clean(b.innerText||b.textContent)).filter(Boolean).slice(0,100);const forms=[...document.forms].slice(0,20).map(f=>({action:f.action,method:f.method,controls:[...f.elements].slice(0,60).map(e=>({name:e.name||'',type:e.type||'',value:(e.type==='hidden'?String(e.value||'').slice(0,300):'')}))}));const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/tcgplayer|sellerportal/i.test(u)&&/api|order|refund|payment|transaction|shipping|seller/i.test(u)).slice(-160);const body=clean(document.body?.innerText||'').slice(0,30000);return JSON.stringify({title:document.title||'',url:location.href,path:location.pathname||'/',tables,grids,links,buttons,forms,resources,bodyText:body,counts:{tables:tables.length,gridRows:grids.length,links:links.length,resources:resources.length},checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e),url:location.href,checkedAt:new Date().toISOString()})}})();"""
        seller.evaluateJavascript(probe) { raw ->
            val t = decodeJsString(raw.orEmpty())
            sellerOrdersSnapshot = t.ifBlank { "{\"error\":\"Empty orders probe\"}" }
            sellerOrdersProbeState = if (t.contains("\"error\":")) "error" else "ready"
            if (::collectish.isInitialized && collectishHost.visibility == View.VISIBLE && collectishReady) {
                collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))", null)
            }
        }
    }

    inner class Bridge {
        @JavascriptInterface fun getVersion() = version
        @JavascriptInterface fun getCollectorId(): String {
            val p = getSharedPreferences("collectish-agent", MODE_PRIVATE)
            return p.getString("collectorId", null) ?: UUID.randomUUID().toString().also {
                p.edit().putString("collectorId", it).apply()
            }
        }
        @JavascriptInterface fun getSessionState() = sellerSessionState
        @JavascriptInterface fun getSellerPortalSnapshot() = sellerPortalSnapshot
        @JavascriptInterface fun getSellerOrdersProbeState() = sellerOrdersProbeState
        @JavascriptInterface fun getSellerOrdersSnapshot() = sellerOrdersSnapshot
        @JavascriptInterface fun startSellerOrdersProbe() { runOnUiThread { this@MainActivity.startSellerOrdersProbeNative() } }
        @JavascriptInterface fun refreshSessionState() { runOnUiThread { verifySellerSession() } }
        @JavascriptInterface fun showSellerPortal() { runOnUiThread { showSeller() } }
        @JavascriptInterface fun showCollectish() { runOnUiThread { verifySellerSession { showCollectish() } } }
    }

    override fun onResume() {
        super.onResume()
        if (::seller.isInitialized) verifySellerSession()
    }

    override fun onBackPressed() {
        when {
            seller.visibility == View.VISIBLE && seller.canGoBack() -> seller.goBack()
            collectishHost.visibility == View.VISIBLE && collectishReady && collectish.canGoBack() -> collectish.goBack()
            seller.visibility == View.VISIBLE -> verifySellerSession { showCollectish() }
            else -> super.onBackPressed()
        }
    }
}
