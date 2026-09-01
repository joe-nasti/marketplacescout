import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');

test('exact-SKU discovery coalesces simultaneous TCGplayer matrix requests',async()=>{
  const source=await read('supabase/functions/scout-tcgplayer-sku-discovery/index.ts');
  expect(source).toContain('const skuFetchInflight = new Map');
  expect(source).toContain('if (skuFetchInflight.has(productId)) return skuFetchInflight.get(productId)!');
  expect(source).toContain('fetchSkus(productId).finally(() => skuFetchInflight.delete(productId))');
  expect(source).toContain('fetchSkusCoalesced(productId)');
});

test('missing exact treatments use an expiring negative cache without polluting SKU results',async()=>{
  const source=await read('supabase/functions/scout-tcgplayer-sku-discovery/index.ts');
  expect(source).toContain('const NEGATIVE_TTL_MS = 60*60*1000');
  expect(source).toContain('source: "discovery_negative"');
  expect(source).toContain('raw_json: { cache_key: cacheKey, outcome, expires_at: expires.toISOString() }');
  expect(source).toContain('cachedRows.filter((x: any) => x?.source !== "discovery_negative")');
  expect(source).toContain("negative_cache_used: Boolean(negative)");
  expect(source).toContain('if (wanted.length) await rest');
});

test('cached discovery rows do not rematerialize already-known catalog SKUs',async()=>{
  const source=await read('supabase/functions/scout-tcgplayer-sku-discovery/index.ts');
  expect(source).toContain('x.condition !== "NEAR MINT" || x.catalog_materialized_at');
});
