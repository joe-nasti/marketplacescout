import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Scout persists decision-relevant view and only explicit selected SKU in the URL',async()=>{
  const state=await read('src/modules/scout/route-state.js');
  const index=await read('src/modules/scout/index.js');
  expect(state).toContain("new Set(['top','quick','buylist','velocity'])");
  expect(state).toContain("p.set('view',view)");
  expect(state).toContain("if(sku&&view!=='quick')p.set('sku',sku)");
  expect(state).toContain('rememberExplicitSku');
  expect(state).toContain("document.addEventListener('click',explicitClick,true)");
  expect(state).toContain('renderer.setSaved(view)');
  expect(state).toContain("CollectishScoutDetailNavigation?.open?.({sku_id:sku})");
  expect(state).not.toContain('filterOpen');
  expect(index).toContain("import('./route-state.js')");
});

test('Scout renderer-default selection does not become an explicit mobile deep link',async()=>{
  const state=await read('src/modules/scout/route-state.js');
  const subscribe=state.slice(state.indexOf('store.subscribe('),state.indexOf('if(store.get().scout?.status'));
  expect(subscribe).toContain("s.scout?.savedView");
  expect(subscribe).not.toContain('selectedSku');
  expect(state).toContain("explicitSku=sku");
});

test('Selling persists Overview/Reports mode and report tab without persisting transient search state',async()=>{
  const state=await read('src/modules/seller/route-state.js');
  expect(state).toContain("new Set(['dashboard','reports'])");
  expect(state).toContain("new Set(['overview','orders','products','refunds','reviews','payments','ris'])");
  expect(state).toContain("p.set('sell','reports')");
  expect(state).toContain("p.set('report',tab)");
  expect(state).toContain('CollectishSeller.setMode(mode,tab)');
  expect(state).not.toContain('cxSellerOrderSearch');
  expect(state).not.toContain('cxSellerProductSearch');
});

test('Selling drill-ins are deterministic and install with the route owner',async()=>{
  const nav=await read('src/modules/seller/drill-navigation.js');
  const index=await read('src/modules/seller/index.js');
  expect(nav).toContain("await window.CollectishSeller?.setMode?.('reports','orders')");
  expect(nav).toContain("await window.CollectishSeller?.setMode?.('reports','products')");
  expect(nav).toContain("queueMicrotask(()=>focusQuery('cxSellerOrderSearch',order))");
  expect(nav).toContain("queueMicrotask(()=>focusQuery('cxSellerProductSearch',name))");
  expect(nav).not.toContain('setTimeout');
  expect(index.indexOf("import('./drill-navigation.js')")).toBeGreaterThan(index.indexOf("import('./orders.js')"));
  expect(index.indexOf("import('./drill-navigation.js')")).toBeLessThan(index.indexOf("collectish:seller-core-ready"));
});
