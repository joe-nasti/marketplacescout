from pathlib import Path

p = Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s = p.read_text()

field = '    private lateinit var seller: WebView\n'
if field not in s:
    raise SystemExit('v036 seller field anchor not found')
s = s.replace(field, field + '    private lateinit var sellerReturn: Button\n', 1)

anchor = '''        rootHost.addView(seller, FrameLayout.LayoutParams(-1, -1))\n        seller.visibility = View.GONE\n        setContentView(rootHost)'''
if anchor not in s:
    raise SystemExit('v036 seller root anchor not found')
replacement = '''        rootHost.addView(seller, FrameLayout.LayoutParams(-1, -1))\n        seller.visibility = View.GONE\n        sellerReturn = Button(this).apply {\n            text = "← Collectish"\n            isAllCaps = false\n            textSize = 14f\n            visibility = View.GONE\n            setOnClickListener {\n                seller.visibility = View.GONE\n                visibility = View.GONE\n                nativeShell.visibility = View.VISIBLE\n                showPage(currentPage)\n            }\n        }\n        rootHost.addView(sellerReturn, FrameLayout.LayoutParams(-2, dp(48), Gravity.TOP or Gravity.START).apply {\n            leftMargin = dp(12)\n            topMargin = dp(12)\n        })\n        setContentView(rootHost)'''
s = s.replace(anchor, replacement, 1)

old_show = '    private fun showSeller(){ nativeShell.visibility=View.GONE;seller.visibility=View.VISIBLE }'
if old_show not in s:
    raise SystemExit('v036 showSeller anchor not found')
s = s.replace(old_show, '    private fun showSeller(){ nativeShell.visibility=View.GONE;seller.visibility=View.VISIBLE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.VISIBLE }', 1)

# Ensure ordinary Collectish page/login rendering hides the floating WebView return control.
s = s.replace('        seller.visibility = View.GONE\n        nav.visibility = View.GONE', '        seller.visibility = View.GONE\n        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE\n        nav.visibility = View.GONE', 1)
s = s.replace('        seller.visibility = View.GONE\n        nativeShell.visibility = View.VISIBLE', '        seller.visibility = View.GONE\n        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE\n        nativeShell.visibility = View.VISIBLE', 1)

old_bridge = '@JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;showPage(currentPage)}}'
if old_bridge not in s:
    raise SystemExit('v036 showCollectish bridge anchor not found')
s = s.replace(old_bridge, '@JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE;showPage(currentPage)}}', 1)

if 'text = "← Collectish"' not in s or 'sellerReturn.visibility=View.VISIBLE' not in s:
    raise SystemExit('v036 return control missing')

p.write_text(s)
print('One-tap TCGplayer WebView return control enabled')
