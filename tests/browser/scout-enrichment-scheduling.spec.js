import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
const enrichmentMarkers=[
  'scout_sku_volatility',
  'scout_opportunities_24h',
  'rpc/liquid_scout_opportunities',
  'rpc/scout_position_sizing',
  'rpc/scout_portfolio_allocation'
];

function tokenWithFutureExpiry(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `header.${payload}.sig`;
}

async function seedSession(page){
  const session={token:tokenWithFutureExpiry(),refresh:'test-refresh',exp:Date.now()+3600_000,user:{id:'enrichment-perf-user',email:'enrichment@example.com'}};
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:session});
}

test('Scout RPC enrichers wait until after first render',async({page})=>{
  await seedSession(page);
  const enrichmentReads=[];
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(enrichmentMarkers.some(marker=>url.includes(marker)))enrichmentReads.push({url,at:Date.now()});
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.route('**/functions/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));

  await page.goto('/');
  await expect(page.locator('.collectish-product-shell')).toBeVisible();
  await page.waitForFunction(()=>document.getElementById('cxScout')?.dataset.scoutV5==='promoted');

  await page.waitForTimeout(250);
  expect(enrichmentReads).toHaveLength(0);

  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(r=>/volatility|position-sizing|portfolio-allocation|quick-turn|noise-filter/.test(r.name)),null,{timeout:5000});
  await page.waitForTimeout(250);
  expect(enrichmentReads.length).toBeGreaterThan(0);
});
