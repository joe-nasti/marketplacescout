import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Signals and Ask enhancement bundles load only after user intent',async({},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop-chromium','source contract only needs one project');
  const source=await readFile('src/modules/index.js','utf8');
  expect(source).not.toContain('scheduleIdleEnhancers');
  expect(source).toContain("event.detail?.page==='signals'");
  expect(source).toContain("document.addEventListener('collectish:scout-detail-rendered'");
  expect(source).toContain("document.addEventListener('collectish:open-ask'");
  expect(source).toContain('window.__CollectishOpenAskRequested');
  expect(source.indexOf("import('./ask/main.js')")).toBeLessThan(source.indexOf("import('./ask/streaming.js')"));
});
