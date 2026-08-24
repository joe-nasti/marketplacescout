import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Seller lazy page retains cashflow and buyer-account enhancers',async()=>{
  const source=await read('src/modules/seller/index.js');
  expect(source).toContain("import('./cashflow-budget.js')");
  expect(source).toContain("import('./buyer-account.js')");
});

test('Seller remains lazy-loaded from page lifecycle',async()=>{
  const source=await read('src/core/lazy-pages.js');
  expect(source).toContain("seller:async()=>{const m=await import('../modules/seller/index.js');await m.install()}");
});
