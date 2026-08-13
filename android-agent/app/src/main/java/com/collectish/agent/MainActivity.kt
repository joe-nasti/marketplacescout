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
    @Volatile private var sellerAuthenticated = false
    private val version = "0.1.0"

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
        val appButton = Button(this).apply { text = "Collectish"; setOnClickListener { showCollectish() } }
        val sellerButton = Button(this).apply { text = "TCGplayer"; setOnClickListener { showSeller() } }
        nav.addView(appButton, LinearLayout.LayoutParams(0, -2, 1f))
        nav.addView(sellerButton, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(nav, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        collectish.addJavascriptInterface(Bridge(), "CollectishAndroid")
        seller.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                sellerAuthenticated = url.contains("sellerportal.tcgplayer.com", true) &&
                    !url.contains("registration", true) && !url.contains("login", true)
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

    private fun showCollectish() { collectish.visibility = View.VISIBLE; seller.visibility = View.GONE }
    private fun showSeller() { seller.visibility = View.VISIBLE; collectish.visibility = View.GONE }

    inner class Bridge {
        @JavascriptInterface fun getVersion(): String = version
        @JavascriptInterface fun getCollectorId(): String {
            val p = getSharedPreferences("collectish-agent", MODE_PRIVATE)
            return p.getString("collectorId", null) ?: UUID.randomUUID().toString().also {
                p.edit().putString("collectorId", it).apply()
            }
        }
        @JavascriptInterface fun getSessionState(): String = if (sellerAuthenticated) "authenticated" else "unknown"
        @JavascriptInterface fun showSellerPortal() { runOnUiThread { showSeller() } }
        @JavascriptInterface fun showCollectish() { runOnUiThread { showCollectish() } }
    }

    override fun onBackPressed() {
        when {
            seller.visibility == View.VISIBLE && seller.canGoBack() -> seller.goBack()
            collectish.visibility == View.VISIBLE && collectish.canGoBack() -> collectish.goBack()
            seller.visibility == View.VISIBLE -> showCollectish()
            else -> super.onBackPressed()
        }
    }
}
