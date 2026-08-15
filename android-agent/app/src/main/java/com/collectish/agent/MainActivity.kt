package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var sellerSessionState = "unknown"
    @Volatile private var sellerPortalSnapshot = "{}"
    @Volatile private var sellerOrdersProbeState = "idle"
    @Volatile private var sellerOrdersSnapshot = "{}"
    private val version = "0.1.11"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindowSafely()
        CookieManager.getInstance().setAcceptCookie(true)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; fitsSystemWindows = true }
        val content = FrameLayout(this)
        collectish = makeWebView(); seller = makeWebView()
        content.addView(collectish, FrameLayout.LayoutParams(-1, -1)); content.addView(seller, FrameLayout.LayoutParams(-1, -1)); seller.visibility = View.GONE
        val nav = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        nav.addView(Button(this).apply { text="Collectish"; setOnClickListener { verifySellerSession { showCollectish() } } }, LinearLayout.LayoutParams(0,-2,1f))
        nav.addView(Button(this).apply { text="TCGplayer"; setOnClickListener { showSeller() } }, LinearLayout.LayoutParams(0,-2,1f))
        root.addView(content, LinearLayout.LayoutParams(-1,0,1f)); root.addView(nav, LinearLayout.LayoutParams(-1,-2)); setContentView(root)

        collectish.addJavascriptInterface(Bridge(), "CollectishAndroid")
        collectish.addJavascriptInterface(ReadOnlyProbeBridge(this, seller) { sellerSessionState }, "CollectishReadOnly")
        seller.webViewClient = object: WebViewClient(){
            override fun onPageFinished(view:WebView,url:String){
                verifySellerSession()
                if(sellerOrdersProbeState=="navigating"){
                    sellerOrdersProbeState="collecting"
                    mainHandler.postDelayed({ captureSellerOrdersProbe() },1800)
                }
            }
        }
        collectish.loadUrl("https://joe-nasti.github.io/marketplacescout/"); seller.loadUrl("https://sellerportal.tcgplayer.com/")
    }

    private fun configureWindowSafely(){
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if(Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)
    }

    @SuppressLint("SetJavaScriptEnabled") private fun makeWebView()=WebView(this).apply{settings.javaScriptEnabled=true;settings.domStorageEnabled=true;settings.databaseEnabled=true;webChromeClient=WebChromeClient();webViewClient=WebViewClient()}
    private fun showCollectish(){collectish.visibility=View.VISIBLE;seller.visibility=View.GONE;collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))",null)}
    private fun showSeller(){seller.visibility=View.VISIBLE;collectish.visibility=View.GONE}
    private fun decodeJsString(raw:String):String=raw.replace("\\\"","\"").replace("\\n","\n").replace("\\\\","\\").trim('"')

    private fun verifySellerSession(after:(()->Unit)?=null){
        if(!::seller.isInitialized){after?.invoke();return}
        val url=seller.url.orEmpty().lowercase(); val cookies=CookieManager.getInstance().getCookie("https://sellerportal.tcgplayer.com/").orEmpty()
        val probe="""(function(){try{const text=(document.body?.innerText||'');const b=text.toLowerCase();const visible=['orders','inventory','payments','shipping','messages','settings'].filter(x=>b.includes(x));const links=[...document.querySelectorAll('a[href]')].map(a=>({text:(a.innerText||a.textContent||'').trim().replace(/\s+/g,' ').slice(0,120),href:a.href})).filter(x=>x.text||/order|inventory|payment|shipping/i.test(x.href)).slice(0,80);return JSON.stringify({passwordField:!!document.querySelector('input[type=password]'),loginText:/sign in|log in|forgot password/.test(b),logoutText:/sign out|log out|logout/.test(b),sellerNav:/orders|inventory|payments|seller portal|shipping/.test(b),title:document.title||'',path:location.pathname||'/',visibleSections:visible,links,checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e)})}})();"""
        seller.evaluateJavascript(probe) { raw ->
            val t=decodeJsString(raw.orEmpty()); sellerPortalSnapshot=t.ifBlank { "{}" }
            val login=url.contains("login")||url.contains("signin")||url.contains("registration")||t.contains("\"passwordField\":true")
            val auth=t.contains("\"logoutText\":true")||(t.contains("\"sellerNav\":true")&&!t.contains("\"loginText\":true"))
            sellerSessionState=when{login->"signed_out"; auth&&url.contains("tcgplayer.com")->"authenticated"; cookies.isNotBlank()&&url.contains("tcgplayer.com")->"authenticated";else->"unknown"}
            after?.invoke(); if(::collectish.isInitialized&&collectish.visibility==View.VISIBLE)collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))",null)
        }
    }

    private fun startSellerOrdersProbeNative(){
        if(!::seller.isInitialized){sellerOrdersProbeState="error";sellerOrdersSnapshot="{\"error\":\"Seller WebView unavailable\"}";return}
        sellerOrdersProbeState="locating"; sellerOrdersSnapshot="{}"
        verifySellerSession {
            if(sellerSessionState!="authenticated"){sellerOrdersProbeState="error";sellerOrdersSnapshot="{\"error\":\"Seller Portal session is not authenticated\"}";return@verifySellerSession}
            sellerOrdersProbeState="navigating"; seller.loadUrl("https://store.tcgplayer.com/admin/orders/orderlist")
            mainHandler.postDelayed({if(sellerOrdersProbeState=="navigating"){sellerOrdersProbeState="collecting";captureSellerOrdersProbe()}},5000)
        }
    }

    private fun captureSellerOrdersProbe(){
        if(!::seller.isInitialized)return
        val probe="""(function(){try{const clean=s=>(s||'').replace(/\s+/g,' ').trim();const tables=[...document.querySelectorAll('table')].slice(0,8).map((table,ti)=>({index:ti,headers:[...table.querySelectorAll('thead th')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean),rows:[...table.querySelectorAll('tbody tr,tr')].slice(0,120).map(tr=>[...tr.querySelectorAll('th,td')].map(td=>clean(td.innerText||td.textContent).slice(0,500))).filter(r=>r.length)}));const grids=[...document.querySelectorAll('[role=row]')].slice(0,160).map(r=>[...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map(c=>clean(c.innerText||c.textContent).slice(0,500))).filter(r=>r.length);const links=[...document.querySelectorAll('a[href]')].map(a=>({text:clean(a.innerText||a.textContent).slice(0,160),href:a.href})).filter(x=>/order|refund|payment|transaction|shipping|seller/i.test(x.text+' '+x.href)).slice(0,120);const buttons=[...document.querySelectorAll('button,[role=button]')].map(b=>clean(b.innerText||b.textContent)).filter(Boolean).slice(0,100);const forms=[...document.forms].slice(0,20).map(f=>({action:f.action,method:f.method,controls:[...f.elements].slice(0,60).map(e=>({name:e.name||'',type:e.type||'',value:(e.type==='hidden'?String(e.value||'').slice(0,300):'')}))}));const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/tcgplayer|sellerportal/i.test(u)&&/api|order|refund|payment|transaction|shipping|seller/i.test(u)).slice(-160);const body=clean(document.body?.innerText||'').slice(0,30000);return JSON.stringify({title:document.title||'',url:location.href,path:location.pathname||'/',tables,grids,links,buttons,forms,resources,bodyText:body,counts:{tables:tables.length,gridRows:grids.length,links:links.length,resources:resources.length},checkedAt:new Date().toISOString()})}catch(e){return JSON.stringify({error:String(e),url:location.href,checkedAt:new Date().toISOString()})}})();"""
        seller.evaluateJavascript(probe){raw->
            val t=decodeJsString(raw.orEmpty()); sellerOrdersSnapshot=t.ifBlank { "{\"error\":\"Empty orders probe\"}" }; sellerOrdersProbeState=if(t.contains("\"error\":"))"error" else "ready"
            if(::collectish.isInitialized&&collectish.visibility==View.VISIBLE)collectish.evaluateJavascript("window.dispatchEvent(new Event('collectishAgentSessionChanged'))",null)
        }
    }

    inner class Bridge{
        @JavascriptInterface fun getVersion()=version
        @JavascriptInterface fun getCollectorId():String{val p=getSharedPreferences("collectish-agent",MODE_PRIVATE);return p.getString("collectorId",null)?:UUID.randomUUID().toString().also{p.edit().putString("collectorId",it).apply()}}
        @JavascriptInterface fun getSessionState()=sellerSessionState
        @JavascriptInterface fun getSellerPortalSnapshot()=sellerPortalSnapshot
        @JavascriptInterface fun getSellerOrdersProbeState()=sellerOrdersProbeState
        @JavascriptInterface fun getSellerOrdersSnapshot()=sellerOrdersSnapshot
        @JavascriptInterface fun startSellerOrdersProbe(){runOnUiThread{this@MainActivity.startSellerOrdersProbeNative()}}
        @JavascriptInterface fun refreshSessionState(){runOnUiThread{verifySellerSession()}}
        @JavascriptInterface fun showSellerPortal(){runOnUiThread{showSeller()}}
        @JavascriptInterface fun showCollectish(){runOnUiThread{verifySellerSession{showCollectish()}}}
    }
    override fun onResume(){super.onResume();if(::seller.isInitialized)verifySellerSession()}
    override fun onBackPressed(){when{seller.visibility==View.VISIBLE&&seller.canGoBack()->seller.goBack();collectish.visibility==View.VISIBLE&&collectish.canGoBack()->collectish.goBack();seller.visibility==View.VISIBLE->verifySellerSession{showCollectish()};else->super.onBackPressed()}}
}
