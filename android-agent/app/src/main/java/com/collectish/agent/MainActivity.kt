package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.graphics.Color
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowInsets
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.ConsoleMessage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.net.URL
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val api = NativeSupabase()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val microphonePermission by lazy { MicrophonePermissionDelegate(this, 7401) }
    private lateinit var rootHost: FrameLayout
    private lateinit var nativeShell: LinearLayout
    private lateinit var contentHost: FrameLayout
    private lateinit var nav: LinearLayout
    private lateinit var agentWeb: WebView
    private lateinit var seller: WebView
    private lateinit var sellerReturn: Button
    private val hostedBootDiagnostics = mutableListOf<String>()
    private var currentPage = "scout"
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var accountEmail: String? = null
    @Volatile private var sellerSessionState = "unknown"
    @Volatile private var sellerPortalSnapshot = "{}"
    @Volatile private var sellerOrdersProbeState = "idle"
    @Volatile private var sellerOrdersSnapshot = "{}"
    private var lastHostedRefreshAt = 0L
    private var hostedBackgroundStarted = false
    private val hostedAgentKick = object : Runnable {
        override fun run() {
            if (::seller.isInitialized) verifySellerSession()
            mainHandler.postDelayed(this, 15_000L)
        }
    }
    private val version = "0.2.36"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindowSafely()
        CookieManager.getInstance().setAcceptCookie(true)
        restoreSession()
        rootHost = FrameLayout(this).apply { setBackgroundColor(bg()) }
        installSafeInsets(rootHost)
        nativeShell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(bg()) }
        contentHost = FrameLayout(this).apply { setBackgroundColor(bg()) }
        nav = buildNav()
        nativeShell.addView(contentHost, LinearLayout.LayoutParams(-1, 0, 1f))
        nativeShell.addView(nav, LinearLayout.LayoutParams(-1, dp(66)))
        rootHost.addView(nativeShell, FrameLayout.LayoutParams(-1, -1))

        agentWeb = makeWebView().apply { alpha = 1f }
        agentWeb.webViewClient = collectishClient()
        agentWeb.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                val line = "console ${message.messageLevel()}: ${message.message()} @ ${message.sourceId()}:${message.lineNumber()}"
                hostedBootDiagnostics.add(line.take(500))
                return super.onConsoleMessage(message)
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { if (!microphonePermission.handle(request)) request.deny() }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                microphonePermission.canceled(request)
                super.onPermissionRequestCanceled(request)
            }
        }
        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")
        seller = makeWebView()
        agentWeb.addJavascriptInterface(ReadOnlyProbeBridge(this, seller) { sellerSessionState }, "CollectishReadOnly")
        seller.webViewClient = sellerClient()
        rootHost.addView(agentWeb, FrameLayout.LayoutParams(-1, -1))
        rootHost.addView(seller, FrameLayout.LayoutParams(-1, -1))
        seller.visibility = View.GONE
        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE
        sellerReturn = Button(this).apply {
            text = "← Collectish"
            isAllCaps = false
            textSize = 14f
            visibility = View.GONE
            setOnClickListener {
                seller.visibility = View.GONE
                visibility = View.GONE
                nativeShell.visibility = View.VISIBLE
                showPage(currentPage)
            }
        }
        rootHost.addView(sellerReturn, FrameLayout.LayoutParams(-2, dp(48), Gravity.TOP or Gravity.START).apply {
            leftMargin = dp(12)
            topMargin = dp(12)
        })
        setContentView(rootHost)

        val restoredHostedState = savedInstanceState != null && agentWeb.restoreState(savedInstanceState) != null
        if (!restoredHostedState) {
            val shellBootUrl = "https://joe-nasti.github.io/marketplacescout/?androidBoot=${System.currentTimeMillis()}"
            agentWeb.loadUrl(shellBootUrl)
        }
        lastHostedRefreshAt = System.currentTimeMillis()
        if (accessToken.isNullOrBlank()) showLogin() else showPage(currentPage)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::agentWeb.isInitialized) agentWeb.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        microphonePermission.cancel()
        mainHandler.removeCallbacks(hostedAgentKick)
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (microphonePermission.result(requestCode, permissions, grantResults)) return
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    private fun bg() = Color.rgb(245, 248, 252)
    private fun ink() = Color.rgb(16, 24, 40)
    private fun muted() = Color.rgb(102, 112, 133)
    private fun blue() = Color.rgb(47, 109, 246)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }
        applySystemTheme(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(false)
    }

    private fun applySystemTheme(dark: Boolean) {
        val bg = if (dark) Color.rgb(11, 21, 56) else Color.rgb(245, 248, 255)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = if (dark) 0 else (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.setSystemBarsAppearance(
                if (dark) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }
        if (::rootHost.isInitialized) rootHost.setBackgroundColor(bg)
        if (::nativeShell.isInitialized) nativeShell.setBackgroundColor(bg)
        if (::contentHost.isInitialized) contentHost.setBackgroundColor(bg)
    }
    private fun installSafeInsets(view: View) {
        view.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
            }
            insets
        }
        view.requestApplyInsets()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWebView() = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // The hosted shell uses content-hashed Vite assets. Reusing those assets
        // avoids downloading the complete application graph on every cold launch.
        settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
        setBackgroundColor(Color.WHITE)
    }


    private fun openExternalUrl(url: String) {
        if (url.isBlank()) return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    private fun collectishClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
            val url = request.url?.toString().orEmpty()
            val internal = request.url?.host.equals("joe-nasti.github.io", ignoreCase = true) &&
                request.url?.path.orEmpty().startsWith("/marketplacescout")
            if (!internal && (url.startsWith("https://") || url.startsWith("http://"))) {
                openExternalUrl(url)
                return true
            }
            return false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            hostedBootDiagnostics.add(("resource error ${error.errorCode}: ${error.description} · ${request.url}").take(500))
            super.onReceivedError(view, request, error)
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            hostedBootDiagnostics.add(("HTTP ${errorResponse.statusCode} ${errorResponse.reasonPhrase} · ${request.url}").take(500))
            super.onReceivedHttpError(view, request, errorResponse)
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            startHostedBackgroundWork()
            mainHandler.postDelayed({ runHostedBootDiagnostic(view) }, 8_000L)
            val js = """
                (function(){
                  if(window.__collectishExternalLinksInstalled)return;
                  window.__collectishExternalLinksInstalled=true;
                  document.addEventListener('click',function(e){
                    const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
                    if(!a)return;
                    try{
                      const u=new URL(a.href,location.href);
                      const internal=u.hostname==='joe-nasti.github.io' && u.pathname.startsWith('/marketplacescout');
                      if(!internal && /^https?:$/.test(u.protocol)){
                        e.preventDefault();e.stopPropagation();
                        if(window.CollectishAndroid && CollectishAndroid.openExternal) CollectishAndroid.openExternal(u.href);
                      }
                    }catch(_){}
                  },true);
                })();
            """.trimIndent()
            view.evaluateJavascript(js, null)
        }
    }

    private fun startHostedBackgroundWork() {
        if (hostedBackgroundStarted) return
        hostedBackgroundStarted = true
        mainHandler.postDelayed({
            if (::seller.isInitialized && seller.url.isNullOrBlank()) seller.loadUrl("https://sellerportal.tcgplayer.com/")
            try {
                val syncIntent = Intent(this, SellerSyncService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(syncIntent) else startService(syncIntent)
            } catch (_: Throwable) { }
            mainHandler.post(hostedAgentKick)
        }, 1_500L)
    }

    private fun runHostedBootDiagnostic(view: WebView) {
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

    private fun sellerClient() = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            verifySellerSession()
            if (sellerOrdersProbeState == "navigating") {
                sellerOrdersProbeState = "collecting"
                mainHandler.postDelayed({ captureSellerOrdersProbe() }, 1800)
            }
        }
    }

    private fun buildNav() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        setPadding(dp(4), dp(6), dp(4), dp(8))
        setBackgroundColor(Color.WHITE)
        listOf("scout" to "Scout", "seller" to "Seller", "syp" to "SYP", "admin" to "Admin").forEach { (key, label) ->
            addView(Button(this@MainActivity).apply {
                tag = key
                text = label
                textSize = 12f
                isAllCaps = false
                setOnClickListener { showPage(key) }
            }, LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
        }
    }

    private fun updateNav() {
        for (i in 0 until nav.childCount) {
            val b = nav.getChildAt(i) as Button
            val active = b.tag == currentPage
            b.setTextColor(if (active) blue() else muted())
            b.alpha = if (active) 1f else .72f
        }
    }

    private fun restoreSession() {
        val p = getSharedPreferences("collectish-native", MODE_PRIVATE)
        accessToken = p.getString("accessToken", null)
        refreshToken = p.getString("refreshToken", null)
        accountEmail = p.getString("email", null)
        currentPage = p.getString("lastPage", "scout")?.takeIf { it in setOf("scout", "seller", "syp", "admin") } ?: "scout"
    }

    private fun saveSession(s: NativeSupabase.Session) {
        accessToken = s.accessToken; refreshToken = s.refreshToken; accountEmail = s.email ?: accountEmail
        getSharedPreferences("collectish-native", MODE_PRIVATE).edit()
            .putString("accessToken", accessToken).putString("refreshToken", refreshToken).putString("email", accountEmail).apply()
    }

    private fun clearSession() {
        accessToken = null; refreshToken = null; accountEmail = null
        getSharedPreferences("collectish-native", MODE_PRIVATE).edit().clear().apply()
    }

    private fun showLogin(message: String? = null) {
        seller.visibility = View.GONE
        nav.visibility = View.GONE
        contentHost.removeAllViews()
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(54), dp(24), dp(24)); setBackgroundColor(bg())
        }
        wrap.addView(title("collectish", 34f))
        wrap.addView(text("Scout opportunities. Seller history. SYP changes.", 14f, muted()).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(30)) })
        val email = EditText(this).apply { hint = "Email"; setText(accountEmail.orEmpty()); inputType = 33 }
        val pass = EditText(this).apply { hint = "Password"; inputType = 129 }
        val status = text(message.orEmpty(), 13f, Color.rgb(180, 35, 24)).apply { setPadding(0, dp(10), 0, dp(8)) }
        val signIn = Button(this).apply { text = "Sign in"; isAllCaps = false; setTextColor(Color.WHITE); setBackgroundColor(blue()) }
        wrap.addView(email, LinearLayout.LayoutParams(-1, dp(56)))
        wrap.addView(pass, LinearLayout.LayoutParams(-1, dp(56)).apply { topMargin = dp(10) })
        wrap.addView(status, LinearLayout.LayoutParams(-1, -2))
        wrap.addView(signIn, LinearLayout.LayoutParams(-1, dp(54)))
        signIn.setOnClickListener {
            if (email.text.isBlank() || pass.text.isBlank()) { status.text = "Enter email and password."; return@setOnClickListener }
            signIn.isEnabled = false; status.setTextColor(muted()); status.text = "Signing in…"
            thread {
                try {
                    val s = api.signIn(email.text.toString().trim(), pass.text.toString())
                    accountEmail = email.text.toString().trim(); saveSession(s)
                    runOnUiThread { nav.visibility = View.VISIBLE; showPage("scout") }
                } catch (e: Exception) {
                    runOnUiThread { signIn.isEnabled = true; status.setTextColor(Color.rgb(180,35,24)); status.text = e.message ?: "Sign in failed" }
                }
            }
        }
        contentHost.addView(ScrollView(this).apply { addView(wrap) }, FrameLayout.LayoutParams(-1, -1))
    }

    private fun showPage(page: String) {
        if (accessToken.isNullOrBlank()) { showLogin(); return }
        val targetPage = page.takeIf { it in setOf("scout", "seller", "syp", "admin") } ?: "scout"
        seller.visibility = View.GONE
        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE
        nativeShell.visibility = View.VISIBLE
        nav.visibility = View.VISIBLE
        currentPage = targetPage
        getSharedPreferences("collectish-native", MODE_PRIVATE).edit().putString("lastPage", targetPage).apply()
        updateNav()
        when (targetPage) {
            "scout" -> loadScout()
            "seller" -> loadSeller()
            "syp" -> loadSyp()
            else -> renderAdmin()
        }
    }

    private fun pageBase(name: String, subtitle: String): LinearLayout {
        contentHost.removeAllViews()
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(18), dp(16), dp(24)); setBackgroundColor(bg()) }
        body.addView(title(name, 28f))
        body.addView(text(subtitle, 14f, muted()).apply { setPadding(0, dp(4), 0, dp(14)) })
        contentHost.addView(ScrollView(this).apply { addView(body) }, FrameLayout.LayoutParams(-1, -1))
        return body
    }

    private fun loading(body: LinearLayout, label: String = "Loading…") {
        body.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(18), 0, dp(18))
            addView(ProgressBar(this@MainActivity).apply { isIndeterminate = true }, LinearLayout.LayoutParams(dp(28), dp(28)))
            addView(text(label, 14f, muted()).apply { setPadding(dp(12), 0, 0, 0) })
        })
    }

    private data class ScoutOpportunity(
        val latest: JSONObject,
        val first: JSONObject,
        val historyCount: Int,
        val hotWatchCount: Int,
        val hotCount: Int,
        val persist: Double,
        val qtyDelta: Double,
        val priceDelta: Double,
        val rankDelta: Double,
        val latestScore: Double,
        val depletionScore: Double,
        val priceStrengthScore: Double,
        val rankStrengthScore: Double,
        val composite: Double
    )

    private fun grade(score: Double) = when {
        score >= 90 -> "S"
        score >= 80 -> "A"
        score >= 70 -> "B"
        score >= 60 -> "C"
        score >= 50 -> "D"
        else -> "F"
    }

    private fun gradeColor(g: String) = when (g) {
        "S" -> Color.rgb(255, 122, 122)
        "A" -> Color.rgb(255, 196, 119)
        "B" -> Color.rgb(255, 228, 122)
        "C" -> Color.rgb(168, 229, 140)
        "D" -> Color.rgb(143, 216, 239)
        else -> Color.rgb(201, 205, 212)
    }

    private fun loadScout() {
        val body = pageBase("Scout", "What should I buy?")
        loading(body, "Building graded opportunities from recent scan history…")
        withToken { token ->
            val latestRows = api.get(token, "marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,opportunity_score,flag&id=not.is.null&order=id.desc&limit=1000")
            val latestBySku = linkedMapOf<String, JSONObject>()
            for (i in 0 until latestRows.length()) {
                val r = latestRows.getJSONObject(i)
                val k = r.optString("sku_id", "row-$i")
                if (!latestBySku.containsKey(k)) latestBySku[k] = r
            }
            val candidates = latestBySku.values
                .sortedByDescending { it.optDouble("opportunity_score", 0.0) }
                .take(60)
            if (candidates.isEmpty()) {
                runOnUiThread { pageBase("Scout", "Ranked buying and speculation opportunities.").addView(empty("No Scout rows are available yet.")) }
                return@withToken
            }

            val scans = api.get(token, "marketplace_scans?select=scan_id,captured_at&order=captured_at.desc&limit=120")
            val cutoff = System.currentTimeMillis() - 7L * 86400000L
            val scanTimes = linkedMapOf<String, Long>()
            for (i in 0 until scans.length()) {
                val x = scans.getJSONObject(i)
                val t = runCatching { java.time.Instant.parse(x.optString("captured_at")).toEpochMilli() }.getOrDefault(0L)
                if (t >= cutoff) scanTimes[x.optString("scan_id")] = t
            }
            val skuIds = candidates.map { it.optString("sku_id") }.filter { it.isNotBlank() }
            val histories = if (scanTimes.isNotEmpty() && skuIds.isNotEmpty()) {
                val scanFilter = scanTimes.keys.joinToString(",")
                val skuFilter = skuIds.joinToString(",")
                api.getAll(token, "marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,sku_market_price,direct_listings,direct_available,avg_daily_qty_sold,opportunity_score,flag&scan_id=in.($scanFilter)&sku_id=in.($skuFilter)", 1000, 12000)
            } else JSONArray()

            val grouped = linkedMapOf<String, MutableList<JSONObject>>()
            for (i in 0 until histories.length()) {
                val r = histories.getJSONObject(i)
                grouped.getOrPut(r.optString("sku_id")) { mutableListOf() }.add(r)
            }

            val opportunities = candidates.map { latest ->
                val sku = latest.optString("sku_id")
                val history = grouped[sku].orEmpty().sortedBy { scanTimes[it.optString("scan_id")] ?: Long.MAX_VALUE }
                val series = if (history.isEmpty()) listOf(latest) else history
                val first = series.first()
                val last = latest
                val hw = series.count { it.optString("flag").equals("HOT", true) || it.optString("flag").equals("WATCH", true) }
                val hot = series.count { it.optString("flag").equals("HOT", true) }
                val persist = hw.toDouble() / max(1, series.size).toDouble()
                val qd = last.optDouble("direct_available", 0.0) - first.optDouble("direct_available", 0.0)
                val pd = last.optDouble("direct_low", 0.0) - first.optDouble("direct_low", 0.0)
                val rd = last.optDouble("sales_rank", 0.0) - first.optDouble("sales_rank", 0.0)
                val score = last.optDouble("opportunity_score", 0.0)
                val dep = if (qd < 0) min(100.0, abs(qd) / max(1.0, first.optDouble("direct_available", 0.0)) * 100.0) else 0.0
                val pr = if (pd > 0) min(100.0, pd / max(0.01, first.optDouble("direct_low", 0.01)) * 100.0) else 0.0
                val ri = if (rd < 0) min(100.0, abs(rd) / max(1.0, first.optDouble("sales_rank", 1.0)) * 100.0) else 0.0
                val comp = score * .4 + persist * 20.0 + dep * .2 + pr * .1 + ri * .1
                ScoutOpportunity(last, first, series.size, hw, hot, persist, qd, pd, rd, score, dep, pr, ri, comp)
            }.sortedByDescending { it.composite }.take(40)

            runOnUiThread { renderScoutOpportunities(opportunities) }
        }
    }

    private fun renderScoutOpportunities(items: List<ScoutOpportunity>) {
        val body = pageBase("Scout", "A–F grades combine latest Scout strength with persistence and actual movement over recent scans.")
        if (items.isEmpty()) { body.addView(empty("No graded Scout opportunities are available yet.")); return }
        body.addView(text("Tap any card for its score breakdown.", 12f, muted()).apply { setPadding(0, 0, 0, dp(10)) })
        val imageTargets = mutableListOf<Pair<ScoutOpportunity, ImageView>>()
        items.forEach { x ->
            val g = grade(x.composite)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.TOP
                setPadding(dp(10), dp(10), dp(10), dp(10))
                setBackgroundColor(Color.WHITE)
                elevation = dp(1).toFloat()
                isClickable = true
                isFocusable = true
                setOnClickListener { showScoutDetail(x) }
            }
            val artFrame = FrameLayout(this).apply { setBackgroundColor(Color.rgb(26, 31, 41)) }
            val image = ImageView(this).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                setBackgroundColor(Color.rgb(26, 31, 41))
                contentDescription = x.latest.optString("product_name")
            }
            artFrame.addView(image, FrameLayout.LayoutParams(-1, -1))
            artFrame.addView(TextView(this).apply {
                text = g; textSize = 22f; gravity = Gravity.CENTER; setTextColor(Color.rgb(17, 24, 39)); setBackgroundColor(gradeColor(g)); setTypeface(typeface, 1)
            }, FrameLayout.LayoutParams(dp(38), dp(38), Gravity.TOP or Gravity.START).apply { leftMargin = dp(6); topMargin = dp(6) })
            artFrame.addView(TextView(this).apply {
                text = x.composite.toInt().toString(); textSize = 11f; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setBackgroundColor(Color.argb(210, 0, 0, 0)); setTypeface(typeface, 1)
            }, FrameLayout.LayoutParams(dp(42), dp(28), Gravity.TOP or Gravity.END).apply { rightMargin = dp(6); topMargin = dp(6) })
            row.addView(artFrame, LinearLayout.LayoutParams(dp(112), dp(156)))

            val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(2), 0, 0) }
            copy.addView(text(x.latest.optString("product_name", "Unknown card"), 16f, ink()).apply { setTypeface(typeface, 1) })
            copy.addView(text("${x.latest.optString("set_name")} • #${x.latest.optString("collector_number", "—")}", 11f, muted()).apply { setPadding(0, dp(3), 0, dp(5)) })
            copy.addView(text("${x.latest.optString("printing", "Normal")} • ${x.latest.optString("condition", "")}", 11f, muted()))
            copy.addView(text("Direct ${money(x.latest.optDouble("direct_low"))}", 17f, ink()).apply { setTypeface(typeface, 1); setPadding(0, dp(8), 0, 0) })
            copy.addView(text("${x.latest.optInt("direct_available")} Direct • ${x.latest.optInt("direct_listings")} listings", 12f, muted()))
            copy.addView(text(strongestReason(x), 12f, ink()).apply { setPadding(0, dp(8), 0, 0) })
            row.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
            body.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
            imageTargets += x to image
        }
        loadScryfallImages(imageTargets)
    }

    private fun strongestReason(x: ScoutOpportunity): String {
        val options = listOf(
            x.latestScore * .4 to "Scout score ${x.latestScore.toInt()}",
            x.persist * 20.0 to "${(x.persist * 100).toInt()}% HOT/WATCH persistence",
            x.depletionScore * .2 to if (x.qtyDelta < 0) "${abs(x.qtyDelta).toInt()} fewer Direct copies" else "Supply scarcity",
            x.priceStrengthScore * .1 to if (x.priceDelta > 0) "Direct Low +${money(x.priceDelta)}" else "Price strength",
            x.rankStrengthScore * .1 to if (x.rankDelta < 0) "Sales rank improved ${abs(x.rankDelta).toInt()}" else "Sales-rank strength"
        )
        return options.maxByOrNull { it.first }?.second ?: "Review supply and velocity."
    }

    private fun showScoutDetail(x: ScoutOpportunity) {
        val g = grade(x.composite)
        val body = pageBase("${g} • ${x.latest.optString("product_name", "Scout detail")}", "Composite ${x.composite.toInt()}/100 • latest Scout ${x.latestScore.toInt()}/100")
        body.addView(Button(this).apply { text = "← Back to Scout"; isAllCaps = false; setOnClickListener { loadScout() } }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        val hero = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(14), dp(14), dp(14), dp(14)); setBackgroundColor(Color.WHITE) }
        val artFrame = FrameLayout(this).apply { setBackgroundColor(Color.rgb(26,31,41)) }
        val image = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.rgb(26,31,41)) }
        artFrame.addView(image, FrameLayout.LayoutParams(-1,-1))
        artFrame.addView(TextView(this).apply { text=g;textSize=26f;gravity=Gravity.CENTER;setTextColor(Color.rgb(17,24,39));setBackgroundColor(gradeColor(g));setTypeface(typeface,1) }, FrameLayout.LayoutParams(dp(46),dp(46),Gravity.TOP or Gravity.START).apply{leftMargin=dp(7);topMargin=dp(7)})
        hero.addView(artFrame, LinearLayout.LayoutParams(dp(132), dp(184)))
        hero.addView(LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL;setPadding(dp(14),0,0,0)
            addView(text(x.latest.optString("set_name"),13f,muted()))
            addView(text("${x.latest.optString("printing")} • ${x.latest.optString("condition")}",12f,muted()).apply{setPadding(0,dp(4),0,0)})
            addView(text("Direct ${money(x.latest.optDouble("direct_low"))}",20f,ink()).apply{setTypeface(typeface,1);setPadding(0,dp(12),0,0)})
            addView(text("Market ${money(x.latest.optDouble("sku_market_price"))}",13f,muted()))
            addView(text("${x.latest.optInt("direct_available")} Direct • ${x.latest.optInt("direct_listings")} listings",12f,muted()).apply{setPadding(0,dp(8),0,0)})
            addView(text("${String.format(Locale.US,"%.1f",x.latest.optDouble("avg_daily_qty_sold"))} sales/day • rank ${x.latest.optInt("sales_rank")}",12f,muted()))
        }, LinearLayout.LayoutParams(0,-2,1f))
        body.addView(hero, LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(10)})
        loadScryfallImages(listOf(x to image))

        body.addView(card().apply {
            addView(title("Composite opportunity", 17f))
            addView(text("The grade uses the same 0–100 composite model as the earlier visual Scout.",12f,muted()).apply{setPadding(0,dp(5),0,dp(9))})
            addView(scoreLine("Latest Scout score", "40%", x.latestScore * .4, "${x.latestScore.toInt()}/100"))
            addView(scoreLine("HOT/WATCH persistence", "20%", x.persist * 20.0, "${x.hotWatchCount}/${x.historyCount} scans"))
            addView(scoreLine("Direct inventory depletion", "20%", x.depletionScore * .2, signedQty(x.qtyDelta)))
            addView(scoreLine("Direct Low increase", "10%", x.priceStrengthScore * .1, signedMoney(x.priceDelta)))
            addView(scoreLine("Sales-rank improvement", "10%", x.rankStrengthScore * .1, signedInt(x.rankDelta)))
            addView(text("Total: ${String.format(Locale.US,"%.1f",x.composite)} / 100 → $g",14f,ink()).apply{setTypeface(typeface,1);setPadding(0,dp(12),0,0)})
        }, LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(10)})

        val market = x.latest.optDouble("sku_market_price",0.0)
        val direct = x.latest.optDouble("direct_low",0.0)
        val premium = if (market > 0) (direct-market)/market*100.0 else 0.0
        body.addView(card().apply {
            addView(title("Latest Scout score inputs",17f))
            addView(text("The backend Scout score itself emphasizes sales velocity (35%), Direct inventory scarcity (25%), Direct listing scarcity (20%), and Direct premium vs SKU Market (20%).",12f,muted()).apply{setPadding(0,dp(5),0,dp(10))})
            addView(detailMetric("Sales velocity • 35%", "${String.format(Locale.US,"%.2f",x.latest.optDouble("avg_daily_qty_sold"))} / day"))
            addView(detailMetric("Direct inventory scarcity • 25%", "${x.latest.optInt("direct_available")} copies"))
            addView(detailMetric("Direct listing scarcity • 20%", "${x.latest.optInt("direct_listings")} listings"))
            addView(detailMetric("Direct premium vs Market • 20%", "${if(premium>=0)"+" else ""}${String.format(Locale.US,"%.1f",premium)}%"))
            addView(text("Why it stands out: ${strongestReason(x)}.",13f,ink()).apply{setPadding(0,dp(10),0,0)})
        })
    }

    private fun scoreLine(label: String, weight: String, contribution: Double, detail: String) = LinearLayout(this).apply {
        orientation=LinearLayout.HORIZONTAL;setPadding(0,dp(7),0,dp(7))
        addView(LinearLayout(this@MainActivity).apply { orientation=LinearLayout.VERTICAL; addView(text(label,13f,ink()).apply{setTypeface(typeface,1)});addView(text("$weight • $detail",11f,muted())) }, LinearLayout.LayoutParams(0,-2,1f))
        addView(text(String.format(Locale.US,"+%.1f",contribution),14f,blue()).apply{setTypeface(typeface,1)})
    }

    private fun detailMetric(label:String,value:String)=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;setPadding(0,dp(6),0,dp(6));addView(text(label,12f,muted()),LinearLayout.LayoutParams(0,-2,1f));addView(text(value,13f,ink()).apply{setTypeface(typeface,1)})}
    private fun signedQty(v:Double) = if(v>0) "+${v.toInt()} copies" else "${v.toInt()} copies"
    private fun signedMoney(v:Double) = if(v>0) "+${money(v)}" else money(v)
    private fun signedInt(v:Double) = if(v>0) "+${v.toInt()}" else v.toInt().toString()

    private fun loadScryfallImages(targets: List<Pair<ScoutOpportunity, ImageView>>) {
        if (targets.isEmpty()) return
        thread {
            val setCodes = loadScryfallSetCodes()
            for ((x, imageView) in targets) {
                val name = x.latest.optString("product_name")
                if (name.isBlank()) continue
                val setCode = setCodes[x.latest.optString("set_name").lowercase(Locale.US)]
                val imageUrl = resolveScryfallImage(name, setCode) ?: continue
                val bitmap = runCatching {
                    val c = URL(imageUrl).openConnection() as HttpsURLConnection
                    c.connectTimeout=10000;c.readTimeout=15000;c.setRequestProperty("User-Agent","Collectish/0.2.3")
                    c.inputStream.use { BitmapFactory.decodeStream(it) }
                }.getOrNull()
                if (bitmap != null) runOnUiThread { if (imageView.isAttachedToWindow) imageView.setImageBitmap(bitmap) }
                Thread.sleep(120)
            }
        }
    }

    private fun loadScryfallSetCodes(): Map<String,String> {
        val prefs=getSharedPreferences("collectish-scryfall",MODE_PRIVATE)
        val savedAt=prefs.getLong("setsAt",0L);val cached=prefs.getString("sets",null)
        if(!cached.isNullOrBlank() && System.currentTimeMillis()-savedAt < 7L*86400000L){
            return runCatching{val o=JSONObject(cached);o.keys().asSequence().associateWith{o.getString(it)}}.getOrDefault(emptyMap())
        }
        return runCatching{
            val json=scryfallJson("https://api.scryfall.com/sets");val out=JSONObject();val arr=json.optJSONArray("data")?:JSONArray()
            for(i in 0 until arr.length()){val set=arr.getJSONObject(i);val name=set.optString("name").lowercase(Locale.US);val code=set.optString("code");if(name.isNotBlank()&&code.isNotBlank())out.put(name,code)}
            prefs.edit().putLong("setsAt",System.currentTimeMillis()).putString("sets",out.toString()).apply()
            out.keys().asSequence().associateWith{out.getString(it)}
        }.getOrDefault(emptyMap())
    }

    private fun resolveScryfallImage(name:String,setCode:String?):String? {
        val prefs=getSharedPreferences("collectish-scryfall",MODE_PRIVATE)
        val key=(name.lowercase(Locale.US)+"|"+(setCode?:"")).hashCode().toString()
        prefs.getString("img:$key",null)?.let{return it}
        val exact=URLEncoder.encode(name,"UTF-8")
        val urls=buildList{
            if(!setCode.isNullOrBlank())add("https://api.scryfall.com/cards/named?exact=$exact&set=${URLEncoder.encode(setCode,"UTF-8")}")
            add("https://api.scryfall.com/cards/named?exact=$exact")
        }
        for(url in urls){
            val card=runCatching{scryfallJson(url)}.getOrNull()?:continue
            val image=card.optJSONObject("image_uris")?.optString("normal")?.takeIf{it.isNotBlank()}
                ?: card.optJSONObject("image_uris")?.optString("small")?.takeIf{it.isNotBlank()}
                ?: card.optJSONArray("card_faces")?.let{faces->(0 until faces.length()).asSequence().mapNotNull{faces.optJSONObject(it)?.optJSONObject("image_uris")?.optString("normal")?.takeIf{u->u.isNotBlank()}}.firstOrNull()}
            if(!image.isNullOrBlank()){prefs.edit().putString("img:$key",image).apply();return image}
        }
        return null
    }

    private fun scryfallJson(url:String):JSONObject {
        val c=URL(url).openConnection() as HttpsURLConnection
        c.connectTimeout=10000;c.readTimeout=15000;c.setRequestProperty("Accept","application/json;q=0.9,*/*;q=0.8");c.setRequestProperty("User-Agent","Collectish/0.2.3")
        val text=(if(c.responseCode in 200..299)c.inputStream else c.errorStream).bufferedReader().use{it.readText()}
        if(c.responseCode !in 200..299)throw IllegalStateException("Scryfall ${c.responseCode}")
        return JSONObject(text)
    }

    private fun loadSeller() {
        val body = pageBase("Seller", "How is the business doing?"); loading(body, "Loading order history…")
        withToken { token ->
            val rows = api.get(token, "seller_orders?select=order_number,order_date,order_status,gross_amount,fee_amount,net_amount,refund_total,has_details&order=order_date.desc&limit=1000")
            var gross=0.0; var fees=0.0; var net=0.0; var refunds=0.0; var missing=0
            for(i in 0 until rows.length()){ val r=rows.getJSONObject(i); gross+=if(r.isNull("gross_amount"))0.0 else r.optDouble("gross_amount",0.0);fees+=if(r.isNull("fee_amount"))0.0 else r.optDouble("fee_amount",0.0);net+=if(r.isNull("net_amount"))0.0 else r.optDouble("net_amount",0.0);refunds+=if(r.isNull("refund_total"))0.0 else r.optDouble("refund_total",0.0);if(!r.optBoolean("has_details",false))missing++ }
            runOnUiThread {
                val b=pageBase("Seller","Latest 1,000 orders in your synced history.")
                b.addView(kpiGrid(listOf("Orders" to rows.length().toString(),"Gross" to money(gross),"Net" to money(net),"Fees" to money(fees),"Refunds" to money(refunds),"Missing detail" to missing.toString())))
                for(i in 0 until minOf(rows.length(),25)){ val r=rows.getJSONObject(i); b.addView(card().apply {
                    addView(text(r.optString("order_number"),15f,ink()).apply{setTypeface(typeface,1)})
                    addView(text("${r.optString("order_date")} • ${if(r.isNull("order_status")) "Details pending" else r.optString("order_status")}",12f,muted()))
                    addView(text(if(r.isNull("gross_amount")&&r.isNull("net_amount")) "Financial detail pending" else "Gross ${money(if(r.isNull("gross_amount"))0.0 else r.optDouble("gross_amount",0.0))}   Net ${money(if(r.isNull("net_amount"))0.0 else r.optDouble("net_amount",0.0))}",13f,ink()).apply{setPadding(0,dp(6),0,0)})
                },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(9)}) }
            }
        }
    }

    private fun loadSyp() {
        val body = pageBase("SYP", "What changed?"); loading(body, "Loading Store Your Products history…")
        withToken { token ->
            val rows=api.get(token,"syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,max_quantity,current_max_quantity,is_currently_eligible,last_seen&order=last_seen.desc&limit=750")
            val eligible=runCatching{api.count(token,"syp_products","is_currently_eligible=eq.true")}.getOrDefault(0)
            val totalProducts=runCatching{api.count(token,"syp_products")}.getOrDefault(rows.length())
            val eventCount=runCatching{api.count(token,"syp_events")}.getOrDefault(0)
            runOnUiThread {
                val b=pageBase("SYP","Eligibility, quantities, and recent product state.")
                b.addView(kpiGrid(listOf("Products" to totalProducts.toString(),"Eligible" to eligible.toString(),"Change events" to eventCount.toString())))
                for(i in 0 until minOf(rows.length(),30)){ val r=rows.getJSONObject(i); b.addView(card().apply{
                    addView(text(r.optString("product_name","Unknown product"),15f,ink()).apply{setTypeface(typeface,1)})
                    addView(text("${r.optString("set_name")} • ${r.optString("condition")}",12f,muted()))
                    addView(text("${if((r.opt("is_currently_eligible") as? Boolean)==true || r.optString("is_currently_eligible").equals("true",true)) "Eligible" else "Not eligible"}   •   Max ${r.optInt("current_max_quantity")}   •   ${money(r.optDouble("market_price"))}",13f,if((r.opt("is_currently_eligible") as? Boolean)==true || r.optString("is_currently_eligible").equals("true",true))Color.rgb(2,122,72) else muted()).apply{setPadding(0,dp(6),0,0)})
                },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(9)}) }
            }
        }
    }

    private fun renderAdmin() {
        val b=pageBase("Admin","Syncs, authentication, and backend operations.")
        b.addView(card().apply {
            addView(text("Collectish 0.2.4",18f,ink()).apply{setTypeface(typeface,1)})
            addView(text(accountEmail ?: "Signed in",13f,muted()).apply{setPadding(0,dp(5),0,dp(10))})
            addView(text("TCGplayer session: $sellerSessionState",13f,ink()))
            addView(Button(this@MainActivity).apply { text="Open TCGplayer session";isAllCaps=false;setOnClickListener{showSeller()} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(12)})
            addView(Button(this@MainActivity).apply { text="Refresh TCGplayer status";isAllCaps=false;setOnClickListener{verifySellerSession{renderAdmin()}} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(6)})
            addView(Button(this@MainActivity).apply { text="Sign out of Collectish";isAllCaps=false;setOnClickListener{clearSession();showLogin()} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(16)})
        })
        b.addView(text("The Collectish UI is native. The hidden agent WebView is retained only for existing cloud orchestration while that bridge is migrated natively.",12f,muted()).apply{setPadding(0,dp(12),0,0)})
    }

    private fun withToken(work: (String) -> Unit) {
        thread {
            try {
                var token=accessToken ?: throw IllegalStateException("Signed out")
                try { work(token) } catch(first: Exception) {
                    val refresh=refreshToken ?: throw first
                    val s=api.refresh(refresh);saveSession(s);token=s.accessToken;work(token)
                }
            } catch(e: Exception) {
                runOnUiThread {
                    if((e.message ?: "").contains("expired",true) || (e.message ?: "").contains("401")) { clearSession();showLogin("Your session expired. Sign in again.") }
                    else { val b=pageBase(currentPage.replaceFirstChar{it.uppercase()},"Could not load this section.");b.addView(empty(e.message ?: "Data request failed")) }
                }
            }
        }
    }

    private fun title(s:String,size:Float)=text(s,size,ink()).apply{setTypeface(typeface,1)}
    private fun text(s:String,size:Float,color:Int)=TextView(this).apply{text=s;textSize=size;setTextColor(color)}
    private fun empty(s:String)=text(s,14f,muted()).apply{gravity=Gravity.CENTER;setPadding(dp(10),dp(34),dp(10),dp(34))}
    private fun card()=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(14),dp(13),dp(14),dp(13));setBackgroundColor(Color.WHITE);elevation=dp(1).toFloat()}
    private fun money(v:Double)=NumberFormat.getCurrencyInstance(Locale.US).format(v)
    private fun kpiGrid(items:List<Pair<String,String>>)=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;items.chunked(2).forEach{rowItems->addView(LinearLayout(this@MainActivity).apply{orientation=LinearLayout.HORIZONTAL;rowItems.forEach{(k,v)->addView(card().apply{addView(text(k.uppercase(),10f,muted()));addView(text(v,19f,ink()).apply{setTypeface(typeface,1);setPadding(0,dp(4),0,0)})},LinearLayout.LayoutParams(0,-2,1f).apply{marginEnd=dp(6);bottomMargin=dp(7)})}},LinearLayout.LayoutParams(-1,-2))}}

    private fun showSeller(){ if(seller.url.isNullOrBlank())seller.loadUrl("https://sellerportal.tcgplayer.com/");nativeShell.visibility=View.GONE;agentWeb.visibility=View.GONE;seller.visibility=View.VISIBLE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.VISIBLE }

    private fun decodeJsString(raw:String):String=raw.replace("\\\"","\"").replace("\\n","\n").replace("\\\\","\\").trim('"')
    private fun verifySellerSession(after:(()->Unit)?=null){
        val url=seller.url.orEmpty().lowercase();val cookies=CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        val probe="""(function(){try{const b=(document.body?.innerText||'').toLowerCase();return JSON.stringify({passwordField:!!document.querySelector('input[type=password]'),loginText:/sign in|log in|forgot password/.test(b),logoutText:/sign out|log out|logout/.test(b),sellerNav:/orders|inventory|payments|seller portal|shipping/.test(b),title:document.title||'',path:location.pathname||'/'})}catch(e){return JSON.stringify({error:String(e)})}})();"""
        seller.evaluateJavascript(probe){raw->val t=decodeJsString(raw.orEmpty());sellerPortalSnapshot=t.ifBlank{"{}"};val login=url.contains("login")||url.contains("signin")||t.contains("\"passwordField\":true");val auth=t.contains("\"logoutText\":true")||(t.contains("\"sellerNav\":true")&&!t.contains("\"loginText\":true"));sellerSessionState=when{login->"signed_out";auth&&url.contains("tcgplayer.com")->"authenticated";cookies.isNotBlank()&&url.contains("tcgplayer.com")->"authenticated";else->"unknown"};after?.invoke()}
    }

    private fun startSellerOrdersProbeNative(){if(sellerSessionState!="authenticated"){sellerOrdersProbeState="error";sellerOrdersSnapshot="{\"error\":\"Seller Portal session is not authenticated\"}";return};sellerOrdersProbeState="navigating";seller.loadUrl("https://store.tcgplayer.com/admin/orders/orderlist");mainHandler.postDelayed({if(sellerOrdersProbeState=="navigating"){sellerOrdersProbeState="collecting";captureSellerOrdersProbe()}},5000)}
    private fun captureSellerOrdersProbe(){val probe="""(function(){try{const clean=s=>(s||'').replace(/\s+/g,' ').trim();const tables=[...document.querySelectorAll('table')].slice(0,8).map(t=>({headers:[...t.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)),rows:[...t.querySelectorAll('tbody tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('td')].map(td=>clean(td.innerText||td.textContent)))}));return JSON.stringify({title:document.title||'',url:location.href,tables,bodyText:clean(document.body?.innerText||'').slice(0,30000),checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e)})}})();""";seller.evaluateJavascript(probe){raw->val t=decodeJsString(raw.orEmpty());sellerOrdersSnapshot=t.ifBlank{"{\"error\":\"Empty orders probe\"}"};sellerOrdersProbeState=if(t.contains("\"error\":"))"error" else"ready"}}

    inner class Bridge {
        @JavascriptInterface fun getVersion()=version
        @JavascriptInterface fun openExternal(url:String){runOnUiThread{openExternalUrl(url)}}
        @JavascriptInterface fun getCollectorId():String{val p=getSharedPreferences("collectish-agent",MODE_PRIVATE);return p.getString("collectorId",null)?:UUID.randomUUID().toString().also{p.edit().putString("collectorId",it).apply()}}
        @JavascriptInterface fun getSessionState()=sellerSessionState
        @JavascriptInterface fun getSellerPortalSnapshot()=sellerPortalSnapshot
        @JavascriptInterface fun getSellerOrdersProbeState()=sellerOrdersProbeState
        @JavascriptInterface fun getSellerOrdersSnapshot()=sellerOrdersSnapshot
        @JavascriptInterface fun startSellerOrdersProbe(){runOnUiThread{startSellerOrdersProbeNative()}}
        @JavascriptInterface fun refreshSessionState(){runOnUiThread{verifySellerSession()}}
        @JavascriptInterface fun showSellerPortal(){runOnUiThread{showSeller()}}
        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE;showPage(currentPage)}}
        @JavascriptInterface fun setTheme(theme:String){runOnUiThread{applySystemTheme(theme.equals("dark",true))}}
    }

    override fun onResume(){
        super.onResume()
        if(::seller.isInitialized) verifySellerSession()
    }
    override fun onBackPressed(){when{seller.visibility==View.VISIBLE&&seller.canGoBack()->seller.goBack();seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;nativeShell.visibility=View.GONE;agentWeb.visibility=View.VISIBLE};else->super.onBackPressed()}}
}
