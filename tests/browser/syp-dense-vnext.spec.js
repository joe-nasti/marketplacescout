import { test, expect } from '@playwright/test';

test('SYP dense scan module remains importable and keeps legacy workspace path',async({page})=>{
  await page.goto('/');
  const source=await page.request.get('/src/modules/seller/syp-dense-vnext.js');
  expect(source.ok()).toBeTruthy();
  const text=await source.text();
  expect(text).toContain("data-sypv-mode=\"scan\"");
  expect(text).toContain("data-sypv-mode=\"workspace\"");
  expect(text).toContain('rpc/syp_marketplace_enrichment');
});
