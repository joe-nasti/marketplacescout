import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
function tokenWithFutureExpiry(){
  const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `header.${payload}.sig`;
}

const scoutRow={
  sku_id:'perf-sku-1',product_id:'12345',product_name:'Performance Test Card',set_name:'Performance Set',set_code:'tst',collector_number:'1',scryfall_id:'00000000-0000-0000-0000-000000000001',printing:'Normal',condition:'Near Mint',language:'English',promoted_score:88,promoted_grade:'A',observation_count:10,sku_market_price:10,tcg_low:9,direct_low:12,ck_buylist:7,direct_backed:false,near_direct_backed:false,buylist_backed:false,source_verify:false,sales_rank:25,avg_daily_qty_sold:2.5,v5_computed_at:'2026-08-23T20:00:00Z'
};
const detailRow={...scoutRow,thesis_points:62,direct_execution_points:8,buylist_backing_points:4,exit_floor_points:4,confirmation_points:4,cheapest_source:'TCG Low',cheapest_buy:9,direct_net_est:9.5,direct_net_profit:.5,buylist_spread:-2,buylist_roi_pct:-22,buylist_to_direct_pct:58,ck_retail:11,manapool_retail:10.5,cardmarket_retail:8.5,direct_available:5,direct_listings:2,supply_type:'normal',base_score_24h:82,demand_adjustment:3,trend_adjustment:1,edhrec_rank:100};

async function seedSession(page){
  const session={token:tokenWithFutureExpiry(),refresh:'test-refresh',exp:Date.now()+3600_000,user:{id:'cache-perf-user',email:'cache@example.com'}};
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:session});
}

async function waitForPersistedScoutCache(page){
  await expect.poll(()=>page.evaluate(()=>new Promise(resolve=>{
    const request=indexedDB.open('collectish-cache',1);
    request.onerror=()=>resolve(false);
    request.onblocked=()=>resolve(false);
    request.onsuccess=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('resources')){db.close();resolve(false);return}
      const tx=db.transaction('resources','readonly');
      const get=tx.objectStore('resources').get('user:cache-perf-user:scout.rows');
      get.onerror=()=>{db.close();resolve(false)};
      get.onsuccess=()=>{const ready=Array.isArray(get.result?.data)&&get.result.data.length>0;db.close();resolve(ready)};
    };
  })),{timeout:5000}).toBe(true);
}

function scoutRequest(url){
  const u=new URL(url);const table=u.pathname.split('/').pop();
  return {u,table,select:u.searchParams.get('select')||'',sku:u.searchParams.get('sku_id')||''};
}

async function fulfillScout(route,counts){
  const req=scoutRequest(route.request().url());
  if(req.table==='scout_opportunities_v5_cache'||req.table==='scout_opportunities_v5'){
    if(req.select==='v5_computed_at')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{v5_computed_at:scoutRow.v5_computed_at}])});
    if(req.select==='*'){
      counts.detail++;
      counts.detailUrls.push(route.request().url());
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([detailRow])});
    }
    counts.list++;
    counts.listUrls.push(route.request().url());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([scoutRow])});
  }
  return route.fulfill({status:200,contentType:'application/json',body:'[]'});
}

test('Scout cold start uses lightweight list fields and one-row detail fetch',async({page})=>{
  await seedSession(page);
  const counts={list:0,detail:0,listUrls:[],detailUrls:[]};
  await page.route('**/rest/v1/**',route=>fulfillScout(route,counts));
  await page.route('https://api.scryfall.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:scoutRow.product_name,image_uris:{normal:'https://example.test/card.jpg'}})}));

  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  await expect(page.locator('#cxParityDetail')).toContainText('Best trade');

  expect(counts.list).toBeGreaterThan(0);
  expect(counts.detail).toBe(1);
  const listSelect=new URL(counts.listUrls[0]).searchParams.get('select');
  expect(listSelect).not.toBe('*');
  expect(listSelect).toContain('sku_id');
  expect(listSelect).toContain('promoted_score');
  expect(listSelect).not.toContain('thesis_points');
  const detailUrl=new URL(counts.detailUrls[0]);
  expect(detailUrl.searchParams.get('select')).toBe('*');
  expect(detailUrl.searchParams.get('sku_id')).toBe('eq.perf-sku-1');
});

test('recent persisted Scout rankings provide a warm list without Scout list REST',async({page})=>{
  await seedSession(page);
  let counts={list:0,detail:0,listUrls:[],detailUrls:[]};
  await page.route('**/rest/v1/**',route=>fulfillScout(route,counts));
  await page.route('https://api.scryfall.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:scoutRow.product_name})}));

  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  expect(counts.list).toBeGreaterThan(0);
  await waitForPersistedScoutCache(page);

  counts={list:0,detail:0,listUrls:[],detailUrls:[]};
  await page.reload();
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  const metrics=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('collectishRuntimeHealth')||'{}'));
  expect(counts.list,JSON.stringify({listUrls:counts.listUrls,scoutPersistedUsed:metrics.scout_persisted_used,scoutPersistedSource:metrics.scout_persisted_source,scoutPersistedAgeMs:metrics.scout_persisted_age_ms,scoutCacheUsed:metrics.scout_cache_used,scoutCacheFallback:metrics.scout_cache_fallback})).toBe(0);
  expect(metrics.scout_persisted_used).toBe(true);
});

test('Scout health probes do not compete with initial render',async({page})=>{
  await seedSession(page);
  const healthReads=[];const counts={list:0,detail:0,listUrls:[],detailUrls:[]};
  await page.route('**/rest/v1/**',route=>{
    const url=route.request().url();
    if(url.includes('select=v5_computed_at')||url.includes('mtgjson_sync_state?'))healthReads.push(url);
    return fulfillScout(route,counts);
  });
  await page.route('https://api.scryfall.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:scoutRow.product_name})}));

  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Performance Test Card');
  await page.waitForTimeout(1500);
  expect(healthReads).toHaveLength(0);
});