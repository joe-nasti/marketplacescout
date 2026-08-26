import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('lazy routes prefetch code and known caches without installing the page',async()=>{
  const source=await read('src/core/lazy-pages.js');
  expect(source).toContain('export function prefetchPage(page)');
  expect(source).toContain('const pageModules=');
  expect(source).toContain("{key:'sealed.rows'");
  expect(source).toContain("{key:'sealed.setTypes'");
  expect(source).toContain('primeResources(routePrime[page])');
  expect(source).toContain("m.install()");
});

test('lazy loading no longer paints a generic page-wide placeholder',async()=>{
  const source=await read('src/core/lazy-pages.js');
  expect(source).toContain("h.dataset.cxLazyStatus=isLoading?'loading':'ready'");
  expect(source).toContain("h.setAttribute('aria-busy','true')");
  expect(source).not.toContain('Preparing ${title(page)} data');
  expect(source).not.toContain('data-cx-lazy-placeholder');
});

test('navigation intent warms lazy destinations before click',async()=>{
  const source=await read('src/core/shell.js');
  expect(source).toContain('function prefetchIntent(event)');
  expect(source).toContain('CollectishLazyDataPages?.prefetch?.(page)');
  expect(source).toContain("document.addEventListener('pointerover',prefetchIntent,true)");
  expect(source).toContain("document.addEventListener('focusin',prefetchIntent,true)");
  expect(source).toContain("document.addEventListener('pointerdown',prefetchIntent,true)");
});
