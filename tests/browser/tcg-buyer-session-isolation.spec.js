import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('buyer connector uses a separate persistent isolated WebView profile and login',async()=>{
  const [bridge,policy,buyer,gradle]=await Promise.all([
    read('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbeBridge.kt'),
    read('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbePolicy.kt'),
    read('src/modules/seller/buyer-account.js'),
    read('android-agent/app/build.gradle.kts')
  ]);
  expect(gradle).toContain('androidx.webkit:webkit:1.15.0');
  expect(bridge).toContain('WebViewCompat.setProfile(view, "collectish-buyer")');
  expect(bridge).toContain('isBuyerProfileIsolated');
  expect(bridge).toContain('showBuyerSession');
  expect(bridge).toContain('https://www.tcgplayer.com/login?returnUrl=/myaccount/orderhistory');
  expect(bridge).toContain('CookieManager.getInstance().flush()');
  expect(bridge).toContain('persistBuyerSession');
  expect(bridge).not.toContain('removeAllCookies');
  expect(bridge).not.toContain('removeSessionCookies');
  expect(policy).toContain('"www.tcgplayer.com"');
  expect(policy).toContain('fun isBuyerAccountRequest');
  expect(buyer).toContain("const BUYER_LOGIN='https://www.tcgplayer.com/login?returnUrl=/myaccount/orderhistory'");
  expect(buyer).toContain('b?.showBuyerSession');
  expect(buyer).not.toContain('showSellerPortal');
});

test('buyer reads remain GET-only and separate from seller POST allowlists',async()=>{
  const policy=await read('android-agent/app/src/main/java/com/collectish/agent/ReadOnlyProbePolicy.kt');
  expect(policy).toContain('"www.tcgplayer.com" -> isBuyerAccountRequest(rawUrl)');
  expect(policy).toContain('"store.tcgplayer.com" -> path in storeInventoryReadOnlyPostPaths');
  expect(policy).not.toMatch(/"www\.tcgplayer\.com"\s*->\s*path in/);
});
