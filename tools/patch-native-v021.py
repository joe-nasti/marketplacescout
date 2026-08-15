from pathlib import Path

p = Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s = p.read_text()

# Imports needed by the native visual Scout and Android 15+ inset handling.
s = s.replace('import android.graphics.Color\n', 'import android.graphics.Color\nimport android.graphics.BitmapFactory\n')
s = s.replace('import android.view.Gravity\n', 'import android.view.Gravity\nimport android.view.WindowInsets\n')
s = s.replace('import android.widget.LinearLayout\n', 'import android.widget.LinearLayout\nimport android.widget.ImageView\n')
s = s.replace('import org.json.JSONArray\n', 'import org.json.JSONArray\nimport org.json.JSONObject\n')
s = s.replace('import java.text.NumberFormat\n', 'import java.text.NumberFormat\nimport java.net.URL\nimport java.net.URLEncoder\nimport javax.net.ssl.HttpsURLConnection\nimport kotlin.math.abs\nimport kotlin.math.max\nimport kotlin.math.min\n')

s = s.replace('private val version = "0.2.0"', 'private val version = "0.2.1"')
s = s.replace('Collectish 0.2.0', 'Collectish 0.2.1')

s = s.replace(
    'rootHost = FrameLayout(this).apply { setBackgroundColor(bg()) }',
    'rootHost = FrameLayout(this).apply { setBackgroundColor(bg()) }\n        installSafeInsets(rootHost)'
)

old_window = '''    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(true)
    }
'''
new_window = '''    private fun configureWindowSafely() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
            }
        }
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(false)
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
'''
if old_window not in s:
    raise SystemExit('window block not found')
s = s.replace(old_window, new_window)

start = s.index('    private fun loadScout() {')
end = s.index('    private fun loadSeller() {', start)

scout = r'''    private data class ScoutOpportunity(
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
                    c.connectTimeout=10000;c.readTimeout=15000;c.setRequestProperty("User-Agent","Collectish/0.2.1")
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
        c.connectTimeout=10000;c.readTimeout=15000;c.setRequestProperty("Accept","application/json;q=0.9,*/*;q=0.8");c.setRequestProperty("User-Agent","Collectish/0.2.1")
        val text=(if(c.responseCode in 200..299)c.inputStream else c.errorStream).bufferedReader().use{it.readText()}
        if(c.responseCode !in 200..299)throw IllegalStateException("Scryfall ${c.responseCode}")
        return JSONObject(text)
    }

'''
s = s[:start] + scout + s[end:]

p.write_text(s)

# Build metadata is intentionally updated at build time so this patch is atomic with the generated APK.
g = Path('android-agent/app/build.gradle.kts')
gs = g.read_text().replace('versionCode = 20', 'versionCode = 21').replace('versionName = "0.2.0"', 'versionName = "0.2.1"')
g.write_text(gs)

print('Applied Collectish native 0.2.1 patch')
