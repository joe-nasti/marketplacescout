import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');

test('Discord card links use Scout-addressable URL parameters',()=>{
  const discord=read('cloud-worker/discord-structured-output.mjs');
  expect(discord).toContain("p.set('product',String(x.product_id))");
  expect(discord).toContain("p.set('card',String(x.card_name))");
  expect(discord).toContain("?sku=${encodeURIComponent(sku)}");
});

test('top-level router gives Scout deep-link parameters precedence over stale tabs',()=>{
  const urlState=read('src/core/url-state.js');
  expect(urlState).toContain("const SCOUT_DEEP_LINK_KEYS=['sku','product','card','fromCard','view','finish']");
  expect(urlState).toContain("const tab=hasScoutDeepLink(p)?'scout':requestedTab||'scout'");
});

test('Scout route state consumes both exact SKU and lookup deep links',()=>{
  const route=read('src/modules/scout/route-state.js');
  expect(route).toContain("sku:p.get('sku')||''");
  expect(route).toContain("product_id:p.get('product')||''");
  expect(route).toContain("card_name:p.get('card')||''");
  expect(route).toContain("window.CollectishScoutDetailNavigation?.open?.({sku_id:sku");
  expect(route).toContain("source:'signals-discord-deep-link'");
});

test('exact-SKU deep links wait until the Scout detail surface exists',()=>{
  const bootstrap=read('src/modules/scout/bootstrap.js');
  const navigation=read('src/modules/scout/detail-navigation.js');
  expect(bootstrap).toContain("document.getElementById('cxParityDetail')");
  expect(bootstrap).toContain("document.addEventListener('collectish:scout-v5-ready',open,{once:true})");
  expect(navigation).toContain("if(!document.getElementById('cxParityDetail'))return false");
});
