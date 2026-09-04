import{test,expect}from'@playwright/test';
import{readFile}from'node:fs/promises';

test('sealed TCGCSV backfill is selective and storage bounded',async()=>{
  const worker=await readFile('cloud-worker/tcgcsv-sealed-history-backfill.mjs','utf8');
  expect(worker).toContain("category=eq.booster_box&subtype=eq.collector");
  expect(worker).toContain('TCGCSV_HISTORY_MAX_ARCHIVES');
  expect(worker).toContain('TCGCSV_HISTORY_STRIDE_DAYS');
  expect(worker).toContain('sealed_product_market_history');
  expect(worker).toContain('sealed_ev_backtest_pool_items');
  expect(worker).toContain('modeled_booster_card_price_history');
  expect(worker).toContain('modeled_booster_card_archive_imports');
  expect(worker).toContain("category=eq.booster_pack&subtype=eq.play");
  expect(worker).toContain('magic_set_catalog?select=code,tcgplayer_group_id');
  expect(worker).toContain("CARD_SCOPE_VERSION='play-booster-sets-v2'");
  expect(worker).toContain('x.detail?.scopeVersion===CARD_SCOPE_VERSION');
  expect(worker).toContain("rpc/refresh_modeled_booster_ev_calibration");
  expect(worker).toContain("rpc/refresh_modeled_play_booster_similarity_forecasts");
  expect(worker).not.toContain('high_price:num');
});

test('stabilized EV readiness requires independent release cohorts',async()=>{
  const sql=await readFile('supabase/migrations/20260903210000_require_release_cohorts_for_stabilized_ev.sql','utf8');
  expect(sql).toContain('covered_play_sets>=4');
  expect(sql).toContain('mature_release_cohorts>=3');
  expect(sql).toContain('first_observation<=release_date+14');
  expect(sql).toContain('last_observation>=release_date+60');
  expect(sql).toContain('never used as executable EV');
});

test('modeled card history is private, bounded, and calibration gated',async()=>{
  const sql=await readFile('supabase/migrations/20260903203000_add_modeled_booster_card_history.sql','utf8');
  expect(sql).toContain('primary key(product_id,sub_type_name,observed_on)');
  expect(sql).toContain('revoke all on public.modeled_booster_card_price_history from public,anon,authenticated');
  expect(sql).toContain("then 'CALIBRATION_READY' else 'BUILDING_HISTORY'");
  expect(sql).toContain('never used as executable EV');
});

test('collector-box lifecycle keeps price and demand provenance separate',async()=>{
  const sql=await readFile('supabase/migrations/20260903040000_add_compact_sealed_market_history.sql','utf8');
  const worker=await readFile('cloud-worker/tcgcsv-sealed-history-backfill.mjs','utf8');
  expect(worker).toContain("source:'tcgcsv_archive'");
  expect(sql).toContain('marketplace_sku_sales_buckets');
  expect(sql).toContain('change_365d_pct');
  expect(sql).toContain('recent TCGplayer items sold');
  expect(sql).toContain('security_invoker=true');
  expect(sql).toContain('enable row level security');
});
