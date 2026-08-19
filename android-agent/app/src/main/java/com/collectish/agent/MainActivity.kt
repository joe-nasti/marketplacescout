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
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private val api = NativeSupabase()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var rootHost: FrameLayout
    private lateinit var nativeShell: LinearLayout
    private lateinit var contentHost: FrameLayout
    private lateinit var nav: LinearLayout
    private lateinit var agentWeb: WebView
    private lateinit var seller: WebView
    private var currentPage = "scout"
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var accountEmail: String? = null
    @Volatile private var sellerSessionState = "unknown"
    @Volatile private var sellerPortalSnapshot = "{}"
    @Volatile private var sellerOrdersProbeState = "idle"
    @Volatile private var sellerOrdersSnapshot = "{}"
    private val version = "0.2.0"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindowSafely()
        CookieManager.getInstance().setAcceptCookie(true)
        restoreSession()

        rootHost = FrameLayout(this).apply { setBackgroundColor(bg()) }
        nativeShell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(bg()) }
        contentHost = FrameLayout(this).apply { setBackgroundColor(bg()) }
        nav = buildNav()
        nativeShell.addView(contentHost, LinearLayout.LayoutParams(-1, 0, 1f))
        nativeShell.addView(nav, LinearLayout.LayoutParams(-1, dp(66)))
        rootHost.addView(nativeShell, FrameLayout.LayoutParams(-1, -1))

        agentWeb = makeWebView().apply { alpha = 0.01f }
        agentWeb.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        agentWeb.addJavascriptInterface(Bridge(), "CollectishAndroid")
        seller = makeWebView()
        agentWeb.addJavascriptInterface(ReadOnlyProbeBridge(this, seller) { sellerSessionState }, "CollectishReadOnly")
        seller.webViewClient = sellerClient()
        rootHost.addView(agentWeb, FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.START))
        rootHost.addView(seller, FrameLayout.LayoutParams(-1, -1))
        seller.visibility = View.GONE
        setContentView(rootHost)

        val shellBootUrl = "https://joe-nasti.github.io/marketplacescout/?androidBoot=${System.currentTimeMillis()}"
        agentWeb.loadUrl(shellBootUrl)
        seller.loadUrl("https://sellerportal.tcgplayer.com/")
        if (accessToken.isNullOrBlank()) showLogin() else showPage(currentPage)
    }

    private fun bg() = Color.rgb(245, 248, 252)
    private fun ink() = Color.rgb(16, 24, 40)
    private fun muted() = Color.rgb(102, 112, 133)
    private fun blue() = Color.rgb(47, 109, 246)
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

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
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
        setBackgroundColor(Color.WHITE)
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

    private fun loadScout() {
        val body = pageBase("Scout", "What should I buy?"); loading(body, "Ranking latest opportunities…")
        withToken { token ->
            val rows = api.get(token, "marketplace_scan_rows?select=sku_id,product_name,set_name,printing,condition,direct_low,sku_market_price,direct_available,avg_daily_qty_sold,opportunity_score,flag&id=not.is.null&order=id.desc&limit=750")
            val latest = linkedMapOf<String, org.json.JSONObject>()
            for (i in 0 until rows.length()) { val r = rows.getJSONObject(i); val k = r.optString("sku_id", "row-$i"); if (!latest.containsKey(k)) latest[k] = r }
            val ranked = latest.values.sortedByDescending { it.optDouble("opportunity_score", 0.0) }.take(30)
            runOnUiThread {
                val b = pageBase("Scout", "Ranked buying and speculation opportunities.")
                if (ranked.isEmpty()) b.addView(empty("No Scout rows are available yet."))
                ranked.forEachIndexed { idx, r ->
                    b.addView(card().apply {
                        addView(text("#${idx + 1}  ${r.optString("product_name", "Unknown card")}", 16f, ink()).apply { setTypeface(typeface, 1) })
                        addView(text("${r.optString("set_name")} • ${r.optString("printing")} • ${r.optString("condition")}", 12f, muted()).apply { setPadding(0, dp(3), 0, dp(8)) })
                        val score = r.optDouble("opportunity_score", 0.0).toInt(); val flag = r.optString("flag")
                        addView(text("$flag  •  Score $score/100", 13f, if (flag.equals("HOT", true)) Color.rgb(180,35,24) else blue()).apply { setTypeface(typeface, 1) })
                        addView(text("Market ${money(r.optDouble("sku_market_price"))}   Direct ${money(r.optDouble("direct_low"))}", 13f, ink()).apply { setPadding(0, dp(6), 0, 0) })
                        addView(text("Direct qty ${r.optInt("direct_available")}   •   ${String.format(Locale.US,"%.1f",r.optDouble("avg_daily_qty_sold"))} sales/day", 12f, muted()))
                    }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
                }
            }
        }
    }

    private fun loadSeller() {
        val body = pageBase("Seller", "How is the business doing?"); loading(body, "Loading order history…")
        withToken { token ->
            val rows = api.get(token, "seller_orders?select=order_number,order_date,order_status,gross_amount,fee_amount,net_amount,refund_total,has_details&order=order_date.desc&limit=1000")
            var gross=0.0; var fees=0.0; var net=0.0; var refunds=0.0; var missing=0
            for(i in 0 until rows.length()){ val r=rows.getJSONObject(i); gross+=r.optDouble("gross_amount");fees+=r.optDouble("fee_amount");net+=r.optDouble("net_amount");refunds+=r.optDouble("refund_total");if(!r.optBoolean("has_details",false))missing++ }
            runOnUiThread {
                val b=pageBase("Seller","Latest 1,000 orders in your synced history.")
                b.addView(kpiGrid(listOf("Orders" to rows.length().toString(),"Gross" to money(gross),"Net" to money(net),"Fees" to money(fees),"Refunds" to money(refunds),"Missing detail" to missing.toString())))
                for(i in 0 until minOf(rows.length(),25)){ val r=rows.getJSONObject(i); b.addView(card().apply {
                    addView(text(r.optString("order_number"),15f,ink()).apply{setTypeface(typeface,1)})
                    addView(text("${r.optString("order_date")} • ${r.optString("order_status")}",12f,muted()))
                    addView(text("Gross ${money(r.optDouble("gross_amount"))}   Net ${money(r.optDouble("net_amount"))}",13f,ink()).apply{setPadding(0,dp(6),0,0)})
                },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(9)}) }
            }
        }
    }

    private fun loadSyp() {
        val body = pageBase("SYP", "What changed?"); loading(body, "Loading Store Your Products history…")
        withToken { token ->
            val rows=api.get(token,"syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,max_qty,is_eligible,last_seen_at&order=last_seen_at.desc&limit=750")
            var eligible=0; for(i in 0 until rows.length()) if(rows.getJSONObject(i).optBoolean("is_eligible",false)) eligible++
            val eventCount=runCatching{api.count(token,"syp_change_events")}.getOrDefault(0)
            runOnUiThread {
                val b=pageBase("SYP","Eligibility, quantities, and recent product state.")
                b.addView(kpiGrid(listOf("Loaded" to rows.length().toString(),"Eligible" to eligible.toString(),"Change events" to eventCount.toString())))
                for(i in 0 until minOf(rows.length(),30)){ val r=rows.getJSONObject(i); b.addView(card().apply{
                    addView(text(r.optString("product_name","Unknown product"),15f,ink()).apply{setTypeface(typeface,1)})
                    addView(text("${r.optString("set_name")} • ${r.optString("condition")}",12f,muted()))
                    addView(text("${if(r.optBoolean("is_eligible")) "Eligible" else "Not eligible"}   •   Max ${r.optInt("max_qty")}   •   ${money(r.optDouble("market_price"))}",13f,if(r.optBoolean("is_eligible"))Color.rgb(2,122,72) else muted()))
                },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(9)}) }
            }
        }
    }

    private fun renderAdmin(){
        val b=pageBase("Admin","Cloud operations and build identity.")
        b.addView(card().apply {
            addView(text("Collectish 0.2.0",18f,ink()).apply{setTypeface(typeface,1)})
            addView(text(accountEmail ?: "Signed in",13f,muted()).apply{setPadding(0,dp(5),0,dp(10))})
            addView(text("TCGplayer session: $sellerSessionState",13f,ink()))
            addView(Button(this@MainActivity).apply { text="Open TCGplayer session";isAllCaps=false;setOnClickListener{showSeller()} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(12)})
            addView(Button(this@MainActivity).apply { text="Refresh TCGplayer status";isAllCaps=false;setOnClickListener{verifySellerSession{renderAdmin()}} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(6)})
            addView(Button(this@MainActivity).apply { text="Sign out of Collectish";isAllCaps=false;setOnClickListener{clearSession();showLogin()} },LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(16)})
        })
        b.addView(text("The Collectish UI is native. The hidden agent WebView is retained only for existing cloud orchestration while that bridge is migrated natively.",12f,muted()).apply{setPadding(0,dp(12),0,0)})
    }

    private fun kpiGrid(items:List<Pair<String,String>>):LinearLayout=LinearLayout(this).apply{
        orientation=LinearLayout.VERTICAL
        items.chunked(2).forEach{pair->addView(LinearLayout(this@MainActivity).apply{
            orientation=LinearLayout.HORIZONTAL
            pair.forEach{(k,v)->addView(card().apply{addView(text(k,11f,muted()));addView(text(v,20f,ink()).apply{setTypeface(typeface,1)})},LinearLayout.LayoutParams(0,-2,1f).apply{marginEnd=dp(6)})}
        },LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=dp(8)})}
    }

    private fun card()=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(14),dp(13),dp(14),dp(13));setBackgroundColor(Color.WHITE);elevation=dp(1).toFloat()}
    private fun title(s:String,size:Float)=text(s,size,ink()).apply{setTypeface(typeface,1)}
    private fun text(s:String,size:Float,color:Int)=TextView(this).apply{text=s;textSize=size;setTextColor(color)}
    private fun empty(s:String)=text(s,14f,muted()).apply{gravity=Gravity.CENTER;setPadding(dp(8),dp(36),dp(8),dp(36))}
    private fun money(v:Double)=NumberFormat.getCurrencyInstance(Locale.US).format(v)

    private fun withToken(block:(String)->Unit){thread{try{val token=ensureToken();block(token)}catch(e:Exception){runOnUiThread{val b=pageBase(currentPage.replaceFirstChar{it.uppercase()},"Could not load data.");b.addView(empty(e.message?:"Request failed"))}}}}
    private fun ensureToken():String{var t=accessToken;if(t.isNullOrBlank())throw IllegalStateException("Sign in required");try{api.get(t,"marketplace_scan_rows?select=sku_id&limit=1");return t}catch(_:Exception){};val r=refreshToken?:throw IllegalStateException("Session expired");val s=api.refresh(r);saveSession(s);return s.accessToken}

    private fun showSeller(){ nativeShell.visibility=View.GONE;seller.visibility=View.VISIBLE }

    private fun decodeJsString(raw:String):String=raw.replace("\\\"","\"").replace("\\n","\n").replace("\\\\","\\").trim('"')
    private fun verifySellerSession(after:(()->Unit)?=null){
        val url=seller.url.orEmpty().lowercase();val cookies=CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        val probe="""(function(){try{const b=(document.body?.innerText||'').toLowerCase();return JSON.stringify({passwordField:!!document.querySelector('input[type=password]'),loginText:/sign in|log in|forgot password/.test(b),logoutText:/sign out|log out|logout/.test(b),sellerNav:/orders|inventory|payments|seller portal|shipping/.test(b),title:document.title||'',path:location.pathname||'/'})}catch(e){return JSON.stringify({error:String(e)})}})();"""
        seller.evaluateJavascript(probe){raw->val t=decodeJsString(raw.orEmpty());sellerPortalSnapshot=t.ifBlank{"{}"};val login=url.contains("login")||url.contains("signin")||t.contains("\"passwordField\":true");val auth=t.contains("\"logoutText\":true")||(t.contains("\"sellerNav\":true")&&!t.contains("\"loginText\":true"));sellerSessionState=when{login->"signed_out";auth&&url.contains("tcgplayer.com")->"authenticated";cookies.isNotBlank()&&url.contains("tcgplayer.com")->"authenticated";else->"unknown"};after?.invoke()}
    }

    private fun startSellerOrdersProbeNative(){sellerOrdersProbeState="navigating";sellerOrdersSnapshot="{}";seller.loadUrl("https://sellerportal.tcgplayer.com/orders")}
    private fun captureSellerOrdersProbe(){
        val js="""(function(){try{const rows=[...document.querySelectorAll('table tbody tr')].slice(0,100).map(r=>[...r.querySelectorAll('td')].map(c=>(c.innerText||'').trim()));return JSON.stringify({url:location.href,title:document.title,rows,checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e),checkedAt:new Date().toISOString()})}})();"""
        seller.evaluateJavascript(js){raw->sellerOrdersSnapshot=decodeJsString(raw.orEmpty()).ifBlank{"{}"};sellerOrdersProbeState="ready"}
    }

    inner class Bridge {
        @JavascriptInterface fun setCollectishSession(a:String,r:String,e:String){accessToken=a;refreshToken=r;accountEmail=e;getSharedPreferences("collectish-native",MODE_PRIVATE).edit().putString("accessToken",a).putString("refreshToken",r).putString("email",e).apply()}
        @JavascriptInterface fun clearCollectishSession(){clearSession()}
        @JavascriptInterface fun getSessionState()=sellerSessionState
        @JavascriptInterface fun getSellerPortalSnapshot()=sellerPortalSnapshot
        @JavascriptInterface fun getSellerOrdersProbeState()=sellerOrdersProbeState
        @JavascriptInterface fun getSellerOrdersSnapshot()=sellerOrdersSnapshot
        @JavascriptInterface fun startSellerOrdersProbe(){runOnUiThread{startSellerOrdersProbeNative()}}
        @JavascriptInterface fun refreshSessionState(){runOnUiThread{verifySellerSession()}}
        @JavascriptInterface fun showSellerPortal(){runOnUiThread{showSeller()}}
        @JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}
    }

    override fun onResume(){super.onResume();if(::seller.isInitialized)verifySellerSession()}
    override fun onBackPressed(){when{seller.visibility==View.VISIBLE&&seller.canGoBack()->seller.goBack();seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;nativeShell.visibility=View.VISIBLE};else->super.onBackPressed()}}
}
