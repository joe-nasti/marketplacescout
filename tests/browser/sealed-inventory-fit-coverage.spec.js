import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('sealed inventory-fit refresh uses resolved exact SKUs and complete product scans',async()=>{
  const migration=await readFile('supabase/migrations/20260904163959_expand_sealed_inventory_fit_exact_sku_coverage.sql','utf8');
  const membership=await readFile('supabase/migrations/20260904164315_preserve_sealed_inventory_fit_target_membership.sql','utf8');
  const worker=await readFile('cloud-worker/refresh-precon-direct.mjs','utf8');
  expect(migration).toContain('sealed_inventory_fit_component_targets');
  expect(migration).toContain('mtgjson_tcgplayer_skus');
  expect(migration).toContain('tcgplayer_official_component_price_candidates');
  expect(membership).toContain('distinct on (user_id, sealed_uuid, sku_id)');
  expect(worker).toContain('sealed_inventory_fit_component_targets?select=');
  expect(worker).toContain('select=user_id,sku_id,product_id');
  expect(worker).toContain("filter(r=>String(r.user_id)===String(u.user_id))");
  expect(worker).toContain('offset+=1000');
  expect(worker).toContain('&limit=1000&offset=${offset}');
  expect(worker).toContain('all(`precon_card_ev_current?select=');
  expect(worker).toContain('_sealed_inventory_fit:true');
  expect(worker).toContain("rpc/refresh_sealed_inventory_fit_direct_observations");
  expect(worker).toContain('/v1/product/${encodeURIComponent(productId)}/listings');
  expect(worker).toContain("Origin:'https://www.tcgplayer.com'");
  expect(worker).toContain("Referer:'https://www.tcgplayer.com/'");
  expect(worker).toContain("'User-Agent':'Mozilla/5.0");
  expect(worker).toContain("coverage:'COMPLETE'");
  expect(worker).toContain('direct_available:x.direct_available');
  expect(worker).toContain('failureSamples:failures');
  expect(worker).not.toContain('directQuantitiesAtPrice');
});

test('complete Direct scans hydrate the inventory-fit component cache',async()=>{
  const sql=await readFile('supabase/migrations/20260904200411_refresh_sealed_inventory_fit_direct_observations.sql','utf8');
  const bounded=await readFile('supabase/migrations/20260904203400_bound_sealed_direct_observation_refresh.sql','utf8');
  const timeout=await readFile('supabase/migrations/20260904203800_configure_sealed_direct_refresh_timeout.sql','utf8');
  expect(sql).toContain("r.raw_json->>'coverage' = 'COMPLETE'");
  expect(sql).toContain('direct_available_current = l.direct_available');
  expect(sql).toContain("'direct_observed_zero'");
  expect(sql).toContain('security invoker');
  expect(sql).toContain('grant execute on function public.refresh_sealed_inventory_fit_direct_observations() to service_role');
  expect(bounded).toContain("where set_slug = 'sealed-precon-direct-refresh'");
  expect(bounded).toContain('r.scan_id = s.scan_id');
  expect(bounded).toContain('c.direct_observed_at is distinct from l.captured_at');
  expect(timeout).toContain("set statement_timeout = '60s'");
});

test('Direct worker changes trigger an immediate production refresh',async()=>{
  const workflow=await readFile('.github/workflows/mtgjson-sync.yml','utf8');
  expect(workflow).toContain('refresh-sealed-direct-on-push:');
  expect(workflow).toContain('Refresh sealed and precon exact-SKU Direct observations');
  expect(workflow).toContain('node cloud-worker/refresh-precon-direct.mjs');
  expect(workflow).toMatch(/Refresh sealed and precon exact-SKU Direct observations[\s\S]*?node cloud-worker\/refresh-precon-direct\.mjs[\s\S]*?Recalculate sealed and precon EV with fresh Direct data[\s\S]*?node cloud-worker\/refresh-precon-ev\.mjs/);
  expect(workflow).toContain('node cloud-worker/backfill-sealed-component-history.mjs');
  expect(workflow).toContain('PRECON_RELEASE_FROM: "2024-01-01"');
  expect(workflow).toMatch(/Backfill targeted sealed component quarter history[\s\S]*?continue-on-error: true/);
});

test('quarter history backfill is exact-SKU and provenance preserving',async()=>{
  const worker=await readFile('cloud-worker/backfill-sealed-component-history.mjs','utf8');
  expect(worker).toContain('sealed_inventory_fit_component_targets?select=sku_id,product_id');
  expect(worker).toContain('String(x.skuId)===String(t.sku_id)');
  expect(worker).toContain("source:'tcgplayer_infinite_quarter_history'");
  expect(worker).toContain('lowest_listing_price:null');
  expect(worker).toContain('resolution=ignore-duplicates');
});
