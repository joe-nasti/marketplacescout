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
  expect(rest).toContain("import { loadResource } from '../state/resources.js'");
  expect(rest).toContain("resourceContractForPath(path)");
  expect(rest).toContain("!options.__routeResource");
  expect(rest).toContain("__routeResource:true");
  expect(rest).toContain('loadResource(contract.key');
  expect(rest).toContain('staleWhileRevalidate:true');
});

test('navigation cache hydration is derived from route contracts',async()=>{
  const lazy=await read('src/core/lazy-pages.js');
  expect(lazy).toContain("import { primeSpecsForRoute } from '../state/route-data-contracts.js'");
  expect(lazy).toContain('const prime=primeSpecsForRoute(page)');
  expect(lazy).not.toContain("const routePrime=");
});
