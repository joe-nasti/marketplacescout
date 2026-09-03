import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');

test('Android app registers Collectish hosted Scout links',()=>{
  const manifest=read('android-agent/app/src/main/AndroidManifest.xml');
  expect(manifest).toContain('.DeepLinkActivity');
  expect(manifest).toContain('android.intent.action.VIEW');
  expect(manifest).toContain('android.intent.category.BROWSABLE');
  expect(manifest).toContain('android:host="joe-nasti.github.io"');
  expect(manifest).toContain('android:pathPrefix="/marketplacescout"');
});

test('Android web entry hands Scout targets to the installed app with a safe web fallback',()=>{
  const main=read('src/main.js');
  expect(main).toContain('handScoutDeepLinkToAndroid');
  expect(main).toContain("package=com.collectish.agent");
  expect(main).toContain("webFallback");
  expect(main).toContain("['sku','product','card','fromCard']");
});

test('DeepLinkActivity restores the native session before reloading the exact target',()=>{
  const activity=read('android-agent/app/src/main/java/com/collectish/agent/DeepLinkActivity.kt');
  expect(activity).toContain('collectish-native');
  expect(activity).toContain('collectishSession');
  expect(activity).toContain('location.replace');
  expect(activity).toContain('intent?.data?.toString()');
});
