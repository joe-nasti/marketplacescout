from pathlib import Path
import re

p = Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s = p.read_text()

# Add the return-control field without depending on nearby historical patch text.
if 'private lateinit var sellerReturn: Button' not in s:
    s, n = re.subn(
        r'(^\s*private lateinit var seller: WebView\s*$)',
        r'\1\n    private lateinit var sellerReturn: Button',
        s,
        count=1,
        flags=re.M,
    )
    if n != 1:
        raise SystemExit('v036 seller field anchor not found')

# Create the control after the seller WebView is mounted and before setContentView.
if 'sellerReturn = Button(this).apply' not in s:
    marker = '        setContentView(rootHost)'
    if marker not in s:
        raise SystemExit('v036 setContentView anchor not found')
    control = '''        sellerReturn = Button(this).apply {
            text = "← Collectish"
            isAllCaps = false
            textSize = 14f
            visibility = View.GONE
            setOnClickListener {
                seller.visibility = View.GONE
                visibility = View.GONE
                nativeShell.visibility = View.VISIBLE
                showPage(currentPage)
            }
        }
        rootHost.addView(sellerReturn, FrameLayout.LayoutParams(-2, dp(48), Gravity.TOP or Gravity.START).apply {
            leftMargin = dp(12)
            topMargin = dp(12)
        })
'''
    s = s.replace(marker, control + marker, 1)

# Show the control whenever the native Seller/Store WebView is presented.
show_pattern = re.compile(r'private fun showSeller\s*\(\s*\)\s*\{([^}]*)\}', re.S)
m = show_pattern.search(s)
if not m:
    raise SystemExit('v036 showSeller function not found')
body = m.group(1)
if 'sellerReturn.visibility' not in body:
    body = body.rstrip() + ';if(::sellerReturn.isInitialized)sellerReturn.visibility=View.VISIBLE '
    s = s[:m.start(1)] + body + s[m.end(1):]

# Normal Collectish rendering must hide the floating control.
def hide_after_seller_gone(text, needle):
    if needle not in text:
        return text
    replacement = needle + '\n        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE'
    if replacement in text:
        return text
    return text.replace(needle, replacement, 1)

s = hide_after_seller_gone(s, '        seller.visibility = View.GONE')
# Ensure the regular page path also hides it even when the first occurrence above was login.
page_anchor = '        nativeShell.visibility = View.VISIBLE'
page_idx = s.find(page_anchor, s.find('private fun showPage'))
if page_idx >= 0:
    before = s[:page_idx]
    if 'sellerReturn.visibility=View.GONE' not in before[max(0, before.rfind('private fun showPage')):]:
        s = s[:page_idx] + '        if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE\n' + s[page_idx:]

# Bridge return path should explicitly hide the floating control.
bridge_pattern = re.compile(r'@JavascriptInterface fun showCollectish\s*\(\s*\)\s*\{runOnUiThread\{([^}]*)\}\}')
m = bridge_pattern.search(s)
if not m:
    raise SystemExit('v036 showCollectish bridge not found')
if 'sellerReturn.visibility' not in m.group(1):
    old = m.group(0)
    new = '@JavascriptInterface fun showCollectish(){runOnUiThread{nativeShell.visibility=View.VISIBLE;seller.visibility=View.GONE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE;showPage(currentPage)}}'
    s = s.replace(old, new, 1)

# Back from a visible Seller/Store WebView should not leave the control floating.
s = s.replace(
    'seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;nativeShell.visibility=View.VISIBLE}',
    'seller.visibility==View.VISIBLE->{seller.visibility=View.GONE;if(::sellerReturn.isInitialized)sellerReturn.visibility=View.GONE;nativeShell.visibility=View.VISIBLE}',
    1,
)

if 'text = "← Collectish"' not in s:
    raise SystemExit('v036 return control text missing')
if 'sellerReturn.visibility=View.VISIBLE' not in s:
    raise SystemExit('v036 return control show behavior missing')
if 'sellerReturn.visibility=View.GONE' not in s:
    raise SystemExit('v036 return control hide behavior missing')

p.write_text(s)
print('One-tap TCGplayer WebView return control enabled')
