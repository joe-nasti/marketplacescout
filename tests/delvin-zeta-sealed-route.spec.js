import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/ask-collectish-delvin-route/index.ts',import.meta.url),'utf8');
const discord=readFileSync(new URL('../cloud-worker/discord-shared-delvin-route.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('../cloud-worker/discord-ask-entry-v30.mjs',import.meta.url),'utf8');
const surfaces=readFileSync(new URL('../src/modules/ask/structured-surfaces.js',import.meta.url),'utf8');
const presenter=readFileSync(new URL('../supabase/functions/ask-collectish-delvin-present/index.ts',import.meta.url),'utf8');

test('shared Delvin resolver recognizes Zeta aftermarket purchase questions',()=>{
  assert.match(source,/function zetaIntent/);
  assert.match(source,/sealed_aftermarket_decision/);
  assert.match(source,/ZETA_TCGPLAYER_PRODUCT_ID='714891'/);
});

test('Zeta decision compares live sealed sales with stored pack economics',()=>{
  for(const token of ['gross_mean_ev','gross_median_ev','net_mean_ev_after_fees','totalQuantitySold','lowSalePriceWithShipping','price_multiple_vs_msrp','exact_treatment_market_coverage'])assert.ok(source.includes(token),`missing ${token}`);
  assert.match(source,/Do not chase at current pricing/);
  assert.match(source,/release_date:releases\?\.\[0\]\?\.sale_start_at/);
  assert.match(source,/ZETA_MARKET_CACHE_MS=10\*60\*1000/);
  assert.match(source,/if\(zetaMarketInFlight\)return zetaMarketInFlight/);
});

test('Discord defers Zeta analysis to the queue instead of blocking acknowledgement',()=>{
  assert.match(discord,/if\(isQueuedSharedQuestion\(q\)\)return null/);
  assert.match(discord,/deliverQueuedSharedQuestion/);
  assert.match(entry,/if\(!isQueuedSharedQuestion\(job\.question\)\)/);
  assert.match(entry,/deliverQueuedSharedQuestion\(env,job,message\)/);
});

test('web Ask and Discord render the canonical Zeta decision payload',()=>{
  assert.match(source,/type:'sealed_purchase_decision'/);
  assert.match(source,/image_url:imageUrl/);
  assert.match(source,/surfaces:\[surface\]/);
  assert.match(discord,/canonical=surface\?\.response\|\|d\.response/);
  assert.match(discord,/thumbnail:\{url:surface\.image_url\}/);
  assert.match(surfaces,/function sealedPurchaseDecision/);
  for(const token of ['action','units_sold','transactions','price_multiple_vs_msrp','why','changes','buy_zone','recheck'])assert.ok(source.includes(token),`missing scorecard ${token}`);
  assert.match(discord,/name:'Market activity'/);
  assert.match(discord,/name:`Why \$\{surface\.verdict\}`/);
  assert.match(discord,/name:'Buy zone'/);
  assert.match(discord,/name:'Buy zone',value:surface\.buy_zone,inline:false/);
  assert.match(discord,/name:'Recheck',value:surface\.recheck,inline:false/);
  assert.match(surfaces,/cx-ask-buy-zone/);
  assert.match(surfaces,/cx-ask-recheck/);
  assert.match(surfaces,/surface\.release_date/);
  assert.match(presenter,/label:'Modeled EV'/);
  assert.match(presenter,/label:'MSRP'.*release/);
  assert.doesNotMatch(presenter,/\['Gross EV',s\.gross_mean_ev/);
  assert.match(presenter,/heading:'Buy zone',kind:'text'/);
  assert.match(presenter,/heading:'Recheck',kind:'text'/);
  assert.match(discord,/section\.kind==='text'/);
});
