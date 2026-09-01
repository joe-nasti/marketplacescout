import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function source(path){return fs.readFile(path,'utf8')}

test('Ask speculative prefetch is explicit opt-in and disabled when flag is false',async()=>{
  const config=await source('src/core/config.js');
  const core=await source('src/modules/ask/prefetch.js');
  expect(config).toContain("localStorage.getItem('COLLECTISH_ASK_PREFETCH')==='true'");
  expect(config).toContain("askPrefetchHost.endsWith('.github.io')");
  expect(core).toContain("if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'}");
  expect(core.indexOf("if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'}")).toBeLessThan(core.indexOf('fetch(url'));
});

test('Scout detail opener primes compact Ask context through canonical core',async()=>{
  const nav=await source('src/modules/scout/detail-navigation.js');
  const adapter=await source('src/modules/scout/ask-prefetch.js');
  const core=await source('src/modules/ask/prefetch.js');
  expect(nav).toContain("import { prefetchAskCardContext } from './ask-prefetch.js'");
  expect(nav).toContain('void renderer.prefetchCard?.(row)');
  expect(nav).toContain('void prefetchAskCardContext(row)');
  expect(adapter).toContain("import { prefetchAskContext, abortAskPrefetch } from '../ask/prefetch.js'");
  expect(adapter).toContain('name:row.name??row.product_name');
  expect(adapter).toContain('low:num(');
  expect(adapter).toContain('direct:num(');
  expect(adapter).toContain('spread:num(');
  expect(adapter).toContain('ckBuylist:num(');
  expect(adapter).toContain("scope:'scout'");
  expect(core).toContain("questionType:'prefetch-context'");
  expect(core).toContain('ASK_PREFETCH_CONFIG.ttlMs');
});

test('canonical prefetch core owns AbortController cancellation',async()=>{
  const core=await source('src/modules/ask/prefetch.js');
  expect(core).toContain('const controller=new AbortController()');
  expect(core).toContain('active.abort();active=null');
  expect(core).toContain('export function abortAskPrefetch()');
});

test('Sealed detail open primes expected compact snapshot when enabled',async()=>{
  const sealed=await source('src/modules/sealed/detail-focus.js');
  expect(sealed).toContain("import { prefetchAskContext, abortAskPrefetch } from '../ask/prefetch.js'");
  expect(sealed).toContain('if(!ASK_PREFETCH_CONFIG.enabled)return;');
  expect(sealed).toContain('name:product.name??product.product_name??null');
  expect(sealed).toContain('acquisition:num(product.sealedBuy??product.sealed_acquisition_price??product.price)');
  expect(sealed).toContain('marketEV:num(product.marketEV??product.tcg_market_ev)');
  expect(sealed).toContain('spread:num(product.marketSpread??product.market_spread??product.spreadPercent)');
  expect(sealed).toContain('ckBuylistFloor:num(product.ckBuylistFloor??product.cardkingdom_buylist_ev??product.ckBuylist)');
  expect(sealed).toContain("scope:'sealed'");
  expect(sealed).toContain("context:{screen:'sealed'");
  expect(sealed).toContain("const product=event.detail?.row||{};prefetch(product)");
});

test('Sealed detail dismissal, product switches, Escape and page leave abort prefetch',async()=>{
  const sealed=await source('src/modules/sealed/detail-focus.js');
  expect(sealed).toContain('function close(){abortAskPrefetch();');
  expect(sealed).toContain("if(event.target.closest?.('#cxSealedRows [data-deck]')){abortAskPrefetch();pendingOpen=true}");
  expect(sealed).toContain("function onKey(event){if(event.key==='Escape')close()}");
  expect(sealed).toContain("onPage(page){if(page!=='sealed')close()}");
});

test('Admin diagnostics exposes persistent AI speculative prefetch toggle',async()=>{
  const admin=await source('src/modules/ask/admin.js');
  expect(admin).toContain('AI Speculative Prefetch');
  expect(admin).toContain("localStorage.setItem('COLLECTISH_ASK_PREFETCH',next?'true':'false')");
  expect(admin).toContain('window.CollectishAskPrefetch?.abort?.()');
});
