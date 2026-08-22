package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

class IntelShareActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private lateinit var web: WebView
    private var sourceUrl = ""
    private var sourceTitle = ""
    private var sharedText = ""
    private var captureAttempts = 0
    private var handoffPayload: String? = null
    private var handoffInjected = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindowSafely()

        sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        sourceTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
        sourceUrl = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE)
            .find(sharedText)?.value?.trimEnd('.', ',', ')', ']', '}') ?: ""

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg())
            setPadding(dp(14), dp(18), dp(14), dp(14))
        }
        installSafeInsets(root)
        root.addView(TextView(this).apply {
            text = "Add to MarketplaceScout Signals"
            textSize = 22f
            setTextColor(Color.rgb(16,24,40))
            setTypeface(typeface,1)
        })
        status = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.rgb(102,112,133))
            setPadding(0,dp(8),0,dp(10))
        }
        root.addView(status)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            setBackgroundColor(Color.WHITE)
            webViewClient = captureClient()
        }
        root.addView(web, LinearLayout.LayoutParams(-1,0,1f))
        root.addView(Button(this).apply {
            text="Close"
            isAllCaps=false
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(-1,dp(48)))
        setContentView(root)

        if(sourceUrl.isBlank()) {
            status.text="No public URL was included in the shared item."
            web.visibility=View.GONE
            return
        }

        val suppliedBody = sharedText.replace(sourceUrl,"").trim()
        if(suppliedBody.length >= 500) {
            handoff(sourceTitle, suppliedBody)
        } else {
            status.text="Rendering ${android.net.Uri.parse(sourceUrl).host ?: "article"} with JavaScript…"
            web.loadUrl(sourceUrl)
        }
    }

    private fun bg() = Color.rgb(245,248,252)
    private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()

    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }
        window.statusBarColor = bg()
        window.navigationBarColor = bg()
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.setSystemBarsAppearance(
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        }
    }

    private fun installSafeInsets(view: View) {
        view.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(dp(14)+safe.left, dp(18)+safe.top, dp(14)+safe.right, dp(14)+safe.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(
                    dp(14)+insets.systemWindowInsetLeft,
                    dp(18)+insets.systemWindowInsetTop,
                    dp(14)+insets.systemWindowInsetRight,
                    dp(14)+insets.systemWindowInsetBottom
                )
            }
            insets
        }
        view.requestApplyInsets()
    }

    private fun captureClient() = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            status.text = "Page rendered. Extracting visible article text…"
            handler.postDelayed({ captureRendered() }, 2400L)
        }
    }

    private fun hostedClient() = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            val payload = handoffPayload ?: return
            if (handoffInjected) {
                status.text = "MarketplaceScout is ready. Review the proposed Signals below."
                return
            }
            handoffInjected = true
            val quoted = JSONObject.quote(payload)
            val js = """
                (function(){
                  try{
                    sessionStorage.setItem('collectishPendingRenderedIntel',$quoted);
                    location.replace('https://joe-nasti.github.io/marketplacescout/?tab=signals&sharedIntel=1');
                  }catch(e){document.body.innerText='Could not hand off shared article: '+String(e);}
                })();
            """.trimIndent()
            view.evaluateJavascript(js, null)
        }
    }

    private fun decodeEval(raw:String):String = runCatching { JSONArray("[$raw]").getString(0) }.getOrDefault("")

    private fun captureRendered(){
        captureAttempts++
        val js="""(function(){try{const primary=document.querySelector('article')||document.querySelector('main')||document.body;return JSON.stringify({title:document.title||'',url:location.href,text:(primary?.innerText||document.body?.innerText||'').slice(0,70000)});}catch(e){return JSON.stringify({error:String(e)});}})();"""
        web.evaluateJavascript(js){raw->
            val decoded=decodeEval(raw)
            val data=runCatching{JSONObject(decoded)}.getOrNull()
            val text=data?.optString("text").orEmpty().trim()
            val title=data?.optString("title").orEmpty().ifBlank{sourceTitle}
            if(text.length<120 && captureAttempts<4){
                status.text="Waiting for article content to finish rendering…"
                handler.postDelayed({captureRendered()},2500L)
                return@evaluateJavascript
            }
            if(text.length<120){
                status.text="Could not find enough rendered article text on this page."
                return@evaluateJavascript
            }
            sourceUrl=data?.optString("url").orEmpty().ifBlank{sourceUrl}
            handoff(title,text)
        }
    }

    private fun handoff(title:String,text:String) {
        val payload = JSONObject()
            .put("url", sourceUrl)
            .put("title", title)
            .put("text", text.take(70000))
            .toString()
        handoffPayload = payload
        handoffInjected = false
        status.text = "Opening your signed-in MarketplaceScout Signals session…"
        web.webViewClient = hostedClient()
        web.loadUrl("https://joe-nasti.github.io/marketplacescout/?tab=signals&shareHandoff=1")
    }

    override fun onDestroy(){
        handler.removeCallbacksAndMessages(null)
        web.destroy()
        super.onDestroy()
    }
}
