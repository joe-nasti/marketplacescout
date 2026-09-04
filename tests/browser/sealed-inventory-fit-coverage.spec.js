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
  expect(worker).toContain('/v1/product/${encodeURIComponent(productId)}/listings');
  expect(worker).toContain("coverage:'COMPLETE'");
  expect(worker).toContain('direct_available:x.direct_available');
  expect(worker).not.toContain('directQuantitiesAtPrice');
});
