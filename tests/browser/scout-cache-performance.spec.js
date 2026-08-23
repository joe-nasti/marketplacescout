import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
function tokenWithFutureExpiry(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `header.${payload}.sig`;
}

const scoutRow={
  sku_id:'perf-sku-1',
  product_id:'12345',
  product_name:'Performance Test Card',
  set_name:'Performance Set',
  set_code:'tst',
  collector_number:'1',
  printing:'Normal',
  condition:'Near Mint',
  language:'English',
  promoted_score:88,
  promoted_grade:'A',
  observation_count:10,
  sku_market_price:10,
  tcg_low:9,
  direct_low:12,
  ck_buylist:7,
  v5_computed_at:'2026-08-23T20:00:00Z'
};

async function seedSession(page){
  const session={token:tokenWithFutureExpiry(),refresh:'test-refresh',exp:Date.now()+3600_000,user:{id:'cache-perf-user',email:'cache@example.com'}};
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:session});
}

test('recent persisted Scout rankings provide a warm start without Scout REST',async({page})=>{
  await seedSession(page);
  let scoutNetworkReads=0;
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(url.includes('scout_opportunities_v5_cache')){
      scoutNetworkReads++;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([scoutRow])});
    }
    if(url.includes('scout_opportunities_v5?')){
      scoutNetworkReads++;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([scoutRow])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });

  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  expect(scoutNetworkReads).toBeGreaterThan(0);
  await page.waitForTimeout(250);

  scoutNetworkReads=0;
  await page.unroute('**/rest/v1/**');
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(url.includes('scout_opportunities_v5')){
      scoutNetworkReads++;
      return route.abort('failed');
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });

  await page.reload();
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  expect(scoutNetworkReads).toBe(0);
  const metrics=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('collectishRuntimeHealth')||'{}'));
  expect(metrics.scout_persisted_used).toBe(true);
});

test('Scout health probes do not compete with initial render',async({page})=>{
  await seedSession(page);
  const healthReads=[];
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(url.includes('scout_opportunities_v5_cache?select=v5_computed_at')||url.includes('mtgjson_sync_state?'))healthReads.push(url);
    if(url.includes('scout_opportunities_v5_cache?select=*'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([scoutRow])});
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });

  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  await page.waitForTimeout(1500);
  expect(healthReads).toHaveLength(0);
});
