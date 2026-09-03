package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class DeepLinkActivity : Activity() {
    private lateinit var web: WebView
    private var injected = false
    private lateinit var targetUrl: String

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = intent?.data?.toString()?.takeIf { isCollectishUrl(it) }
            ?: "https://joe-nasti.github.io/marketplacescout/"
        targetUrl = markNativeDeepLink(incoming)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            setBackgroundColor(Color.WHITE)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    if (injected) return
                    injected = true
                    val prefs = getSharedPreferences("collectish-native", MODE_PRIVATE)
                    val access = prefs.getString("accessToken", null)
                    val refresh = prefs.getString("refreshToken", null)
                    if (access.isNullOrBlank() || refresh.isNullOrBlank()) return
                    val session = JSONObject().apply {
                        put("token", access)
                        put("refresh", refresh)
                        put("exp", jwtExpiryMillis(access))
                    }.toString()
                    val js = "localStorage.setItem('collectishSession', ${JSONObject.quote(session)}); location.replace(${JSONObject.quote(targetUrl)});"
                    view.evaluateJavascript(js, null)
                }
            }
        }
        setContentView(web)
        web.loadUrl(targetUrl)
    }

    private fun markNativeDeepLink(value: String): String = runCatching {
        val u = Uri.parse(value)
        u.buildUpon()
            .appendQueryParameter("webFallback", "1")
            .appendQueryParameter("nativeHost", "1")
            .build()
            .toString()
    }.getOrDefault(value)

    private fun isCollectishUrl(value: String): Boolean = runCatching {
        val u = Uri.parse(value)
        u.scheme.equals("https", true) && u.host.equals("joe-nasti.github.io", true) && u.path.orEmpty().startsWith("/marketplacescout")
    }.getOrDefault(false)

    private fun jwtExpiryMillis(token: String): Long = runCatching {
        val payload = token.split('.')[1]
        val decoded = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)
        JSONObject(decoded).optLong("exp", 0L).takeIf { it > 0 }?.times(1000L)
            ?: (System.currentTimeMillis() + 55 * 60 * 1000L)
    }.getOrDefault(System.currentTimeMillis() + 55 * 60 * 1000L)

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
