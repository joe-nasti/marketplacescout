from pathlib import Path

p = Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s = p.read_text()

s = s.replace('private val version = "0.2.1"', 'private val version = "0.2.2"')
s = s.replace('Collectish 0.2.1', 'Collectish 0.2.2')
s = s.replace('Collectish/0.2.1', 'Collectish/0.2.2')

s = s.replace(
    'syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,max_qty,is_eligible,last_seen_at&order=last_seen_at.desc&limit=750',
    'syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,max_quantity,current_max_quantity,is_currently_eligible,last_seen&order=last_seen.desc&limit=750'
)
s = s.replace('optBoolean("is_eligible",false)', 'optBoolean("is_currently_eligible",false)')
s = s.replace('optBoolean("is_eligible")', 'optBoolean("is_currently_eligible")')
s = s.replace('optInt("max_qty")', 'optInt("current_max_quantity")')
s = s.replace('api.count(token,"syp_change_events")', 'api.count(token,"syp_events")')

if 'max_qty' in s or 'is_eligible' in s or 'last_seen_at' in s or 'syp_change_events' in s:
    raise SystemExit('stale SYP schema reference remains after patch')

p.write_text(s)

b = Path('android-agent/app/build.gradle.kts')
t = b.read_text()
t = t.replace('versionCode = 21', 'versionCode = 22').replace('versionCode = 20', 'versionCode = 22')
t = t.replace('versionName = "0.2.1"', 'versionName = "0.2.2"').replace('versionName = "0.2.0"', 'versionName = "0.2.2"')
b.write_text(t)
