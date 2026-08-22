package com.collectish.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

class IntelShareActivity : Activity() {
    private val api = NativeSupabase()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var web: WebView
    private lateinit var results: LinearLayout
    private lateinit var save: Button
    private var sourceUrl = ""
    private var sourceTitle = ""
    private var analysis: JSONObject? = null
    private var captureAttempts = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        sourceTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
        sourceUrl = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE).find(shared)?.value?.trimEnd('.', ',', ')', ']', '}') ?: ""

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(18), dp(14), dp(14)); setBackgroundColor(Color.rgb(245,248,252)) }
        root.addView(TextView(this).apply { text = "Add to MarketplaceScout Signals"; textSize = 22f; setTextColor(Color.rgb(16,24,40)); setTypeface(typeface,1) })
        status = TextView(this).apply { textSize = 13f; setTextColor(Color.rgb(102,112,133)); setPadding(0,dp(8),0,dp(10)) }
        root.addView(status)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true; settings.domStorageEnabled = true; settings.databaseEnabled = true
            settings.loadWithOverviewMode = true; settings.useWideViewPort = true
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    status.text = "Page rendered. Extracting visible article text…"
                    handler.postDelayed({ captureRendered() }, 2400L)
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(-1,0,1f))
        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        root.addView(ScrollView(this).apply { addView(results) }, LinearLayout.LayoutParams(-1,0,1f))
        save = Button(this).apply { text="Save selected signals"; isAllCaps=false; visibility=View.GONE; setOnClickListener { saveSelected() } }
        root.addView(save, LinearLayout.LayoutParams(-1,dp(52)))
        root.addView(Button(this).apply { text="Close"; isAllCaps=false; setOnClickListener { finish() } }, LinearLayout.LayoutParams(-1,dp(48)))
        setContentView(root)

        val prefs=getSharedPreferences("collectish-native",MODE_PRIVATE)
        if(prefs.getString("accessToken",null).isNullOrBlank()){status.text="Open Collectish and sign in first, then share this article again.";web.visibility=View.GONE;return}
        if(sourceUrl.isBlank()){status.text="No public URL was included in the shared item.";web.visibility=View.GONE;return}

        val suppliedBody = shared.replace(sourceUrl,"").trim()
        if(suppliedBody.length >= 500) analyze(sourceTitle,suppliedBody) else {
            status.text="Rendering ${android.net.Uri.parse(sourceUrl).host ?: "article"} with JavaScript…"
            web.loadUrl(sourceUrl)
        }
    }

    private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()

    private fun decodeEval(raw:String):String = runCatching { JSONArray("[$raw]").getString(0) }.getOrDefault("")

    private fun captureRendered(){
        captureAttempts++
        val js="""(function(){try{const primary=document.querySelector('article')||document.querySelector('main')||document.body;return JSON.stringify({title:document.title||'',url:location.href,text:(primary?.innerText||document.body?.innerText||'').slice(0,70000)});}catch(e){return JSON.stringify({error:String(e)});}})();"""
        web.evaluateJavascript(js){raw->
            val decoded=decodeEval(raw)
            val data=runCatching{JSONObject(decoded)}.getOrNull()
            val text=data?.optString("text").orEmpty().trim()
            val title=data?.optString("title").orEmpty().ifBlank{sourceTitle}
            if(text.length<120 && captureAttempts<3){status.text="Waiting for article content to finish rendering…";handler.postDelayed({captureRendered()},2500L);return@evaluateJavascript}
            if(text.length<120){status.text="Could not find enough rendered article text on this page.";return@evaluateJavascript}
            sourceUrl=data?.optString("url").orEmpty().ifBlank{sourceUrl}
            analyze(title,text)
        }
    }

    private fun currentToken():String?=getSharedPreferences("collectish-native",MODE_PRIVATE).getString("accessToken",null)
    private fun refreshToken():String?=getSharedPreferences("collectish-native",MODE_PRIVATE).getString("refreshToken",null)
    private fun saveSession(s:NativeSupabase.Session){getSharedPreferences("collectish-native",MODE_PRIVATE).edit().putString("accessToken",s.accessToken).putString("refreshToken",s.refreshToken).apply()}
    private fun <T> withToken(work:(String)->T):T{
        val token=currentToken()?:throw IllegalStateException("Sign in required")
        return try{work(token)}catch(first:Exception){val refresh=refreshToken()?:throw first;val s=api.refresh(refresh);saveSession(s);work(s.accessToken)}
    }

    private fun analyze(title:String,text:String){
        web.visibility=View.GONE;status.text="Analyzing ${text.length.coerceAtMost(70000)} rendered characters…"
        thread {
            try{val out=withToken{api.analyzeMarketIntel(it,sourceUrl,title,text)};analysis=out;runOnUiThread{renderAnalysis(out)}}
            catch(e:Exception){runOnUiThread{status.text=e.message?:"Could not analyze this page."}}
        }
    }

    private fun renderAnalysis(out:JSONObject){
        val signals=out.optJSONArray("signals")?:JSONArray();results.removeAllViews();results.visibility=View.VISIBLE
        val heading=out.optString("title").ifBlank{sourceTitle.ifBlank{"Analyzed article"}}
        results.addView(TextView(this).apply{text=heading;textSize=18f;setTextColor(Color.rgb(16,24,40));setTypeface(typeface,1);setPadding(0,dp(6),0,dp(4))})
        out.optString("source_summary").takeIf{it.isNotBlank()}?.let{s->results.addView(TextView(this).apply{text=s;textSize=13f;setTextColor(Color.rgb(74,85,104));setPadding(0,0,0,dp(10))})}
        for(i in 0 until signals.length()){
            val s=signals.getJSONObject(i)
            results.addView(CheckBox(this).apply{
                tag=s;isChecked=!s.optString("signal_stage").equals("noise",true)
                text="${s.optString("entity_name")}  •  ${s.optString("signal_stage").uppercase()}\n${s.optString("summary")}"
                textSize=13f;setTextColor(Color.rgb(16,24,40));setPadding(0,dp(7),0,dp(7));gravity=Gravity.TOP
            })
        }
        status.text="Found ${signals.length()} proposed signal${if(signals.length()==1)"" else "s"}. Review before saving."
        save.visibility=if(signals.length()>0)View.VISIBLE else View.GONE
    }

    private fun saveSelected(){
        val out=analysis?:return
        val selected=(0 until results.childCount).mapNotNull{results.getChildAt(it) as? CheckBox}.filter{it.isChecked}.mapNotNull{it.tag as? JSONObject}
        if(selected.isEmpty()){status.text="Select at least one signal.";return}
        save.isEnabled=false;status.text="Saving ${selected.size} signal${if(selected.size==1)"" else "s"}…"
        thread {
            try{
                withToken{token->
                    val source=runCatching{android.net.Uri.parse(sourceUrl).host.orEmpty().removePrefix("www.").substringBeforeLast('.')}.getOrDefault("article")
                    selected.forEach{s->
                        val item=api.insertOne(token,"market_intel_items",JSONObject()
                            .put("source_type","article").put("source_name",source).put("source_url",sourceUrl)
                            .put("title",out.optString("title").ifBlank{s.optString("entity_name")})
                            .put("author",out.optString("author").takeIf{it.isNotBlank()})
                            .put("summary",s.optString("summary")).put("claim_type",s.optString("claim_type","other"))
                            .put("signal_stage",s.optString("signal_stage","unclassified")).put("direction",s.optString("direction","neutral"))
                            .put("confidence",s.optDouble("confidence",0.5)).put("published_at",out.optString("published_at").takeIf{it.isNotBlank()}))
                        api.insertOne(token,"market_intel_entities",JSONObject().put("intel_id",item.getString("intel_id"))
                            .put("entity_type",s.optString("entity_type","other")).put("entity_name",s.optString("entity_name"))
                            .put("scryfall_id",s.optString("scryfall_id").takeIf{it.isNotBlank()}).put("set_code",s.optString("set_code").takeIf{it.isNotBlank()})
                            .put("confidence",if(s.optString("scryfall_id").isNotBlank())0.99 else s.optDouble("confidence",0.6)))
                    }
                }
                runOnUiThread{save.isEnabled=true;save.visibility=View.GONE;status.text="Saved ${selected.size} signal${if(selected.size==1)"" else "s"} to MarketplaceScout."}
            }catch(e:Exception){runOnUiThread{save.isEnabled=true;status.text=e.message?:"Could not save signals."}}
        }
    }

    override fun onDestroy(){handler.removeCallbacksAndMessages(null);web.destroy();super.onDestroy()}
}
