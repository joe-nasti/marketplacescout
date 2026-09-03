import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const read=file=>readFile(path.join(process.cwd(),file),'utf8');

test('Scout paints a day-old cache and revalidates it in the background',async()=>{
  const cache=await read('src/modules/scout/cache-read.js');
  expect(cache).toContain('const PERSISTED_FRESH_MS=5*60*1000');
  expect(cache).toContain('const PERSISTED_MAX_STALE_MS=24*60*60*1000');
  expect(cache).toContain('stale:age>PERSISTED_FRESH_MS');
  expect(cache).toContain("setTimeout(()=>void expandScoutRankings(options,{forceApply:true}),0)");
  expect(cache).toContain('scout_background_refreshed:Boolean(settings.forceApply)');
});

test('Scout identifies cached first paint until live rankings replace it',async()=>{
  const renderer=await read('src/modules/scout/renderer.js');
  expect(renderer).toContain("cached?'Cached snapshot · ':'");
  expect(renderer).toContain("freshness.id='cxScoutDataFreshness'");
  expect(renderer).toContain('freshness.textContent=freshnessCopy()');
  expect(renderer).toContain("!event.detail?.refreshed&&expanded.length<=rows.length");
});

test('stale Scout cards paint before delayed live rankings',async({page})=>{
  const tokenPayload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const cached={sku_id:'cached-sku',product_id:'1',product_name:'Cached Opportunity',set_name:'Cached Set',printing:'Normal',condition:'Near Mint',language:'English',promoted_score:80,promoted_grade:'A',observation_count:4,v5_computed_at:'2026-09-01T10:00:00Z'};
  const live={...cached,sku_id:'live-sku',product_id:'2',product_name:'Live Opportunity',v5_computed_at:'2026-09-01T14:00:00Z'};
  await page.addInitScript(async({session,row})=>{
    localStorage.setItem('collectishSession',JSON.stringify(session));
    await new Promise(resolve=>{
      const request=indexedDB.open('collectish-cache',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('resources',{keyPath:'key'});
      request.onsuccess=()=>{
        const tx=request.result.transaction('resources','readwrite');
        tx.objectStore('resources').put({key:'user:stale-user:scout.rows.actionability-v1',data:[row],fetchedAt:Date.now()-10*60*1000,version:1});
        tx.oncomplete=resolve;tx.onerror=resolve;
      };
      request.onerror=resolve;
    });
  },{session:{token:`header.${tokenPayload}.sig`,refresh:'refresh',exp:Date.now()+3600000,user:{id:'stale-user'}},row:cached});
  await page.route('**/rest/v1/**',async route=>{
    if(route.request().url().includes('scout_opportunities_actionability_ranked')){
      await new Promise(resolve=>setTimeout(resolve,2500));
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([live])});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  await page.goto('/');
  await expect(page.locator('.cx-scout-card')).toContainText('Cached Opportunity',{timeout:1500});
  await expect(page.locator('#cxScoutDataFreshness')).toContainText('Cached snapshot');
  await expect(page.locator('.cx-scout-card')).toContainText('Live Opportunity',{timeout:6000});
  await expect(page.locator('#cxScoutDataFreshness')).not.toContainText('Cached snapshot');
});
