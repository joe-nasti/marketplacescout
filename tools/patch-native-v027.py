from pathlib import Path
import re

p=Path('android-agent/app/src/main/java/com/collectish/agent/MainActivity.kt')
s=p.read_text()

# Version identity.
s=s.replace('private val version = "0.2.6"','private val version = "0.2.7"')

# Imports for foreground-service startup.
if 'import android.content.Intent\n' not in s:
    s=s.replace('import android.app.Activity\n','import android.app.Activity\nimport android.content.Intent\n')

# Start the foreground service from a user-visible Activity launch. This is allowed by
# modern Android background execution rules and keeps the existing authenticated WebViews
# and JS claimant process alive when the user switches apps.
anchor='''        restoreSession()\n'''
insert='''        restoreSession()\n        try {\n            val syncIntent = Intent(this, SellerSyncService::class.java)\n            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(syncIntent) else startService(syncIntent)\n        } catch (_: Throwable) { }\n'''
if anchor not in s:
    raise SystemExit('v027 restoreSession anchor not found')
s=s.replace(anchor,insert,1)

p.write_text(s)

b=Path('android-agent/app/build.gradle.kts')
t=b.read_text()
t=re.sub(r'versionCode = \d+','versionCode = 27',t)
t=re.sub(r'versionName = "[0-9.]+"','versionName = "0.2.7"',t)
b.write_text(t)

print('Applied Collectish Android 0.2.7 foreground Seller sync patch')
