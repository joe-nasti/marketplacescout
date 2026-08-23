import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
function tokenWithFutureExpiry(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `header.${payload}.sig`;
}

async function seedAuthenticatedApp(page){
  const session={token:tokenWithFutureExpiry(),refresh:'test-refresh',exp:Date.now()+3600_000,user:{id:'perf-user',email:'perf@example.com'}};
  await page.addInitScript(({key,value})=>{
    localStorage.setItem(key,JSON.stringify(value));
    window.__collectishPerf={navigationStart:performance.now(),readyAt:null,lazy:[],adminReady:false,inventoryReady:false};
    document.addEventListener('collectish:ready',()=>{window.__collectishPerf.readyAt=performance.now()});
    document.addEventListener('collectish:lazy-page-loaded',e=>window.__collectishPerf.lazy.push(e.detail));
    document.addEventListener('collectish:admin-modules-ready',()=>{window.__collectishPerf.adminReady=true});
    document.addEventListener('collectish:inventory-modules-ready',()=>{window.__collectishPerf.inventoryReady=true});
  },{key:SESSION_KEY,value:session});
  await page.route('**/rest/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
}

test('authenticated Scout startup stays lean and defers noncritical pages',async({page})=>{
  await seedAuthenticatedApp(page);
  await page.goto('/');
  await expect(page.locator('.collectish-product-shell')).toBeVisible();
  await page.waitForFunction(()=>window.__collectishPerf?.readyAt!=null);

  const startup=await page.evaluate(()=>({
    readyMs:window.__collectishPerf.readyAt-window.__collectishPerf.navigationStart,
    adminReady:window.__collectishPerf.adminReady,
    inventoryReady:window.__collectishPerf.inventoryReady,
    jsResources:performance.getEntriesByType('resource').filter(r=>/\.js(?:$|\?)/.test(r.name)).length
  }));
  expect(startup.readyMs).toBeLessThan(3000);
  expect(startup.adminReady).toBe(false);
  expect(startup.inventoryReady).toBe(false);
  expect(startup.jsResources).toBeLessThan(45);

  await page.locator('[data-cx-page="inventory"]').first().click();
  await page.waitForFunction(()=>window.__collectishPerf?.inventoryReady===true);
  expect(await page.evaluate(()=>window.__collectishPerf.adminReady)).toBe(false);

  await page.locator('[data-cx-page="admin"]').first().click();
  await page.waitForFunction(()=>window.__collectishPerf?.adminReady===true);
  const lazyPages=await page.evaluate(()=>window.__collectishPerf.lazy.map(x=>x.page));
  expect(lazyPages).toContain('inventory');
  expect(lazyPages).toContain('admin');
});
