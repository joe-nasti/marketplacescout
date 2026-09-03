import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('Android Scout links are diverted before Vite boot', () => {
  const html = read('index.html');
  expect(html).toContain("['sku','product','card','fromCard']");
  expect(html).toContain("./open.html'+location.search");
  expect(html.indexOf('./open.html')).toBeLessThan(html.indexOf("import('./src/main.js')"));
});

test('static opener requires a real user gesture and has browser fallback', () => {
  const html = read('public/open.html');
  expect(html).toContain('id="openApp"');
  expect(html).toContain("var nativeUrl='collectish://scout'");
  expect(html).toContain("fallback.searchParams.set('webFallback','1')");
  expect(html).toContain('id="openWeb"');
});

test('native deep link boot bypasses stale Vite cache and seeds auth before navigation', () => {
  const kotlin = read('android-agent/app/src/main/java/com/collectish/agent/DeepLinkActivity.kt');
  expect(kotlin).toContain('LOAD_NO_CACHE');
  expect(kotlin).toContain('web.clearCache(true)');
  expect(kotlin).toContain('loadDataWithBaseURL');
  expect(kotlin).toContain("localStorage.setItem('collectishSession'");
  expect(kotlin).toContain('nativeBoot');
  expect(kotlin).toContain('retryFresh');
});
