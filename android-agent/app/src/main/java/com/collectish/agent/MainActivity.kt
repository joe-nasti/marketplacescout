package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var collectish: WebView
    private lateinit var seller: WebView
    @Volatile private var sellerSessionState = "unknown"
    private val version = "0.1.1"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(WebView(this), true)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val content = FrameLayout(this)
        collectish = makeWebView()
        seller = makeWebView()
        content.addView(collectish, FrameLayout.LayoutParams(-1, -1))
        content.addView(seller, FrameLayout.LayoutParams(-1, -1))
        seller.visibility = View.GONE

        val nav = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val appButton = Button(this).apply {
            text = "Collectish"
            setOnClickListener {
                verifySellerSession { showCollectish() }
            }
        }
        val sellerButton = Button(this).apply { text = "TCGplayer"; setOnClickListener { showSeller() } }
        nav.addView(appButton, LinearLayout.LayoutParams(0, -2, 1f))
        nav.addView(sellerButton, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(nav, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        collectish.addJavascriptInterface(Bridge(), "CollectishAndroid")
        seller.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                verifySellerSession()
            }
        }
        collectish.loadUrl("https://joe-nasti.github.io/marketplacescout/")
        seller.loadUrl("https://sellerportal.tcgplayer.com/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWebView() = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        webChromeClient = WebChromeClient()
        webViewClient = WebViewClient()
    }

    private fun showCollectish() {
        collectish.visibility = View.VISIBLE
        seller.visibility = View.GONE
        collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))", null)
    }

    private fun showSeller() {
        seller.visibility = View.VISIBLE
        collectish.visibility = View.GONE
    }

    private fun verifySellerSession(after: (() -> Unit)? = null) {
        if (!::seller.isInitialized) { after?.invoke(); return }
        val currentUrl = seller.url.orEmpty()
        val cookieText = CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        val script = """
            (function(){
              try {
                const u=(location.href||'').toLowerCase();
                const body=(document.body?.innerText||'').toLowerCase();
                const hasPassword=!!document.querySelector('input[type=password]');
                const loginWords=/\b(sign in|log in|forgot password|create account)\b/.test(body);
                const logoutWords=/\b(sign out|log out|logout)\b/.test(body);
                const sellerNav=/\b(orders|inventory|payments|seller portal|reimbursement|shipping)\b/.test(body);
                const loginUrl=/login|signin|registration|authenticate|identity/.test(u);
                return JSON.stringify({u,hasPassword,loginWords,logoutWords,sellerNav,loginUrl});
              } catch(e) { return JSON.stringify({error:String(e)}); }
            })();
        """.trimIndent()
        seller.evaluateJavascript(script) { raw ->
            val text = raw.orEmpty().replace("\\\"", "\"").trim('"')
            val lowerUrl = currentUrl.lowercase()
            val obviousLogin = lowerUrl.contains("login") || lowerUrl.contains("signin") || lowerUrl.contains("registration") ||
                text.contains("\"hasPassword\":true") || text.contains("\"loginUrl\":true")
            val strongAuth = text.contains("\"logoutWords\":true") ||
                (text.contains("\"sellerNav\":true") && !text.contains("\"loginWords\":true"))
            val portalContext = lowerUrl.contains("tcgplayer.com") || text.contains("seller portal", true)
            sellerSessionState = when {
                obviousLogin -> "signed_out"
                strongAuth && portalContext -> "authenticated"
                cookieText.isNotBlank() && portalContext && !obviousLogin -> "authenticated"
                else -> "unknown"
            }
            after?.invoke()
            if (::collectish.isInitialized && collectish.visibility == View.VISIBLE) {
                collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))", null)
            }
        }
    }

    inner class Bridge {
        @JavascriptInterface fun getVersion(): String = version
        @JavascriptInterface fun getCollectorId(): String {
            val p = getSharedPreferences("collectish-agent", MODE_PRIVATE)
            return p.getString("collectorId", null) ?: UUID.randomUUID().toString().also {
                p.edit().putString("collectorId", it).apply()
            }
        }
        @JavascriptInterface fun getSessionState(): String = sellerSessionState
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
            collectish.visibility == View.VISIBLE && collectish.canGoBack() -> collectish.goBack()
            seller.visibility == View.VISIBLE -> verifySellerSession { showCollectish() }
            else -> super.onBackPressed()
        }
    }
}
