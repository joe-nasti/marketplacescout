import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('lazy routes prefetch code and known caches without installing the page',async()=>{
  const [lazy,contracts]=await Promise.all([
    read('src/core/lazy-pages.js'),
    read('src/state/route-data-contracts.js')
  ]);
  expect(lazy).toContain('export function prefetchPage(page)');
  expect(lazy).toContain('const pageModules=');
  expect(lazy).toContain('primeSpecsForRoute(page)');
  expect(lazy).toContain('primeResources(prime)');
  expect(contracts).toContain("key:'sealed.rows'");
  expect(contracts).toContain("key:'sealed.setTypes'");
  expect(lazy).toContain("await m.install()");
  expect(lazy.indexOf('await m.install()')).toBeGreaterThan(lazy.indexOf('export async function loadPage(page)'));
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
