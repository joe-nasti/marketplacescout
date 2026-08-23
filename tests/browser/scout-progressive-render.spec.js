import { test, expect } from '@playwright/test';

const SESSION_KEY='collectishSession';
function token(){const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `h.${payload}.s`}
function row(i){return {sku_id:`sku-${i}`,product_id:String(70000+i),product_name:`Progressive Card ${i}`,set_name:'Render Test',set_code:'rt',collector_number:String(i),printing:'Normal',condition:'Near Mint',language:'English',promoted_score:90-(i%20),promoted_grade:i%20<10?'A':'B',observation_count:100-i,sku_market_price:10+i/10,tcg_low:9+i/10,direct_low:12+i/10,ck_buylist:7+i/10,avg_daily_qty_sold:2,sales_rank:i+1,v5_computed_at:'2026-08-23T20:00:00Z'} }

async function setup(page){
  const session={token:token(),refresh:'render-refresh',exp:Date.now()+3600_000,user:{id:'render-user',email:'render@example.com'}};
  await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:session});
  const rows=Array.from({length:100},(_,i)=>row(i+1));
  let listReads=0;
  await page.route('**/rest/v1/**',route=>{
    const url=new URL(route.request().url());
    const path=url.pathname+url.search;
    if(path.includes('scout_opportunities_v5_cache')&&url.searchParams.get('limit')==='500'){
      listReads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
    }
    if(path.includes('scout_opportunities_v5_cache')&&url.searchParams.get('sku_id')){
      const sku=(url.searchParams.get('sku_id')||'').replace(/^eq\./,'');
      const found=rows.find(x=>x.sku_id===sku)||rows[0];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{...found,thesis_points:60,direct_execution_points:10,buylist_backing_points:5,exit_floor_points:4,confirmation_points:4,cheapest_source:'TCG Low',cheapest_buy:found.tcg_low,direct_net_est:10,direct_net_profit:1,ck_retail:12,manapool_retail:11,cardmarket_retail:10,direct_available:8,direct_listings:2,supply_type:'normal'}])});
    }
    if(path.includes('rpc/'))return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  return ()=>listReads;
}

test('Scout progressively connects cards and expands without ranking refetch',async({page,isMobile})=>{
  const listReads=await setup(page);
  await page.goto('/');
  await expect(page.locator('.cx-scout-card').first()).toContainText('Progressive Card 1');
  await page.waitForFunction(()=>document.getElementById('cxParityCards')?.dataset.progressiveRendered);
  const initial=await page.locator('.cx-scout-card').count();
  expect(initial).toBeLessThanOrEqual(isMobile?32:56);
  expect(initial).toBeGreaterThan(0);
  const before=listReads();
  await page.locator('.cx-scout-progressive-more').click();
  await expect.poll(()=>page.locator('.cx-scout-card').count()).toBeGreaterThan(initial);
  expect(listReads()).toBe(before);
  const later=page.locator('.cx-scout-card').last();
  await later.click();
  await expect(page.locator('#cxParityDetail')).toContainText('Best trade');
});
