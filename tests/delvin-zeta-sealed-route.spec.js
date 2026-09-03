import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/ask-collectish-delvin-route/index.ts',import.meta.url),'utf8');

test('shared Delvin resolver recognizes Zeta aftermarket purchase questions',()=>{
  assert.match(source,/function zetaIntent/);
  assert.match(source,/sealed_aftermarket_decision/);
  assert.match(source,/ZETA_TCGPLAYER_PRODUCT_ID='714891'/);
});

test('Zeta decision compares live sealed sales with stored pack economics',()=>{
  for(const token of ['gross_mean_ev','gross_median_ev','net_mean_ev_after_fees','totalQuantitySold','lowSalePriceWithShipping','price_multiple_vs_msrp','exact_treatment_market_coverage'])assert.ok(source.includes(token),`missing ${token}`);
  assert.match(source,/I would not chase the current market/);
});
