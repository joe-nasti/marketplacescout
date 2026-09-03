import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const read=p=>readFile(path.join(root,p),'utf8');

test('Seller lazy page retains buyer-account enhancer without the deferred buying-budget surface',async()=>{
  const source=await read('src/modules/seller/index.js');
  expect(source).not.toContain("import('./cashflow-budget.js')");
  expect(source).toContain("import('./buyer-account.js')");
});

test('Seller remains lifecycle-lazy while allowing code-only intent prefetch',async()=>{
  const source=await read('src/core/lazy-pages.js');
  expect(source).toContain("seller:()=>import('../modules/seller/index.js')");
  expect(source).toContain('onPage(page){if(pageModules[page])loadPage(page)');
  expect(source).toContain('const m=await moduleFor(page)');
  expect(source).toContain('await m.install()');
  const prefetch=source.slice(source.indexOf('export function prefetchPage(page)'),source.indexOf('function recoverStaleModule'));
  expect(prefetch).not.toContain('.install()');
});
