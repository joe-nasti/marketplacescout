import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function source(path){return fs.readFile(path,'utf8')}

test('Ask speculative prefetch is explicit opt-in and disabled when flag is false',async()=>{
  const config=await source('src/core/config.js');
  const prefetch=await source('src/modules/scout/ask-prefetch.js');
  expect(config).toContain("localStorage.getItem('COLLECTISH_ASK_PREFETCH')==='true'");
  expect(config).toContain("askPrefetchHost.endsWith('.github.io')");
  expect(prefetch).toContain("if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'}");
  expect(prefetch.indexOf("if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'}")).toBeLessThan(prefetch.indexOf('fetch(url'));
});

test('Scout detail opener primes compact Ask context only when enabled',async()=>{
  const nav=await source('src/modules/scout/detail-navigation.js');
  const prefetch=await source('src/modules/scout/ask-prefetch.js');
  expect(nav).toContain("import { prefetchAskCardContext } from './ask-prefetch.js'");
  expect(nav).toContain('void prefetchAskCardContext(summary)');
  expect(prefetch).toContain('name:row.name??row.product_name');
  expect(prefetch).toContain('low:num(');
  expect(prefetch).toContain('direct:num(');
  expect(prefetch).toContain('spread:num(');
  expect(prefetch).toContain('ckBuylist:num(');
  expect(prefetch).toContain("questionType:'prefetch-context'");
  expect(prefetch).toContain('ttlMs');
});

test('closing card detail aborts an in-flight speculative request',async()=>{
  const prefetch=await source('src/modules/scout/ask-prefetch.js');
  expect(prefetch).toContain('const controller=new AbortController()');
  expect(prefetch).toContain('function abortActive(){if(active){active.abort();active=null}}');
  expect(prefetch).toContain("'[data-detail-close],.cx-detail-close,.cx-modal-close,.cx-detail-backdrop,[data-ask-close]'");
  expect(prefetch).toContain("if(e.key==='Escape')abortActive()");
  expect(prefetch).toContain("document.addEventListener('collectish:page-changed',onPage)");
});

test('Admin diagnostics exposes persistent AI speculative prefetch toggle',async()=>{
  const admin=await source('src/modules/ask/admin.js');
  expect(admin).toContain('AI Speculative Prefetch');
  expect(admin).toContain("localStorage.setItem('COLLECTISH_ASK_PREFETCH',next?'true':'false')");
  expect(admin).toContain('window.CollectishAskPrefetch?.abort?.()');
});
