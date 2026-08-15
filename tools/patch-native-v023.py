from pathlib import Path

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

s=s.replace('private val version = "0.2.2"','private val version = "0.2.3"')
s=s.replace('Collectish 0.2.2','Collectish 0.2.3')
s=s.replace('Collectish/0.2.2','Collectish/0.2.3')

# Seller: JSON null numeric values must not become NaN and poison totals.
s=s.replace('gross+=r.optDouble("gross_amount");fees+=r.optDouble("fee_amount");net+=r.optDouble("net_amount");refunds+=r.optDouble("refund_total");if(!r.optBoolean("has_details",false))missing++',
'''gross+=if(r.isNull("gross_amount"))0.0 else r.optDouble("gross_amount",0.0);fees+=if(r.isNull("fee_amount"))0.0 else r.optDouble("fee_amount",0.0);net+=if(r.isNull("net_amount"))0.0 else r.optDouble("net_amount",0.0);refunds+=if(r.isNull("refund_total"))0.0 else r.optDouble("refund_total",0.0);if(!r.optBoolean("has_details",false))missing++''')
s=s.replace('text("${r.optString("order_date")} • ${r.optString("order_status")}",12f,muted())',
'''text("${r.optString("order_date")} • ${if(r.isNull("order_status")) "Details pending" else r.optString("order_status")}",12f,muted())''')
s=s.replace('text("Gross ${money(r.optDouble("gross_amount"))}   Net ${money(r.optDouble("net_amount"))}",13f,ink())',
'''text(if(r.isNull("gross_amount")&&r.isNull("net_amount")) "Financial detail pending" else "Gross ${money(if(r.isNull("gross_amount"))0.0 else r.optDouble("gross_amount",0.0))}   Net ${money(if(r.isNull("net_amount"))0.0 else r.optDouble("net_amount",0.0))}",13f,ink())''')

# SYP: parse booleans explicitly and use database counts rather than only the displayed 750 rows.
s=s.replace('var eligible=0; for(i in 0 until rows.length()) if(rows.getJSONObject(i).optBoolean("is_currently_eligible",false)) eligible++\n            val eventCount=runCatching{api.count(token,"syp_events")}.getOrDefault(0)',
'''val eligible=runCatching{api.count(token,"syp_products","is_currently_eligible=eq.true")}.getOrDefault(0)\n            val totalProducts=runCatching{api.count(token,"syp_products")}.getOrDefault(rows.length())\n            val eventCount=runCatching{api.count(token,"syp_events")}.getOrDefault(0)''')
s=s.replace('listOf("Loaded" to rows.length().toString(),"Eligible" to eligible.toString(),"Change events" to eventCount.toString())',
'listOf("Products" to totalProducts.toString(),"Eligible" to eligible.toString(),"Change events" to eventCount.toString())')
s=s.replace('${if(r.optBoolean("is_currently_eligible")) "Eligible" else "Not eligible"}',
'${if((r.opt("is_currently_eligible") as? Boolean)==true || r.optString("is_currently_eligible").equals("true",true)) "Eligible" else "Not eligible"}')
s=s.replace('if(r.optBoolean("is_currently_eligible"))Color.rgb(2,122,72) else muted()',
'if((r.opt("is_currently_eligible") as? Boolean)==true || r.optString("is_currently_eligible").equals("true",true))Color.rgb(2,122,72) else muted()')

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
for old in ['versionCode = 20','versionCode = 21','versionCode = 22']:
    t=t.replace(old,'versionCode = 23')
for old in ['versionName = "0.2.0"','versionName = "0.2.1"','versionName = "0.2.2"']:
    t=t.replace(old,'versionName = "0.2.3"')
b.write_text(t)

print('Applied Collectish native 0.2.3 data mapping patch')