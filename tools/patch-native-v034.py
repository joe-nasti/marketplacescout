from pathlib import Path

p = Path('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbeBridge.kt')
s = p.read_text()

# Inventory sync must validate the actual Store origin, not rely on the coarse
# Seller Portal session label. The hidden WebView can retain a valid
# store.tcgplayer.com session even when sellerportal.tcgplayer.com is currently
# classified as unknown/signed_out. The origin guard below already primes Store
# and rejects redirects away from Store, while runFetch detects login HTML.
old_gate = '''                if (sessionState() != "authenticated") { fail("Seller Portal session is not authenticated"); return@runOnUiThread }\n'''
if old_gate not in s:
    raise SystemExit('v034 Seller Portal auth gate anchor not found')
s = s.replace(old_gate, '''                // Do not pre-reject from the coarse Seller Portal state.\n                // The request itself verifies the authenticated Store origin.\n''', 1)

old_not_ready = '''                fail("Authenticated Store origin was not ready for the allowlisted request")'''
if old_not_ready not in s:
    raise SystemExit('v034 Store origin error anchor not found')
s = s.replace(
    old_not_ready,
    '''                fail("TCGplayer Store session is not authenticated (Store origin redirected away before request)")''',
    1
)

# Durable assertions so later native patch-chain changes cannot silently restore
# the false-negative preflight gate.
if 'sessionState() != "authenticated"' in s:
    raise SystemExit('v034 stale Seller Portal preflight auth gate remains')
if 'TCGplayer Store session is not authenticated' not in s:
    raise SystemExit('v034 Store-origin auth diagnostic missing')
if 'credentials:\'include\'' not in s:
    raise SystemExit('v034 credentialed Store fetch missing')

p.write_text(s)
print('Android Store-origin authentication validation enabled')
