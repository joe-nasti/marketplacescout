import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');

test('native Android Scout deep links suppress the browser-to-app handoff loop', () => {
  const native = read('android-agent/app/src/main/java/com/collectish/agent/DeepLinkActivity.kt');
  const web = read('src/main.js');

  expect(native).toContain('appendQueryParameter("webFallback", "1")');
  expect(native).toContain('appendQueryParameter("nativeHost", "1")');
  expect(native).toContain('web.loadUrl(targetUrl)');
  expect(web).toContain("p.get('webFallback')==='1'");
  expect(web).toContain('location.replace(target)');
});
