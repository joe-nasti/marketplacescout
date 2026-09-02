import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Signals and Selling declare first-use and useful-soon data contracts',async()=>{
  const js=await read('src/state/route-data-contracts.js');
  expect(js).toContain("key:'signals.feed'");
  expect(js).toContain("key:'signals.salesResponse'");
  expect(js).toContain("key:'seller.dashboardSummary'");
  expect(js).toContain("key:'seller.recentOrders'");
  expect(js).toContain("key:'seller.refundReasons'");
  expect(js).toContain("key:'seller.topProducts'");
  expect(js).toContain("role:'firstUse'");
  expect(js).toContain("role:'usefulSoon'");
});

test('SYP first use includes read-only stats options and default eligible page',async()=>{
  const js=await read('src/state/route-data-contracts.js');
  expect(js).toContain("key:'syp.dashboardStats'");
  expect(js).toContain("path:'rpc/syp_dashboard_stats'");
  expect(js).toContain("key:'syp.filterOptions'");
  expect(js).toContain("path:'rpc/syp_filter_options_rpc'");
  expect(js).toContain("method:'POST'");
  expect(js).toContain("key:'syp.eligibleFirstPage'");
  expect(js).toContain('order=last_seen.desc&limit=100&offset=0');
});

test('deep Selling report reads stay interaction-driven',async()=>{
  const js=await read('src/state/route-data-contracts.js');
  expect(js).not.toContain('seller_payments?select=');
  expect(js).not.toContain('seller_payment_orders?select=');
  expect(js).not.toContain('reimbursement_invoices?select=');
  expect(js).not.toContain('ri_discrepancies?select=');
  expect(js).not.toContain('seller_reviews?select=');
});

test('REST reuses named route resources without recursive cache wrapping',async()=>{
  const rest=await read('src/core/rest.js');
  expect(rest).toContain("import { loadResource, getResource } from '../state/resources.js'");
  expect(rest).toContain('resourceContractForRequest(path,options)');
  expect(rest).toContain("!options.__routeResource");
  expect(rest).toContain("__routeResource:true");
  expect(rest).toContain('loadResource(contract.key');
});

test('contract cache reuses fresh data until an explicit refresh',async()=>{
  const rest=await read('src/core/rest.js');
  expect(rest).not.toContain('contractReads');
  expect(rest).toContain('force:Boolean(options.force)');
});

test('route contracts never leave visible owners on silently stale SWR data',async()=>{
  const [contracts,rest]=await Promise.all([
    read('src/state/route-data-contracts.js'),
    read('src/core/rest.js')
  ]);
  expect(contracts).toContain('staleWhileRevalidate:false');
  expect(contracts).toContain('fallbackToStaleOnError:true');
  expect(rest).toContain('staleWhileRevalidate:contract.staleWhileRevalidate!==false');
  expect(rest).toContain('contract.fallbackToStaleOnError&&stale?.data!=null');
  expect(rest).toContain("bump('route_data_stale_fallbacks'");
});

test('request contracts can safely identify explicit idempotent POST reads',async()=>{
  const contracts=await read('src/state/route-data-contracts.js');
  expect(contracts).toContain('requestSignature');
  expect(contracts).toContain('stableBody');
  expect(contracts).toContain('resourceContractForRequest');
  expect(contracts).toContain("options.method||'GET'");
});

test('navigation cache hydration is derived from route contracts',async()=>{
  const lazy=await read('src/core/lazy-pages.js');
  expect(lazy).toContain("import { primeSpecsForRoute } from '../state/route-data-contracts.js'");
  expect(lazy).toContain('const prime=primeSpecsForRoute(page)');
  expect(lazy).not.toContain("const routePrime=");
});
