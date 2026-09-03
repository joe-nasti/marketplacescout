package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class DeepLinkActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var targetUrl: String
    private var freshRetryUsed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = intent?.data?.takeIf { isCollectishUri(it) }
        targetUrl = markNativeDeepLink(toHostedScoutUrl(incoming))

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
            setBackgroundColor(Color.WHITE)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (shouldRecoverAsset(request.url?.toString().orEmpty())) retryFresh(view)
                    else super.onReceivedError(view, request, error)
                }

                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    if (response.statusCode >= 400 && shouldRecoverAsset(request.url?.toString().orEmpty())) retryFresh(view)
                    else super.onReceivedHttpError(view, request, response)
                }
            }
        }
        setContentView(web)
        web.clearCache(true)
        bootstrapSessionThenOpen()
    }

    private fun toHostedScoutUrl(uri: Uri?): String {
        if (uri == null) return "https://joe-nasti.github.io/marketplacescout/"
        if (uri.scheme.equals("https", true)) return uri.toString()

        val builder = Uri.Builder()
            .scheme("https")
            .authority("joe-nasti.github.io")
            .path("/marketplacescout/")
        for (name in uri.queryParameterNames) {
            for (value in uri.getQueryParameters(name)) builder.appendQueryParameter(name, value)
        }
        return builder.build().toString()
    }

    private fun bootstrapSessionThenOpen() {
        val prefs = getSharedPreferences("collectish-native", MODE_PRIVATE)
        val access = prefs.getString("accessToken", null)
        val refresh = prefs.getString("refreshToken", null)
        if (access.isNullOrBlank() || refresh.isNullOrBlank()) {
            web.loadUrl(targetUrl)
            return
        }
        val session = JSONObject().apply {
            put("token", access)
            put("refresh", refresh)
            put("exp", jwtExpiryMillis(access))
        }.toString()
        val html = """
            <!doctype html><meta charset="utf-8"><script>
            try { localStorage.setItem('collectishSession', ${JSONObject.quote(session)}); }
            finally { location.replace(${JSONObject.quote(targetUrl)}); }
            </script>
        """.trimIndent()
        web.loadDataWithBaseURL(
            "https://joe-nasti.github.io/marketplacescout/",
            html,
            "text/html",
            "UTF-8",
            null
        )
    }

    private fun retryFresh(view: WebView) {
        if (freshRetryUsed) return
        freshRetryUsed = true
        view.stopLoading()
        view.clearCache(true)
        targetUrl = markNativeDeepLink(targetUrl)
        bootstrapSessionThenOpen()
    }

    private fun shouldRecoverAsset(value: String): Boolean {
        val lower = value.lowercase()
        return lower.contains("/marketplacescout/assets/") &&
            (lower.endsWith(".js") || lower.contains(".js?") || lower.endsWith(".css") || lower.contains(".css?"))
    }

    private fun markNativeDeepLink(value: String): String = runCatching {
        val u = Uri.parse(value)
        val builder = u.buildUpon().clearQuery()
        for (name in u.queryParameterNames) {
            if (name in setOf("webFallback", "nativeHost", "nativeBoot")) continue
            for (item in u.getQueryParameters(name)) builder.appendQueryParameter(name, item)
        }
        builder
            .appendQueryParameter("webFallback", "1")
            .appendQueryParameter("nativeHost", "1")
            .appendQueryParameter("nativeBoot", System.currentTimeMillis().toString())
            .build()
            .toString()
    }.getOrDefault(value)

    private fun isCollectishUri(uri: Uri): Boolean {
        val hosted = uri.scheme.equals("https", true) &&
            uri.host.equals("joe-nasti.github.io", true) &&
            uri.path.orEmpty().startsWith("/marketplacescout")
        val native = uri.scheme.equals("collectish", true) && uri.host.equals("scout", true)
        return hosted || native
    }

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
