package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
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
    private val version = "0.1.2"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep Android system UI visible and let the OS reserve safe space for it.
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(true)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }

        CookieManager.getInstance().setAcceptCookie(true)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val content = FrameLayout(this)
        collectish = makeWebView(); seller = makeWebView()
        content.addView(collectish, FrameLayout.LayoutParams(-1, -1)); content.addView(seller, FrameLayout.LayoutParams(-1, -1)); seller.visibility = View.GONE
        val nav = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        nav.addView(Button(this).apply { text="Collectish"; setOnClickListener { verifySellerSession { showCollectish() } } }, LinearLayout.LayoutParams(0,-2,1f))
        nav.addView(Button(this).apply { text="TCGplayer"; setOnClickListener { showSeller() } }, LinearLayout.LayoutParams(0,-2,1f))
        root.addView(content, LinearLayout.LayoutParams(-1,0,1f)); root.addView(nav, LinearLayout.LayoutParams(-1,-2)); setContentView(root)

        collectish.addJavascriptInterface(Bridge(), "CollectishAndroid")
        seller.webViewClient = object: WebViewClient(){ override fun onPageFinished(view:WebView,url:String){ verifySellerSession() } }
        collectish.loadUrl("https://joe-nasti.github.io/marketplacescout/"); seller.loadUrl("https://sellerportal.tcgplayer.com/")
    }

    @SuppressLint("SetJavaScriptEnabled") private fun makeWebView()=WebView(this).apply{settings.javaScriptEnabled=true;settings.domStorageEnabled=true;settings.databaseEnabled=true;webChromeClient=WebChromeClient();webViewClient=WebViewClient()}
    private fun showCollectish(){collectish.visibility=View.VISIBLE;seller.visibility=View.GONE;collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))",null)}
    private fun showSeller(){seller.visibility=View.VISIBLE;collectish.visibility=View.GONE}

    private fun verifySellerSession(after:(()->Unit)?=null){
        if(!::seller.isInitialized){after?.invoke();return}
        val url=seller.url.orEmpty().lowercase(); val cookies=CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        seller.evaluateJavascript("(function(){try{const b=(document.body?.innerText||'').toLowerCase();return JSON.stringify({p:!!document.querySelector('input[type=password]'),l:/sign in|log in|forgot password/.test(b),o:/sign out|log out|logout/.test(b),n:/orders|inventory|payments|seller portal|shipping/.test(b)})}catch(e){return '{}'}})();") { raw ->
            val t=raw.orEmpty().replace("\\\"","\"").trim('"'); val login=url.contains("login")||url.contains("signin")||url.contains("registration")||t.contains("\"p\":true"); val auth=t.contains("\"o\":true")||(t.contains("\"n\":true")&&!t.contains("\"l\":true"))
            sellerSessionState=when{login->"signed_out"; auth&&url.contains("tcgplayer.com")->"authenticated"; cookies.isNotBlank()&&url.contains("tcgplayer.com")->"authenticated";else->"unknown"}
            after?.invoke(); if(::collectish.isInitialized&&collectish.visibility==View.VISIBLE)collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))",null)
        }
    }

    inner class Bridge{
        @JavascriptInterface fun getVersion()=version
        @JavascriptInterface fun getCollectorId():String{val p=getSharedPreferences("collectish-agent",MODE_PRIVATE);return p.getString("collectorId",null)?:UUID.randomUUID().toString().also{p.edit().putString("collectorId",it).apply()}}
        @JavascriptInterface fun getSessionState()=sellerSessionState
        @JavascriptInterface fun refreshSessionState(){runOnUiThread{verifySellerSession()}}
        @JavascriptInterface fun showSellerPortal(){runOnUiThread{showSeller()}}
        @JavascriptInterface fun showCollectish(){runOnUiThread{verifySellerSession{showCollectish()}}}
    }
    override fun onResume(){super.onResume();if(::seller.isInitialized)verifySellerSession()}
    override fun onBackPressed(){when{seller.visibility==View.VISIBLE&&seller.canGoBack()->seller.goBack();collectish.visibility==View.VISIBLE&&collectish.canGoBack()->collectish.goBack();seller.visibility==View.VISIBLE->verifySellerSession{showCollectish()};else->super.onBackPressed()}}
}
