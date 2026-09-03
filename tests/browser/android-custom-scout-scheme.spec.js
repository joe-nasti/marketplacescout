import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const manifest=fs.readFileSync('android-agent/app/src/main/AndroidManifest.xml','utf8');
const activity=fs.readFileSync('android-agent/app/src/main/java/com/collectish/agent/DeepLinkActivity.kt','utf8');
const opener=fs.readFileSync('public/open.html','utf8');

test('Android registers app-owned Collectish Scout scheme',()=>{
  expect(manifest).toContain('android:scheme="collectish"');
  expect(manifest).toContain('android:host="scout"');
});

test('opener uses collectish scheme rather than https intent routing',()=>{
  expect(opener).toContain("'collectish://scout'");
  expect(opener).not.toContain('scheme=https;package=com.collectish.agent');
});

test('DeepLinkActivity converts custom scheme to hosted Scout URL and preserves params',()=>{
  expect(activity).toContain('uri.scheme.equals("collectish", true)');
  expect(activity).toContain('uri.host.equals("scout", true)');
  expect(activity).toContain('.authority("joe-nasti.github.io")');
  expect(activity).toContain('.path("/marketplacescout/")');
  expect(activity).toContain('for (name in uri.queryParameterNames)');
});
