import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Selling Overview renders before core reads complete',async()=>{
  const source=await read('src/modules/seller/orders.js');
  const start=source.indexOf('async function load({force=false}={})');
  const end=source.indexOf('\n  function install()',start);
  const load=source.slice(start,end);
  expect(load).toContain('summaryLoading=true');
  expect(load).toContain('recentOrdersLoading=true');
  expect(load).toContain('ensureShell();renderRoute({forceProducts:force});');
  expect(load).toContain('await loadCore(force)');
  expect(load.indexOf('renderRoute({forceProducts:force})')).toBeLessThan(load.indexOf('await loadCore(force)'));
  expect(load).not.toContain('Loading Selling summary');
});

test('Selling core reads settle independently instead of one all-or-nothing bundle',async()=>{
  const source=await read('src/modules/seller/orders.js');
  const start=source.indexOf('async function loadCore(force=false)');
  const end=source.indexOf('\n  async function loadProducts',start);
  const core=source.slice(start,end);
  expect(core).toContain('const summaryJob=');
  expect(core).toContain('const ordersJob=');
  expect(core).toContain('const reasonsJob=');
  expect(core).toContain('Promise.allSettled([summaryJob,ordersJob,reasonsJob])');
  expect(core).toContain("summaryStatus:'ready'");
  expect(core).toContain("recentOrdersStatus:'ready'");
  expect(core).toContain("reasonsStatus:'ready'");
  expect(core).not.toContain('const [s,o,r]=await Promise.all');
});

test('Selling dashboard distinguishes loading from real zero and empty states',async()=>{
  const view=await read('src/modules/seller/dashboard-view.js');
  expect(view).toContain('summaryLoading=false');
  expect(view).toContain('recentOrdersLoading=false');
  expect(view).toContain('Loading summary…');
  expect(view).toContain('Loading exceptions…');
  expect(view).toContain('Loading recent orders…');
});

test('Selling refresh forces stable route reads and top products without changing deep report loading',async()=>{
  const source=await read('src/modules/seller/orders.js');
  expect(source).toContain("onclick=()=>load({force:true})");
  expect(source).toContain("rest('seller_dashboard_summary?select=*&limit=1',{force})");
  expect(source).toContain("renderRoute({forceProducts:force})");
  expect(source).toContain("seller_payments?select=");
});
